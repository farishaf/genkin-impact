import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { AppError } from "../middleware/errorHandler.js";

export const usersRouter = Router();

const setCurrencySchema = z.object({ main_currency_code: z.string().length(3) });

usersRouter.patch("/me", requireAuth, validateBody(setCurrencySchema), async (req, res, next) => {
  try {
    const { main_currency_code } = req.body as z.infer<typeof setCurrencySchema>;
    const currency = await pool.query("SELECT code FROM currencies WHERE code = $1 AND is_active = true", [main_currency_code]);
    if (currency.rows.length === 0) throw new AppError(400, "invalid_currency", "Unknown currency code.");

    const result = await pool.query(
      `UPDATE users SET main_currency_code = $1 WHERE id = $2 AND deleted_at IS NULL RETURNING id, main_currency_code`,
      [main_currency_code, req.userId]
    );
    if (result.rows.length === 0) throw new AppError(401, "unauthenticated", "User not found.");
    res.json({ user: result.rows[0] });
  } catch (err) {
    next(err);
  }
});
