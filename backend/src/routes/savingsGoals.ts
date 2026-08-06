import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { newId } from "../lib/ids.js";
import { parseToMinor, formatMinor } from "../lib/money.js";
import { computeSavingsProgress } from "../lib/savingsProgress.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { AppError } from "../middleware/errorHandler.js";

export const savingsGoalsRouter = Router();

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date in YYYY-MM-DD format");

const createGoalSchema = z.object({
  name: z.string().min(1).max(80),
  emoji: z.string().max(8).nullable().optional(),
  account_id: z.string().uuid().nullable().optional(),
  target_amount: z.string().regex(/^\d+(\.\d+)?$/, "target_amount must be a plain decimal string"),
  currency_code: z.string().length(3),
  target_date: dateOnlySchema.nullable().optional(),
});

const updateGoalSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  emoji: z.string().max(8).nullable().optional(),
  target_amount: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  target_date: dateOnlySchema.nullable().optional(),
  status: z.enum(["active", "achieved", "archived"]).optional(),
});

const contributeSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d+)?$/, "amount must be a plain decimal string"),
});

savingsGoalsRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT g.*, c.symbol, c.decimal_digits, a.name AS account_name, a.cached_balance AS account_balance, a.opening_balance AS account_opening_balance
       FROM savings_goals g
       JOIN currencies c ON c.code = g.currency_code
       LEFT JOIN accounts a ON a.id = g.account_id
       WHERE g.user_id = $1 AND g.status != 'archived'
       ORDER BY g.created_at`,
      [req.userId]
    );

    const goals = result.rows.map((g) => {
      const progress = computeSavingsProgress({
        targetMinor: BigInt(g.target_amount),
        linkedToAccount: g.account_id !== null,
        contributedMinor: BigInt(g.contributed_amount),
        accountBalanceMinor: g.account_balance !== null ? BigInt(g.account_balance) : undefined,
        accountOpeningBalanceMinor: g.account_opening_balance !== null ? BigInt(g.account_opening_balance) : undefined,
      });

      return {
        ...g,
        target_minor: progress.targetMinor.toString(),
        progress_minor: progress.progressMinor.toString(),
        pct: progress.pct,
        achieved: progress.achieved,
        target_display: formatMinor(progress.targetMinor, g.decimal_digits, g.symbol),
        progress_display: formatMinor(progress.progressMinor, g.decimal_digits, g.symbol),
      };
    });

    res.json({ savings_goals: goals });
  } catch (err) {
    next(err);
  }
});

savingsGoalsRouter.post("/", requireAuth, validateBody(createGoalSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof createGoalSchema>;

    let currencyCode = body.currency_code;
    if (body.account_id) {
      const accountRes = await pool.query(
        "SELECT currency_code FROM accounts WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
        [body.account_id, req.userId]
      );
      if (accountRes.rows.length === 0) throw new AppError(400, "invalid_account", "Account not found.");
      currencyCode = accountRes.rows[0].currency_code;
    }

    const currencyRes = await pool.query("SELECT decimal_digits FROM currencies WHERE code = $1 AND is_active = true", [currencyCode]);
    if (currencyRes.rows.length === 0) throw new AppError(400, "invalid_currency", "Unknown currency code.");

    let targetMinor: bigint;
    try {
      targetMinor = parseToMinor(body.target_amount, currencyRes.rows[0].decimal_digits);
    } catch {
      throw new AppError(400, "invalid_amount", `target_amount has more decimal places than ${currencyCode} supports.`);
    }
    if (targetMinor <= 0n) throw new AppError(400, "invalid_amount", "target_amount must be positive.");

    const id = newId();
    const inserted = await pool.query(
      `INSERT INTO savings_goals (id, user_id, account_id, name, emoji, target_amount, currency_code, target_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [id, req.userId, body.account_id ?? null, body.name, body.emoji ?? null, targetMinor, currencyCode, body.target_date ?? null]
    );

    res.status(201).json({ savings_goal: inserted.rows[0] });
  } catch (err) {
    next(err);
  }
});

savingsGoalsRouter.patch("/:id", requireAuth, validateBody(updateGoalSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof updateGoalSchema>;
    const existing = await pool.query("SELECT * FROM savings_goals WHERE id = $1 AND user_id = $2", [req.params.id, req.userId]);
    if (existing.rows.length === 0) throw new AppError(404, "not_found", "Savings goal not found.");

    let targetMinor: bigint | undefined;
    if (body.target_amount !== undefined) {
      const currencyRes = await pool.query("SELECT decimal_digits FROM currencies WHERE code = $1", [existing.rows[0].currency_code]);
      try {
        targetMinor = parseToMinor(body.target_amount, currencyRes.rows[0].decimal_digits);
      } catch {
        throw new AppError(400, "invalid_amount", "target_amount has more decimal places than this goal's currency supports.");
      }
      if (targetMinor <= 0n) throw new AppError(400, "invalid_amount", "target_amount must be positive.");
    }

    const updated = await pool.query(
      `UPDATE savings_goals SET
         name = COALESCE($1, name),
         emoji = COALESCE($2, emoji),
         target_amount = COALESCE($3, target_amount),
         target_date = COALESCE($4, target_date),
         status = COALESCE($5, status)
       WHERE id = $6 AND user_id = $7
       RETURNING *`,
      [body.name ?? null, body.emoji ?? null, targetMinor ?? null, body.target_date ?? null, body.status ?? null, req.params.id, req.userId]
    );

    res.json({ savings_goal: updated.rows[0] });
  } catch (err) {
    next(err);
  }
});

savingsGoalsRouter.post("/:id/contribute", requireAuth, validateBody(contributeSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof contributeSchema>;
    const existing = await pool.query("SELECT g.*, c.decimal_digits FROM savings_goals g JOIN currencies c ON c.code = g.currency_code WHERE g.id = $1 AND g.user_id = $2", [
      req.params.id,
      req.userId,
    ]);
    if (existing.rows.length === 0) throw new AppError(404, "not_found", "Savings goal not found.");
    const goal = existing.rows[0];
    if (goal.account_id !== null) throw new AppError(400, "goal_is_account_linked", "This goal tracks an account balance and can't take manual contributions.");

    let amountMinor: bigint;
    try {
      amountMinor = parseToMinor(body.amount, goal.decimal_digits);
    } catch {
      throw new AppError(400, "invalid_amount", "amount has more decimal places than this goal's currency supports.");
    }
    if (amountMinor <= 0n) throw new AppError(400, "invalid_amount", "amount must be positive.");

    const newContributed = BigInt(goal.contributed_amount) + amountMinor;
    const newStatus = goal.status === "active" && newContributed >= BigInt(goal.target_amount) ? "achieved" : goal.status;

    const updated = await pool.query(
      "UPDATE savings_goals SET contributed_amount = $1, status = $2 WHERE id = $3 RETURNING *",
      [newContributed, newStatus, goal.id]
    );

    res.json({ savings_goal: updated.rows[0] });
  } catch (err) {
    next(err);
  }
});

savingsGoalsRouter.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      "UPDATE savings_goals SET status = 'archived' WHERE id = $1 AND user_id = $2 RETURNING id",
      [req.params.id, req.userId]
    );
    if (result.rows.length === 0) throw new AppError(404, "not_found", "Savings goal not found.");
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
