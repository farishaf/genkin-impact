import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { newId } from "../lib/ids.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { AppError } from "../middleware/errorHandler.js";

export const savedFiltersRouter = Router();

const criteriaSchema = z.object({
  type: z.enum(["expense", "income", "transfer"]).optional(),
  member_id: z.string().uuid().optional(),
  tag_id: z.string().uuid().optional(),
  category_id: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const createSavedFilterSchema = z.object({
  name: z.string().min(1).max(80),
  criteria: criteriaSchema,
});

savedFiltersRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT id, name, criteria, sort_order FROM saved_filters WHERE user_id = $1 ORDER BY sort_order, created_at",
      [req.userId]
    );
    res.json({ saved_filters: result.rows });
  } catch (err) {
    next(err);
  }
});

savedFiltersRouter.post("/", requireAuth, validateBody(createSavedFilterSchema), async (req, res, next) => {
  try {
    const { name, criteria } = req.body as z.infer<typeof createSavedFilterSchema>;
    const maxOrderRes = await pool.query("SELECT COALESCE(MAX(sort_order), -1) AS max FROM saved_filters WHERE user_id = $1", [req.userId]);
    const sortOrder = Number(maxOrderRes.rows[0].max) + 1;
    const result = await pool.query(
      `INSERT INTO saved_filters (id, user_id, name, criteria, sort_order) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, criteria, sort_order`,
      [newId(), req.userId, name, criteria, sortOrder]
    );
    res.status(201).json({ saved_filter: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

savedFiltersRouter.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query("DELETE FROM saved_filters WHERE id = $1 AND user_id = $2 RETURNING id", [req.params.id, req.userId]);
    if (result.rows.length === 0) throw new AppError(404, "not_found", "Saved filter not found.");
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
