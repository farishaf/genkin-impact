import { Router } from "express";
import { z } from "zod";
import { pool, withTransaction } from "../db/pool.js";
import { newId } from "../lib/ids.js";
import { parseToMinor } from "../lib/money.js";
import { recomputeAccountBalance } from "../lib/balances.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { AppError } from "../middleware/errorHandler.js";

export const recurringRulesRouter = Router();

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date in YYYY-MM-DD format");
const FREQUENCIES = ["daily", "weekly", "monthly", "yearly"] as const;

const baseFields = {
  name: z.string().min(1).max(80),
  amount: z.string().regex(/^\d+(\.\d+)?$/, "amount must be a plain decimal string"),
  frequency: z.enum(FREQUENCIES),
  interval_count: z.number().int().min(1).max(365).optional().default(1),
  day_of_month: z.number().int().min(1).max(31).nullable().optional(),
  day_of_week: z.number().int().min(0).max(6).nullable().optional(),
  starts_on: dateOnlySchema,
  ends_on: dateOnlySchema.nullable().optional(),
  auto_post: z.boolean().optional().default(true),
};

const expenseOrIncomeSchema = z.object({
  txn_type: z.enum(["expense", "income"]),
  account_id: z.string().uuid(),
  category_id: z.string().uuid(),
  ...baseFields,
});

const transferSchema = z.object({
  txn_type: z.literal("transfer"),
  account_id: z.string().uuid(),
  to_account_id: z.string().uuid(),
  ...baseFields,
});

const createRuleSchema = z.union([expenseOrIncomeSchema, transferSchema]);

const updateRuleSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  amount: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  interval_count: z.number().int().min(1).max(365).optional(),
  day_of_month: z.number().int().min(1).max(31).nullable().optional(),
  ends_on: dateOnlySchema.nullable().optional(),
  auto_post: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

async function loadOwnedAccount(userId: string, accountId: string) {
  const res = await pool.query(
    `SELECT a.*, c.decimal_digits FROM accounts a JOIN currencies c ON c.code = a.currency_code
     WHERE a.id = $1 AND a.user_id = $2 AND a.deleted_at IS NULL AND a.is_archived = false`,
    [accountId, userId]
  );
  if (res.rows.length === 0) throw new AppError(400, "invalid_account", "Account not found.");
  return res.rows[0];
}

recurringRulesRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT r.*, a.name AS account_name, ta.name AS to_account_name, c.name AS category_name,
              pending.id AS pending_transaction_id, pending.amount AS pending_amount, pending.occurred_at AS pending_occurred_at
       FROM recurring_rules r
       JOIN accounts a ON a.id = r.account_id
       LEFT JOIN accounts ta ON ta.id = r.to_account_id
       LEFT JOIN categories c ON c.id = r.category_id
       LEFT JOIN LATERAL (
         SELECT id, amount, occurred_at FROM transactions
         WHERE recurring_rule_id = r.id AND status = 'pending' AND deleted_at IS NULL
         ORDER BY occurred_at DESC LIMIT 1
       ) pending ON true
       WHERE r.user_id = $1
       ORDER BY r.next_run_at`,
      [req.userId]
    );

    const rules = result.rows.map((r) => ({
      ...r,
      pending_transaction: r.pending_transaction_id
        ? { id: r.pending_transaction_id, amount: r.pending_amount, occurred_at: r.pending_occurred_at }
        : null,
    }));

    res.json({ recurring_rules: rules });
  } catch (err) {
    next(err);
  }
});

recurringRulesRouter.post("/", requireAuth, validateBody(createRuleSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof createRuleSchema>;
    const account = await loadOwnedAccount(req.userId!, body.account_id);

    let amountMinor: bigint;
    try {
      amountMinor = parseToMinor(body.amount, account.decimal_digits);
    } catch {
      throw new AppError(400, "invalid_amount", `Amount has more decimal places than ${account.currency_code} supports.`);
    }
    if (amountMinor <= 0n) throw new AppError(400, "invalid_amount", "Amount must be positive.");

    let toAccountId: string | null = null;
    let categoryId: string | null = null;

    if (body.txn_type === "transfer") {
      if (body.to_account_id === body.account_id) throw new AppError(400, "invalid_transfer", "Source and destination accounts must differ.");
      await loadOwnedAccount(req.userId!, body.to_account_id);
      toAccountId = body.to_account_id;
    } else {
      const categoryRes = await pool.query("SELECT kind FROM categories WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL", [body.category_id, req.userId]);
      if (categoryRes.rows.length === 0) throw new AppError(400, "invalid_category", "Category not found.");
      if (categoryRes.rows[0].kind !== body.txn_type) throw new AppError(400, "category_kind_mismatch", "Category kind must match transaction type.");
      categoryId = body.category_id;
    }

    const id = newId();
    const nextRunAt = new Date(`${body.starts_on}T00:00:00.000Z`);

    const inserted = await pool.query(
      `INSERT INTO recurring_rules
         (id, user_id, name, txn_type, account_id, to_account_id, category_id, amount, currency_code,
          frequency, interval_count, day_of_month, day_of_week, starts_on, ends_on, next_run_at, auto_post)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING *`,
      [
        id, req.userId, body.name, body.txn_type, body.account_id, toAccountId, categoryId, amountMinor, account.currency_code,
        body.frequency, body.interval_count, body.day_of_month ?? null, body.day_of_week ?? null,
        body.starts_on, body.ends_on ?? null, nextRunAt.toISOString(), body.auto_post,
      ]
    );

    res.status(201).json({ recurring_rule: inserted.rows[0] });
  } catch (err) {
    next(err);
  }
});

recurringRulesRouter.patch("/:id", requireAuth, validateBody(updateRuleSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof updateRuleSchema>;
    const existing = await pool.query("SELECT r.*, a.decimal_digits FROM recurring_rules r JOIN accounts a ON a.id = r.account_id WHERE r.id = $1 AND r.user_id = $2", [
      req.params.id,
      req.userId,
    ]);
    if (existing.rows.length === 0) throw new AppError(404, "not_found", "Recurring rule not found.");

    let amountMinor: bigint | undefined;
    if (body.amount !== undefined) {
      try {
        amountMinor = parseToMinor(body.amount, existing.rows[0].decimal_digits);
      } catch {
        throw new AppError(400, "invalid_amount", "Amount has more decimal places than this rule's currency supports.");
      }
      if (amountMinor <= 0n) throw new AppError(400, "invalid_amount", "Amount must be positive.");
    }

    const updated = await pool.query(
      `UPDATE recurring_rules SET
         name = COALESCE($1, name),
         amount = COALESCE($2, amount),
         interval_count = COALESCE($3, interval_count),
         day_of_month = COALESCE($4, day_of_month),
         ends_on = COALESCE($5, ends_on),
         auto_post = COALESCE($6, auto_post),
         is_active = COALESCE($7, is_active)
       WHERE id = $8 AND user_id = $9
       RETURNING *`,
      [body.name ?? null, amountMinor ?? null, body.interval_count ?? null, body.day_of_month ?? null, body.ends_on ?? null, body.auto_post ?? null, body.is_active ?? null, req.params.id, req.userId]
    );

    res.json({ recurring_rule: updated.rows[0] });
  } catch (err) {
    next(err);
  }
});

async function loadLatestPending(ruleId: string, userId: string) {
  const res = await pool.query(
    `SELECT t.* FROM transactions t JOIN recurring_rules r ON r.id = t.recurring_rule_id
     WHERE t.recurring_rule_id = $1 AND r.user_id = $2 AND t.status = 'pending' AND t.deleted_at IS NULL
     ORDER BY t.occurred_at DESC LIMIT 1`,
    [ruleId, userId]
  );
  if (res.rows.length === 0) throw new AppError(404, "no_pending_transaction", "This rule has no pending transaction to act on.");
  return res.rows[0];
}

recurringRulesRouter.post("/:id/confirm", requireAuth, async (req, res, next) => {
  try {
    const pending = await loadLatestPending(req.params.id as string, req.userId!);

    const transaction = await withTransaction(async (client) => {
      await client.query("UPDATE transactions SET status = 'cleared', updated_at = now() WHERE id = $1", [pending.id]);
      for (const accountId of [pending.account_id, pending.to_account_id].filter(Boolean).sort()) {
        await recomputeAccountBalance(client, accountId);
      }
      const result = await client.query("SELECT * FROM transactions WHERE id = $1", [pending.id]);
      return result.rows[0];
    });

    res.json({ transaction });
  } catch (err) {
    next(err);
  }
});

recurringRulesRouter.post("/:id/dismiss", requireAuth, async (req, res, next) => {
  try {
    const pending = await loadLatestPending(req.params.id as string, req.userId!);
    await pool.query("UPDATE transactions SET deleted_at = now(), updated_at = now() WHERE id = $1", [pending.id]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

recurringRulesRouter.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      "UPDATE recurring_rules SET is_active = false WHERE id = $1 AND user_id = $2 RETURNING id",
      [req.params.id, req.userId]
    );
    if (result.rows.length === 0) throw new AppError(404, "not_found", "Recurring rule not found.");
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
