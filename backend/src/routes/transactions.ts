import { Router } from "express";
import { z } from "zod";
import { pool, withTransaction } from "../db/pool.js";
import { newId } from "../lib/ids.js";
import { parseToMinor } from "../lib/money.js";
import { recomputeAccountBalance, EXCLUDE_INSTALLMENT_ORIGIN_SQL } from "../lib/balances.js";
import { convert } from "../lib/fx.js";
import { advanceNextRun } from "../lib/recurring.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { validateQuery } from "../middleware/validateQuery.js";
import { AppError } from "../middleware/errorHandler.js";

export const transactionsRouter = Router();

const baseFields = {
  amount: z.string().regex(/^\d+(\.\d+)?$/, "amount must be a plain decimal string"),
  occurred_at: z.string().datetime(),
  note: z.string().max(500).optional(),
  member_id: z.string().uuid().optional(),
  tag_ids: z.string().uuid().array().optional(),
};

const expenseOrIncomeSchema = z.object({
  type: z.enum(["expense", "income"]),
  account_id: z.string().uuid(),
  category_id: z.string().uuid(),
  ...baseFields,
});

const transferSchema = z.object({
  type: z.literal("transfer"),
  account_id: z.string().uuid(),
  to_account_id: z.string().uuid(),
  to_amount: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  ...baseFields,
});

const createTransactionSchema = z.union([expenseOrIncomeSchema, transferSchema]);

// tag_ids key present (even []) = replace the tag set; key absent = leave tags untouched.
const updateTransactionSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d+)?$/, "amount must be a plain decimal string").optional(),
  category_id: z.string().uuid().optional(),
  member_id: z.string().uuid().optional(),
  tag_ids: z.string().uuid().array().optional(),
  note: z.string().max(500).optional(),
  occurred_at: z.string().datetime().optional(),
});

const refundSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d+)?$/, "amount must be a plain decimal string").optional(),
  occurred_at: z.string().datetime().optional(),
  note: z.string().max(500).optional(),
});

