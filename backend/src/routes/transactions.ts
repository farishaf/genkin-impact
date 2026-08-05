import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { newId } from "../lib/ids.js";
import { parseToMinor } from "../lib/money.js";
import { recomputeAccountBalance } from "../lib/balances.js";
import { convert } from "../lib/fx.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { AppError } from "../middleware/errorHandler.js";

export const transactionsRouter = Router();

const baseFields = {
  amount: z.string().regex(/^\d+(\.\d+)?$/, "amount must be a plain decimal string"),
  occurred_at: z.string().datetime(),
  note: z.string().max(500).optional(),
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
    const amountMinor = parseToMinor(body.amount, account.decimal_digits);
    if (amountMinor <= 0n) throw new AppError(400, "invalid_amount", "Amount must be positive.");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const id = newId();

      if (body.type === "transfer") {
        if (body.to_account_id === body.account_id) throw new AppError(400, "invalid_transfer", "Source and destination accounts must differ.");
        const toAccount = await loadOwnedAccount(req.userId!, body.to_account_id);

        let toAmountMinor: bigint;
        if (toAccount.currency_code === account.currency_code) {
          toAmountMinor = amountMinor;
        } else {
          if (!body.to_amount) throw new AppError(400, "to_amount_required", "to_amount is required for cross-currency transfers.");
          toAmountMinor = parseToMinor(body.to_amount, toAccount.decimal_digits);
        }

        await client.query(
          `INSERT INTO transactions (id, user_id, type, account_id, to_account_id, amount, currency_code, to_amount, occurred_at, note)
           VALUES ($1, $2, 'transfer', $3, $4, $5, $6, $7, $8, $9)`,
          [id, req.userId, body.account_id, body.to_account_id, amountMinor, account.currency_code, toAmountMinor, body.occurred_at, body.note ?? null]
        );

        await recomputeAccountBalance(client, body.account_id);
        await recomputeAccountBalance(client, body.to_account_id);
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
          `INSERT INTO transactions (id, user_id, type, account_id, category_id, amount, currency_code, occurred_at, note)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [id, req.userId, body.type, body.account_id, body.category_id, amountMinor, account.currency_code, body.occurred_at, body.note ?? null]
        );

        await recomputeAccountBalance(client, body.account_id);
      }

      const created = await client.query("SELECT * FROM transactions WHERE id = $1", [id]);
      await client.query("COMMIT");
      res.status(201).json({ transaction: created.rows[0] });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

const listQuerySchema = z.object({
  type: z.enum(["expense", "income", "transfer"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

transactionsRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const query = listQuerySchema.parse(req.query);
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
      conditions.push(`t.occurred_at <= $${params.length}`);
    }

    params.push(query.limit, query.offset);
    const result = await pool.query(
      `SELECT t.*, c.name AS category_name, c.emoji AS category_emoji, a.name AS account_name
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       JOIN accounts a ON a.id = t.account_id
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
  from: z.string().optional(),
  to: z.string().optional(),
});

transactionsRouter.get("/summary", requireAuth, async (req, res, next) => {
  try {
    const query = summaryQuerySchema.parse(req.query);
    const conditions = ["user_id = $1", "deleted_at IS NULL"];
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
      conditions.push(`occurred_at <= $${params.length}`);
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

    for (const row of grouped.rows) {
      const converted = await convert(pool, BigInt(row.total), row.currency_code, mainCurrency, onDate, decimalsByCode);
      if (row.type === "income") incomeMinor += converted.amountMinor;
      else expenditureMinor += converted.amountMinor;
      count += Number(row.count);
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
