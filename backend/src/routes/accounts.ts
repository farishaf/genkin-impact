import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { newId } from "../lib/ids.js";
import { parseToMinor, formatMinor } from "../lib/money.js";
import { convert } from "../lib/fx.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { validateQuery } from "../middleware/validateQuery.js";
import { AppError } from "../middleware/errorHandler.js";

export const accountsRouter = Router();

const ACCOUNT_TYPES = ["cash", "bank", "credit_card", "e_wallet", "investment", "liability"] as const;

const createAccountSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(ACCOUNT_TYPES),
  currency_code: z.string().length(3),
  opening_balance: z.string().regex(/^\d+(\.\d+)?$/, "opening_balance must be a plain decimal string"),
});

const updateAccountSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  exclude_from_net_worth: z.boolean().optional(),
  is_archived: z.boolean().optional(),
  credit_limit: z
    .string()
    .regex(/^\d+(\.\d+)?$/, "credit_limit must be a plain decimal string")
    .nullable()
    .optional(),
  statement_day: z.number().int().min(1).max(31).nullable().optional(),
});

function withDisplay(account: any, symbol: string) {
  return { ...account, balance_display: formatMinor(BigInt(account.cached_balance), account.decimal_digits, symbol) };
}

const listQuerySchema = z.object({ include_archived: z.enum(["true", "false"]).optional() });

accountsRouter.get("/", requireAuth, validateQuery(listQuerySchema), async (req, res, next) => {
  try {
    const query = req.validatedQuery as z.infer<typeof listQuerySchema>;
    const includeArchived = query.include_archived === "true";

    const result = await pool.query(
      `SELECT a.*, c.symbol, c.decimal_digits,
         (SELECT COALESCE(SUM(g.contributed_amount), 0) FROM savings_goals g
          WHERE g.account_id = a.id AND g.status != 'archived') AS allocated_minor
       FROM accounts a
       JOIN currencies c ON c.code = a.currency_code
       WHERE a.user_id = $1 AND a.deleted_at IS NULL ${includeArchived ? "" : "AND a.is_archived = false"}
       ORDER BY a.sort_order, a.created_at`,
      [req.userId]
    );
    const accounts = result.rows.map((row) => {
      // Savings allocations are earmarks only; spendable = balance minus what's set aside.
      const allocated = BigInt(row.allocated_minor);
      return {
        ...withDisplay(row, row.symbol),
        allocated_minor: allocated.toString(),
        allocated_display: formatMinor(allocated, row.decimal_digits, row.symbol),
        spendable_display: formatMinor(BigInt(row.cached_balance) - allocated, row.decimal_digits, row.symbol),
      };
    });

    // Net worth: live-converted sum of non-archived, non-excluded balances — same
    // read-time conversion §8 uses for report totals, never a stored/cached figure.
    const userRes = await pool.query("SELECT main_currency_code FROM users WHERE id = $1", [req.userId]);
    const mainCurrency = userRes.rows[0].main_currency_code as string | null;

    let netWorthMinor: string | null = null;
    if (mainCurrency) {
      const currenciesRes = await pool.query("SELECT code, decimal_digits FROM currencies");
      const decimalsByCode: Record<string, number> = {};
      for (const row of currenciesRes.rows) decimalsByCode[row.code] = row.decimal_digits;
      const onDate = new Date().toISOString().slice(0, 10);

      let total = 0n;
      try {
        for (const a of result.rows) {
          if (a.is_archived || a.exclude_from_net_worth) continue;
          const converted = await convert(pool, BigInt(a.cached_balance), a.currency_code, mainCurrency, onDate, decimalsByCode);
          total += converted.amountMinor;
        }
        netWorthMinor = total.toString();
      } catch {
        // No exchange rate available for one of the account currencies yet — omit
        // net worth rather than fail the whole account list.
        netWorthMinor = null;
      }
    }

    res.json({ accounts, net_worth_minor: netWorthMinor, main_currency_code: mainCurrency });
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

accountsRouter.patch("/:id", requireAuth, validateBody(updateAccountSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof updateAccountSchema>;

    const existing = await pool.query(
      `SELECT a.*, c.symbol, c.decimal_digits FROM accounts a JOIN currencies c ON c.code = a.currency_code
       WHERE a.id = $1 AND a.user_id = $2 AND a.deleted_at IS NULL`,
      [req.params.id, req.userId]
    );
    if (existing.rows.length === 0) throw new AppError(404, "not_found", "Account not found.");
    const account = existing.rows[0];

    if (body.statement_day !== undefined && body.statement_day !== null && account.type !== "credit_card") {
      throw new AppError(400, "not_a_credit_card", "statement_day only applies to credit_card accounts.");
    }

    let creditLimitMinor: bigint | null | undefined = undefined;
    if (body.credit_limit !== undefined) {
      if (body.credit_limit === null) {
        creditLimitMinor = null;
      } else {
        try {
          creditLimitMinor = parseToMinor(body.credit_limit, account.decimal_digits);
        } catch {
          throw new AppError(400, "invalid_amount", `Credit limit has more decimal places than ${account.currency_code} supports.`);
        }
      }
    }

    const result = await pool.query(
      `UPDATE accounts SET
         name = COALESCE($1, name),
         exclude_from_net_worth = COALESCE($2, exclude_from_net_worth),
         is_archived = COALESCE($3, is_archived),
         credit_limit = CASE WHEN $4 THEN $5 ELSE credit_limit END,
         statement_day = CASE WHEN $6 THEN $7 ELSE statement_day END
       WHERE id = $8 AND user_id = $9
       RETURNING *`,
      [
        body.name ?? null,
        body.exclude_from_net_worth ?? null,
        body.is_archived ?? null,
        creditLimitMinor !== undefined,
        creditLimitMinor ?? null,
        body.statement_day !== undefined,
        body.statement_day ?? null,
        req.params.id,
        req.userId,
      ]
    );

    res.json({ account: withDisplay({ ...result.rows[0], decimal_digits: account.decimal_digits }, account.symbol) });
  } catch (err) {
    next(err);
  }
});

accountsRouter.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const existing = await pool.query("SELECT id FROM accounts WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL", [
      req.params.id,
      req.userId,
    ]);
    if (existing.rows.length === 0) throw new AppError(404, "not_found", "Account not found.");

    await pool.query("UPDATE accounts SET deleted_at = now() WHERE id = $1 AND user_id = $2", [req.params.id, req.userId]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
