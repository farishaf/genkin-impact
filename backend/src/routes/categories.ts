import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { validateQuery } from "../middleware/validateQuery.js";

export const categoriesRouter = Router();

const listQuerySchema = z.object({ kind: z.enum(["expense", "income"]).optional() });

categoriesRouter.get("/", requireAuth, validateQuery(listQuerySchema), async (req, res, next) => {
  try {
    const query = req.validatedQuery as z.infer<typeof listQuerySchema>;
    const conditions = ["user_id = $1", "deleted_at IS NULL"];
    const params: unknown[] = [req.userId];

    if (query.kind) {
      params.push(query.kind);
      conditions.push(`kind = $${params.length}`);
    }

    const result = await pool.query(
      `SELECT id, name, emoji, kind, sort_order FROM categories WHERE ${conditions.join(" AND ")} ORDER BY sort_order`,
      params
    );
    res.json({ categories: result.rows });
  } catch (err) {
    next(err);
  }
});