const installmentsSchema = z.object({
  installment_count: z.number().int().min(2).max(60),
  interval_unit: z.enum(["month", "week"]),
  fee_amount: z.string().regex(/^\d+(\.\d+)?$/, "fee_amount must be a plain decimal string").optional(),
  first_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date in YYYY-MM-DD format"),
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

transactionsRouter.post("/", requireAuth, validateBody(createTransactionSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof createTransactionSchema>;
    const account = await loadOwnedAccount(req.userId!, body.account_id);
    let amountMinor: bigint;
    try {
      amountMinor = parseToMinor(body.amount, account.decimal_digits);
    } catch {
      throw new AppError(400, "invalid_amount", `Amount has more decimal places than ${account.currency_code} supports.`);
    }
    if (amountMinor <= 0n) throw new AppError(400, "invalid_amount", "Amount must be positive.");

    if (body.member_id) {
      const memberRes = await pool.query(
        "SELECT id FROM members WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
        [body.member_id, req.userId]
      );
      if (memberRes.rows.length === 0) throw new AppError(400, "invalid_member", "Member not found.");
    }
    if (body.tag_ids && body.tag_ids.length > 0) {
      const tagRes = await pool.query(
        "SELECT id FROM tags WHERE id = ANY($1) AND user_id = $2 AND deleted_at IS NULL",
        [body.tag_ids, req.userId]
      );
      if (tagRes.rows.length !== new Set(body.tag_ids).size) throw new AppError(400, "invalid_tag", "One or more tags not found.");
    }

    const transaction = await withTransaction(async (client) => {
      const id = newId();

      if (body.type === "transfer") {
        if (body.to_account_id === body.account_id) throw new AppError(400, "invalid_transfer", "Source and destination accounts must differ.");
        const toAccount = await loadOwnedAccount(req.userId!, body.to_account_id);

        let toAmountMinor: bigint;
        if (toAccount.currency_code === account.currency_code) {
          toAmountMinor = amountMinor;
        } else {
          if (!body.to_amount) throw new AppError(400, "to_amount_required", "to_amount is required for cross-currency transfers.");
          try {
            toAmountMinor = parseToMinor(body.to_amount, toAccount.decimal_digits);
          } catch {
            throw new AppError(400, "invalid_amount", `to_amount has more decimal places than ${toAccount.currency_code} supports.`);
          }
          if (toAmountMinor <= 0n) throw new AppError(400, "invalid_amount", "to_amount must be positive.");
        }

        await client.query(
          `INSERT INTO transactions (id, user_id, type, account_id, to_account_id, member_id, amount, currency_code, to_amount, occurred_at, note)
           VALUES ($1, $2, 'transfer', $3, $4, $5, $6, $7, $8, $9, $10)`,
          [id, req.userId, body.account_id, body.to_account_id, body.member_id ?? null, amountMinor, account.currency_code, toAmountMinor, body.occurred_at, body.note ?? null]
        );

        // Lock/recompute both accounts in a fixed order (sorted id), not request order,
        // so an opposing concurrent transfer between the same two accounts acquires the
        // two advisory locks in the same order and can't deadlock against this transaction.
        for (const accountId of [body.account_id, body.to_account_id].sort()) {
          await recomputeAccountBalance(client, accountId);
        }
      } else {
        const category = await client.query(
          "SELECT kind FROM categories WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
          [body.category_id, req.userId]
        );
        if (category.rows.length === 0) throw new AppError(400, "invalid_category", "Category not found.");
        if (category.rows[0].kind !== body.type) {
          throw new AppError(400, "category_kind_mismatch", "Category kind must match transaction type.");
        }

        await client.query(
          `INSERT INTO transactions (id, user_id, type, account_id, category_id, member_id, amount, currency_code, occurred_at, note)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [id, req.userId, body.type, body.account_id, body.category_id, body.member_id ?? null, amountMinor, account.currency_code, body.occurred_at, body.note ?? null]
        );

        await recomputeAccountBalance(client, body.account_id);
      }

      if (body.tag_ids && body.tag_ids.length > 0) {
        for (const tagId of new Set(body.tag_ids)) {
          await client.query("INSERT INTO transaction_tags (transaction_id, tag_id) VALUES ($1, $2)", [id, tagId]);
        }
      }

      const created = await client.query("SELECT * FROM transactions WHERE id = $1", [id]);
      return created.rows[0];
    });

    res.status(201).json({ transaction });
  } catch (err) {
    next(err);
  }
});

transactionsRouter.patch("/:id", requireAuth, validateBody(updateTransactionSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof updateTransactionSchema>;
    const existingRes = await pool.query(
      "SELECT * FROM transactions WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
      [req.params.id, req.userId]
    );
    if (existingRes.rows.length === 0) throw new AppError(404, "not_found", "Transaction not found.");
    const existing = existingRes.rows[0];

    if (existing.type === "transfer" && (body.amount !== undefined || body.category_id !== undefined)) {
      throw new AppError(400, "not_editable_field", "amount and category_id cannot be edited on a transfer.");
    }

    let amountMinor: bigint | undefined;
    if (body.amount !== undefined) {
      const account = await loadOwnedAccount(req.userId!, existing.account_id);
      try {
        amountMinor = parseToMinor(body.amount, account.decimal_digits);
      } catch {
        throw new AppError(400, "invalid_amount", `Amount has more decimal places than ${account.currency_code} supports.`);
      }
      if (amountMinor <= 0n) throw new AppError(400, "invalid_amount", "Amount must be positive.");
    }

    if (body.category_id !== undefined) {
      const category = await pool.query(
        "SELECT kind FROM categories WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
        [body.category_id, req.userId]
      );
      if (category.rows.length === 0) throw new AppError(400, "invalid_category", "Category not found.");
      if (category.rows[0].kind !== existing.type) {
        throw new AppError(400, "category_kind_mismatch", "Category kind must match transaction type.");
      }
    }

    if (body.member_id !== undefined) {
      const memberRes = await pool.query(
        "SELECT id FROM members WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
        [body.member_id, req.userId]
      );
      if (memberRes.rows.length === 0) throw new AppError(400, "invalid_member", "Member not found.");
    }
    if (body.tag_ids && body.tag_ids.length > 0) {
      const tagRes = await pool.query(
        "SELECT id FROM tags WHERE id = ANY($1) AND user_id = $2 AND deleted_at IS NULL",
        [body.tag_ids, req.userId]
      );
      if (tagRes.rows.length !== new Set(body.tag_ids).size) throw new AppError(400, "invalid_tag", "One or more tags not found.");
    }

    const transaction = await withTransaction(async (client) => {
      await client.query(
        `UPDATE transactions SET
           amount = COALESCE($1, amount),
           category_id = COALESCE($2, category_id),
           member_id = COALESCE($3, member_id),
           note = COALESCE($4, note),
           occurred_at = COALESCE($5, occurred_at),
           updated_at = now()
         WHERE id = $6`,
        [amountMinor ?? null, body.category_id ?? null, body.member_id ?? null, body.note ?? null, body.occurred_at ?? null, req.params.id]
      );

      if (body.tag_ids !== undefined) {
        await client.query("DELETE FROM transaction_tags WHERE transaction_id = $1", [req.params.id]);
        for (const tagId of new Set(body.tag_ids)) {
          await client.query("INSERT INTO transaction_tags (transaction_id, tag_id) VALUES ($1, $2)", [req.params.id, tagId]);
        }
      }

      if (amountMinor !== undefined) {
        await recomputeAccountBalance(client, existing.account_id);
      }

      const updated = await client.query("SELECT * FROM transactions WHERE id = $1", [req.params.id]);
      return updated.rows[0];
    });

    res.json({ transaction });
  } catch (err) {
    next(err);
  }
});

transactionsRouter.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    await withTransaction(async (client) => {
      const result = await client.query(
        `UPDATE transactions SET deleted_at = now(), updated_at = now()
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
         RETURNING account_id, to_account_id, type`,
        [req.params.id, req.userId]
      );
      if (result.rows.length === 0) throw new AppError(404, "not_found", "Transaction not found.");
      const row = result.rows[0];

      const accountIds = row.type === "transfer" ? [row.account_id, row.to_account_id] : [row.account_id];
      for (const accountId of accountIds.sort()) {
        await recomputeAccountBalance(client, accountId);
      }
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

transactionsRouter.post("/:id/refund", requireAuth, validateBody(refundSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof refundSchema>;
    const originRes = await pool.query(
      "SELECT * FROM transactions WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
      [req.params.id, req.userId]
    );
    if (originRes.rows.length === 0) throw new AppError(404, "not_found", "Transaction not found.");
    const origin = originRes.rows[0];
    if (origin.type === "transfer") throw new AppError(400, "refund_not_supported", "Transfers can't be refunded.");

    const account = await loadOwnedAccount(req.userId!, origin.account_id);

    const refundedRes = await pool.query(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE refund_of_id = $1 AND deleted_at IS NULL",
      [origin.id]
    );
    const remaining = BigInt(origin.amount) - BigInt(refundedRes.rows[0].total);

    let amountMinor: bigint;
    if (body.amount !== undefined) {
      try {
        amountMinor = parseToMinor(body.amount, account.decimal_digits);
      } catch {
        throw new AppError(400, "invalid_amount", `Amount has more decimal places than ${account.currency_code} supports.`);
      }
    } else {
      amountMinor = remaining;
    }
    if (amountMinor <= 0n) throw new AppError(400, "invalid_amount", "Amount must be positive.");
    if (amountMinor > remaining) throw new AppError(400, "over_refund", "Refund amount exceeds the remaining refundable balance.");

    const refundType = origin.type === "expense" ? "income" : "expense";

    const transaction = await withTransaction(async (client) => {
      const id = newId();
      await client.query(
        `INSERT INTO transactions (id, user_id, type, account_id, member_id, amount, currency_code, occurred_at, note, refund_of_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id, req.userId, refundType, origin.account_id, origin.member_id, amountMinor, origin.currency_code, body.occurred_at ?? new Date().toISOString(), body.note ?? null, origin.id]
      );
      await recomputeAccountBalance(client, origin.account_id);
      const created = await client.query("SELECT * FROM transactions WHERE id = $1", [id]);
      return created.rows[0];
    });

    res.status(201).json({ transaction });
  } catch (err) {
    next(err);
  }
});

transactionsRouter.post("/:id/installments", requireAuth, validateBody(installmentsSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof installmentsSchema>;
    const originRes = await pool.query(
      "SELECT * FROM transactions WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
      [req.params.id, req.userId]
    );
    if (originRes.rows.length === 0) throw new AppError(404, "not_found", "Transaction not found.");
    const origin = originRes.rows[0];
    if (origin.type === "transfer") throw new AppError(400, "installments_not_supported", "Transfers can't be split into installments.");
    if (origin.installment_plan_id) throw new AppError(400, "already_installment", "This transaction is already part of an installment plan.");

    const account = await loadOwnedAccount(req.userId!, origin.account_id);

    let feeMinor = 0n;
    if (body.fee_amount !== undefined) {
      try {
        feeMinor = parseToMinor(body.fee_amount, account.decimal_digits);
      } catch {
        throw new AppError(400, "invalid_amount", `fee_amount has more decimal places than ${account.currency_code} supports.`);
      }
    }

    const totalMinor = BigInt(origin.amount) + feeMinor;
    const count = BigInt(body.installment_count);
    const base = totalMinor / count;
    const remainder = totalMinor % count;
    if (base <= 0n) throw new AppError(400, "invalid_installment_count", "Installment amount would round to zero — reduce the installment count.");

    const dates: string[] = [];
    let cursor = new Date(`${body.first_due_date}T00:00:00.000Z`);
    for (let i = 0; i < body.installment_count; i++) {
      dates.push(cursor.toISOString());
      cursor = advanceNextRun(cursor, { frequency: body.interval_unit === "month" ? "monthly" : "weekly", intervalCount: 1 });
    }

    const result = await withTransaction(async (client) => {
      const planId = newId();
      await client.query(
        `INSERT INTO installment_plans (id, user_id, origin_transaction_id, total_amount, installment_count, interval_unit, fee_amount, first_due_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [planId, req.userId, origin.id, totalMinor, body.installment_count, body.interval_unit, feeMinor, body.first_due_date]
      );
      await client.query("UPDATE transactions SET installment_plan_id = $1, updated_at = now() WHERE id = $2", [planId, origin.id]);

      const childIds: string[] = [];
      for (let i = 0; i < body.installment_count; i++) {
        const isLast = i === body.installment_count - 1;
        const amount = isLast ? base + remainder : base;
        const id = newId();
        await client.query(
          `INSERT INTO transactions (id, user_id, type, account_id, category_id, member_id, amount, currency_code, occurred_at, note, installment_plan_id, installment_seq, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'cleared')`,
          [id, req.userId, origin.type, origin.account_id, origin.category_id, origin.member_id, amount, origin.currency_code, dates[i], origin.note, planId, i + 1]
        );
        childIds.push(id);
      }

      await recomputeAccountBalance(client, origin.account_id);

      const plan = await client.query("SELECT * FROM installment_plans WHERE id = $1", [planId]);
      const children = await client.query("SELECT * FROM transactions WHERE id = ANY($1) ORDER BY installment_seq", [childIds]);
      return { installment_plan: plan.rows[0], transactions: children.rows };
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// YYYY-MM-DD only: rejects garbage like "not-a-date" up front instead of letting
// it reach Postgres, which would fail the query and surface as a raw 500.
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date in YYYY-MM-DD format");

const listQuerySchema = z.object({
  type: z.enum(["expense", "income", "transfer"]).optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  member_id: z.string().uuid().optional(),
  tag_id: z.string().uuid().optional(),
  category_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

transactionsRouter.get("/", requireAuth, validateQuery(listQuerySchema), async (req, res, next) => {
  try {
    const query = req.validatedQuery as z.infer<typeof listQuerySchema>;
    const conditions = ["t.user_id = $1", "t.deleted_at IS NULL"];
    const params: unknown[] = [req.userId];

    if (query.type) {
      params.push(query.type);
      conditions.push(`t.type = $${params.length}`);
    }
    if (query.from) {
      params.push(query.from);
      conditions.push(`t.occurred_at >= $${params.length}`);
    }
    if (query.to) {
      params.push(query.to);
      conditions.push(`t.occurred_at < ($${params.length}::date + interval '1 day')`);
    }
    if (query.member_id) {
      params.push(query.member_id);
      conditions.push(`t.member_id = $${params.length}`);
    }
    if (query.category_id) {
      params.push(query.category_id);
      conditions.push(`t.category_id = $${params.length}`);
    }
    if (query.tag_id) {
      params.push(query.tag_id);
      conditions.push(`EXISTS (SELECT 1 FROM transaction_tags tt WHERE tt.transaction_id = t.id AND tt.tag_id = $${params.length})`);
    }

    params.push(query.limit, query.offset);
    const result = await pool.query(
      `SELECT t.*, c.name AS category_name, c.emoji AS category_emoji, a.name AS account_name, m.name AS member_name,
              COALESCE(tags.tags, '[]') AS tags
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN members m ON m.id = t.member_id
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object('id', tg.id, 'name', tg.name, 'color', tg.color)) AS tags
         FROM transaction_tags tt2 JOIN tags tg ON tg.id = tt2.tag_id
         WHERE tt2.transaction_id = t.id
       ) tags ON true
       WHERE ${conditions.join(" AND ")}
       ORDER BY t.occurred_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ items: result.rows });
  } catch (err) {
    next(err);
  }
});

