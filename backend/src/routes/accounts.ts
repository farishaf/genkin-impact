import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { newId } from "../lib/ids.js";
import { parseToMinor, formatMinor } from "../lib/money.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { AppError } from "../middleware/errorHandler.js";

export const accountsRouter = Router();

const ACCOUNT_TYPES = ["cash", "bank", "credit_card", "e_wallet", "investment", "liability"] as const;

const createAccountSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(ACCOUNT_TYPES),
  currency_code: z.string().length(3),
  opening_balance: z.string().regex(/^\d+(\.\d+)?$/, "opening_balance must be a plain decimal string"),
});

function withDisplay(account: any, symbol: string) {
  return { ...account, balance_display: formatMinor(BigInt(account.cached_balance), account.decimal_digits, symbol) };
}

accountsRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT a.*, c.symbol, c.decimal_digits
       FROM accounts a
       JOIN currencies c ON c.code = a.currency_code
       WHERE a.user_id = $1 AND a.deleted_at IS NULL AND a.is_archived = false
       ORDER BY a.sort_order, a.created_at`,
      [req.userId]
    );
    res.json({ accounts: result.rows.map((row) => withDisplay(row, row.symbol)) });
  } catch (err) {
    next(err);
  }
});

accountsRouter.post("/", requireAuth, validateBody(createAccountSchema), async (req, res, next) => {
  try {
    const { name, type, currency_code, opening_balance } = req.body as z.infer<typeof createAccountSchema>;

    const currencyRes = await pool.query("SELECT decimal_digits, symbol FROM currencies WHERE code = $1 AND is_active = true", [currency_code]);
    if (currencyRes.rows.length === 0) throw new AppError(400, "invalid_currency", "Unknown currency code.");
    const { decimal_digits, symbol } = currencyRes.rows[0];

    let openingMinor: bigint;
    try {
      openingMinor = parseToMinor(opening_balance, decimal_digits);
    } catch {
      throw new AppError(400, "invalid_amount", `Opening balance has more decimal places than ${currency_code} supports.`);
    }
    const accountId = newId();

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const accountRes = await client.query(
        `INSERT INTO accounts (id, user_id, name, type, currency_code, opening_balance, cached_balance)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         RETURNING *`,
        [accountId, req.userId, name, type, currency_code, openingMinor]
      );

      const userRes = await client.query("SELECT onboarded_at FROM users WHERE id = $1", [req.userId]);
      if (userRes.rows[0].onboarded_at === null) {
        await client.query("UPDATE users SET onboarded_at = now() WHERE id = $1", [req.userId]);
      }

      await client.query("COMMIT");

      res.status(201).json({ account: withDisplay({ ...accountRes.rows[0], decimal_digits }, symbol) });
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
