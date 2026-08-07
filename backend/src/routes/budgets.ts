import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { newId } from "../lib/ids.js";
import { EXCLUDE_INSTALLMENT_ORIGIN_SQL } from "../lib/balances.js";
import { parseToMinor, formatMinor } from "../lib/money.js";
import { convert } from "../lib/fx.js";
import { getPeriodWindow, getPreviousPeriodWindow, computeBudgetProgress } from "../lib/budgetProgress.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { AppError } from "../middleware/errorHandler.js";

export const budgetsRouter = Router();

const PERIODS = ["weekly", "monthly", "quarterly", "yearly"] as const;
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date in YYYY-MM-DD format");

const createBudgetSchema = z.object({
  name: z.string().min(1).max(80),
  category_id: z.string().uuid().nullable().optional(),
  limit_amount: z.string().regex(/^\d+(\.\d+)?$/, "limit_amount must be a plain decimal string"),
  currency_code: z.string().length(3),
  period: z.enum(PERIODS),
  start_date: dateOnlySchema,
  rollover_unused: z.boolean().optional().default(false),
});

const updateBudgetSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  limit_amount: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  rollover_unused: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

async function decimalsByCode(): Promise<Record<string, number>> {
  const res = await pool.query("SELECT code, decimal_digits FROM currencies");
  const map: Record<string, number> = {};
  for (const row of res.rows) map[row.code] = row.decimal_digits;
  return map;
}

async function sumExpensesInWindow(userId: string, categoryId: string | null, start: Date, end: Date, budgetCurrency: string, decimals: Record<string, number>): Promise<bigint> {
  const conditions = ["user_id = $1", "type = 'expense'", "deleted_at IS NULL", "status = 'cleared'", "occurred_at >= $2", "occurred_at < $3", EXCLUDE_INSTALLMENT_ORIGIN_SQL];
  const params: unknown[] = [userId, start.toISOString(), end.toISOString()];
  if (categoryId) {
    params.push(categoryId);
    conditions.push(`category_id = $${params.length}`);
  }

  const grouped = await pool.query(
    `SELECT currency_code, SUM(amount) AS total FROM transactions WHERE ${conditions.join(" AND ")} GROUP BY currency_code`,
    params
  );

  const onDate = end.toISOString().slice(0, 10);
  let total = 0n;
  for (const row of grouped.rows) {
    const converted = await convert(pool, BigInt(row.total), row.currency_code, budgetCurrency, onDate, decimals);
    total += converted.amountMinor;
  }
  return total;
}

// GET is a per-budget series of small queries (window + spent + optional rollover lookback).
// Fine at slice scope (a handful of budgets per user); batch if this ever shows up hot.
budgetsRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const budgetsRes = await pool.query(
      `SELECT b.*, c.symbol, c.decimal_digits, cat.name AS category_name
       FROM budgets b
       JOIN currencies c ON c.code = b.currency_code
       LEFT JOIN categories cat ON cat.id = b.category_id
       WHERE b.user_id = $1 AND b.is_active = true
       ORDER BY b.created_at`,
      [req.userId]
    );

    const decimals = await decimalsByCode();
    const now = new Date();

    const budgets = await Promise.all(
      budgetsRes.rows.map(async (b) => {
        const window = getPeriodWindow(b.period, b.start_date, now);
        const spentMinor = await sumExpensesInWindow(req.userId!, b.category_id, window.start, window.end, b.currency_code, decimals);

        let effectiveLimitMinor = BigInt(b.limit_amount);
        if (b.rollover_unused) {
          const prevWindow = getPreviousPeriodWindow(b.period, b.start_date, now);
          if (prevWindow) {
            const prevSpentMinor = await sumExpensesInWindow(req.userId!, b.category_id, prevWindow.start, prevWindow.end, b.currency_code, decimals);
            const carry = BigInt(b.limit_amount) - prevSpentMinor;
            if (carry > 0n) effectiveLimitMinor += carry;
          }
        }

        const progress = computeBudgetProgress(effectiveLimitMinor, spentMinor);

        return {
          ...b,
          category_name: b.category_name,
          period_start: window.start.toISOString(),
          period_end: window.end.toISOString(),
          limit_minor: progress.limitMinor.toString(),
          spent_minor: progress.spentMinor.toString(),
          remaining_minor: progress.remainingMinor.toString(),
          pct: progress.pct,
          limit_display: formatMinor(progress.limitMinor, b.decimal_digits, b.symbol),
          spent_display: formatMinor(progress.spentMinor, b.decimal_digits, b.symbol),
        };
      })
    );

    res.json({ budgets });
  } catch (err) {
    next(err);
  }
});