const summaryQuerySchema = z.object({
  type: z.enum(["expense", "income", "transfer"]).optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});

transactionsRouter.get("/summary", requireAuth, validateQuery(summaryQuerySchema), async (req, res, next) => {
  try {
    const query = req.validatedQuery as z.infer<typeof summaryQuerySchema>;
    const conditions = ["user_id = $1", "deleted_at IS NULL", EXCLUDE_INSTALLMENT_ORIGIN_SQL];
    const params: unknown[] = [req.userId];

    if (query.type) {
      params.push(query.type);
      conditions.push(`type = $${params.length}`);
    }
    if (query.from) {
      params.push(query.from);
      conditions.push(`occurred_at >= $${params.length}`);
    }
    if (query.to) {
      params.push(query.to);
      conditions.push(`occurred_at < ($${params.length}::date + interval '1 day')`);
    }

    const grouped = await pool.query(
      `SELECT currency_code, type, SUM(amount) AS total, COUNT(*) AS count
       FROM transactions
       WHERE ${conditions.join(" AND ")} AND type IN ('income', 'expense')
       GROUP BY currency_code, type`,
      params
    );

    const userRes = await pool.query("SELECT main_currency_code FROM users WHERE id = $1", [req.userId]);
    const mainCurrency = userRes.rows[0].main_currency_code as string | null;
    if (!mainCurrency) throw new AppError(400, "no_main_currency", "User has not set a main currency yet.");

    const currenciesRes = await pool.query("SELECT code, decimal_digits FROM currencies");
    const decimalsByCode: Record<string, number> = {};
    for (const row of currenciesRes.rows) decimalsByCode[row.code] = row.decimal_digits;

    const onDate = (query.to ?? new Date().toISOString().slice(0, 10)).slice(0, 10);

    let incomeMinor = 0n;
    let expenditureMinor = 0n;
    let count = 0;

    try {
      for (const row of grouped.rows) {
        const converted = await convert(pool, BigInt(row.total), row.currency_code, mainCurrency, onDate, decimalsByCode);
        if (row.type === "income") incomeMinor += converted.amountMinor;
        else expenditureMinor += converted.amountMinor;
        count += Number(row.count);
      }
    } catch {
      // convert()/getRateToUSD() throw a plain Error when no exchange rate exists at all
      // (not even a prior one) for a currency on or before the requested date — e.g. a
      // date range older than the seeded rate history. That's a client-fixable "pick a
      // different range" situation, not a server fault, so surface it as a 400.
      throw new AppError(400, "fx_rate_unavailable", "No exchange rate available for this date range yet.");
    }

    res.json({
      summary: {
        income_minor: incomeMinor.toString(),
        expenditure_minor: expenditureMinor.toString(),
        balance_minor: (incomeMinor - expenditureMinor).toString(),
        count,
        main_currency_code: mainCurrency,
      },
    });
  } catch (err) {
    next(err);
  }
});
