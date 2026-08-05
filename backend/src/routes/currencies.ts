import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";

export const currenciesRouter = Router();

currenciesRouter.get("/", requireAuth, async (_req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT code, name, symbol, decimal_digits FROM currencies WHERE is_active = true ORDER BY code"
    );
    res.json({ currencies: result.rows });
  } catch (err) {
    next(err);
  }
});