budgetsRouter.post("/", requireAuth, validateBody(createBudgetSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof createBudgetSchema>;

    const currencyRes = await pool.query("SELECT decimal_digits FROM currencies WHERE code = $1 AND is_active = true", [body.currency_code]);
    if (currencyRes.rows.length === 0) throw new AppError(400, "invalid_currency", "Unknown currency code.");
    const { decimal_digits } = currencyRes.rows[0];

    if (body.category_id) {
      const catRes = await pool.query("SELECT kind FROM categories WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL", [body.category_id, req.userId]);
      if (catRes.rows.length === 0) throw new AppError(400, "invalid_category", "Category not found.");
      if (catRes.rows[0].kind !== "expense") throw new AppError(400, "invalid_category", "Budgets can only be scoped to expense categories.");
    }

    let limitMinor: bigint;
    try {
      limitMinor = parseToMinor(body.limit_amount, decimal_digits);
    } catch {
      throw new AppError(400, "invalid_amount", `limit_amount has more decimal places than ${body.currency_code} supports.`);
    }
    if (limitMinor <= 0n) throw new AppError(400, "invalid_amount", "limit_amount must be positive.");

    const id = newId();
    const inserted = await pool.query(
      `INSERT INTO budgets (id, user_id, category_id, name, limit_amount, currency_code, period, start_date, rollover_unused)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [id, req.userId, body.category_id ?? null, body.name, limitMinor, body.currency_code, body.period, body.start_date, body.rollover_unused]
    );

    res.status(201).json({ budget: inserted.rows[0] });
  } catch (err) {
    next(err);
  }
});

budgetsRouter.patch("/:id", requireAuth, validateBody(updateBudgetSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof updateBudgetSchema>;
    const existing = await pool.query("SELECT * FROM budgets WHERE id = $1 AND user_id = $2", [req.params.id, req.userId]);
    if (existing.rows.length === 0) throw new AppError(404, "not_found", "Budget not found.");

    let limitMinor: bigint | undefined;
    if (body.limit_amount !== undefined) {
      const currencyRes = await pool.query("SELECT decimal_digits FROM currencies WHERE code = $1", [existing.rows[0].currency_code]);
      try {
        limitMinor = parseToMinor(body.limit_amount, currencyRes.rows[0].decimal_digits);
      } catch {
        throw new AppError(400, "invalid_amount", "limit_amount has more decimal places than this budget's currency supports.");
      }
      if (limitMinor <= 0n) throw new AppError(400, "invalid_amount", "limit_amount must be positive.");
    }

    const updated = await pool.query(
      `UPDATE budgets SET
         name = COALESCE($1, name),
         limit_amount = COALESCE($2, limit_amount),
         rollover_unused = COALESCE($3, rollover_unused),
         is_active = COALESCE($4, is_active)
       WHERE id = $5 AND user_id = $6
       RETURNING *`,
      [body.name ?? null, limitMinor ?? null, body.rollover_unused ?? null, body.is_active ?? null, req.params.id, req.userId]
    );

    res.json({ budget: updated.rows[0] });
  } catch (err) {
    next(err);
  }
});

budgetsRouter.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      "UPDATE budgets SET is_active = false WHERE id = $1 AND user_id = $2 RETURNING id",
      [req.params.id, req.userId]
    );
    if (result.rows.length === 0) throw new AppError(404, "not_found", "Budget not found.");
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
