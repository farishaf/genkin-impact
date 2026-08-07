import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { EXCLUDE_INSTALLMENT_ORIGIN_SQL } from "../lib/balances.js";
import { convert } from "../lib/fx.js";
import { signForNet, bucketForNet, monthRange, datesInRange } from "../lib/analytics.js";
import { requireAuth } from "../middleware/auth.js";
import { validateQuery } from "../middleware/validateQuery.js";
import { AppError } from "../middleware/errorHandler.js";

export const analyticsRouter = Router();

const monthSchema = z.string().regex(/^\d{4}-\d{2}$/, "must be a month in YYYY-MM format");

const summaryQuerySchema = z.object({
  month: monthSchema.optional(),
});

async function decimalsByCode(): Promise<Record<string, number>> {
  const res = await pool.query("SELECT code, decimal_digits FROM currencies");
  const map: Record<string, number> = {};
  for (const row of res.rows) map[row.code] = row.decimal_digits;
  return map;
}

analyticsRouter.get("/summary", requireAuth, validateQuery(summaryQuerySchema), async (req, res, next) => {
  try {
    const query = req.validatedQuery as z.infer<typeof summaryQuerySchema>;
    const month = query.month ?? new Date().toISOString().slice(0, 7);
    const { start, end } = monthRange(month);

    const userRes = await pool.query("SELECT main_currency_code FROM users WHERE id = $1", [req.userId]);
    const mainCurrency = userRes.rows[0].main_currency_code as string | null;
    if (!mainCurrency) throw new AppError(400, "no_main_currency", "User has not set a main currency yet.");

    const grouped = await pool.query(
      `SELECT DATE(occurred_at) AS day, type, currency_code, SUM(amount) AS total
       FROM transactions
       WHERE user_id = $1 AND deleted_at IS NULL AND status = 'cleared'
         AND type IN ('income', 'expense') AND occurred_at >= $2 AND occurred_at < $3
         AND ${EXCLUDE_INSTALLMENT_ORIGIN_SQL}
       GROUP BY DATE(occurred_at), type, currency_code`,
      [req.userId, start.toISOString(), end.toISOString()]
    );

    const decimals = await decimalsByCode();
    const byDay = new Map<string, { incomeMinor: bigint; expenditureMinor: bigint }>();
    for (const date of datesInRange(start, end)) byDay.set(date, { incomeMinor: 0n, expenditureMinor: 0n });

    try {
      for (const row of grouped.rows) {
        const dateKey = new Date(row.day).toISOString().slice(0, 10);
        const converted = await convert(pool, BigInt(row.total), row.currency_code, mainCurrency, dateKey, decimals);
        const bucket = byDay.get(dateKey) ?? { incomeMinor: 0n, expenditureMinor: 0n };
        if (row.type === "income") bucket.incomeMinor += converted.amountMinor;
        else bucket.expenditureMinor += converted.amountMinor;
        byDay.set(dateKey, bucket);
      }
    } catch {
      throw new AppError(400, "fx_rate_unavailable", "No exchange rate available for this month yet.");
    }

    let maxAbsNetMinor = 0n;
    for (const { incomeMinor, expenditureMinor } of byDay.values()) {
      const net = incomeMinor - expenditureMinor;
      const abs = net < 0n ? -net : net;
      if (abs > maxAbsNetMinor) maxAbsNetMinor = abs;
    }

    let monthIncomeMinor = 0n;
    let monthExpenditureMinor = 0n;

    const days = [...byDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, { incomeMinor, expenditureMinor }]) => {
        const netMinor = incomeMinor - expenditureMinor;
        monthIncomeMinor += incomeMinor;
        monthExpenditureMinor += expenditureMinor;
        return {
          date,
          income_minor: incomeMinor.toString(),
          expenditure_minor: expenditureMinor.toString(),
          net_minor: netMinor.toString(),
          sign: signForNet(netMinor),
          bucket: bucketForNet(netMinor, maxAbsNetMinor),
        };
      });

    res.json({
      month,
      main_currency_code: mainCurrency,
      days,
      month_income_minor: monthIncomeMinor.toString(),
      month_expenditure_minor: monthExpenditureMinor.toString(),
      month_net_minor: (monthIncomeMinor - monthExpenditureMinor).toString(),
    });
  } catch (err) {
    next(err);
  }
});
