import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { newId } from "../lib/ids.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { validateQuery } from "../middleware/validateQuery.js";
import { AppError } from "../middleware/errorHandler.js";

export const categoriesRouter = Router();

const listQuerySchema = z.object({ kind: z.enum(["expense", "income"]).optional() });
const createCategorySchema = z.object({
  name: z.string().min(1).max(80),
  emoji: z.string().max(8).optional(),
  kind: z.enum(["expense", "income"]),
});
const updateCategorySchema = z.object({
  name: z.string().min(1).max(80).optional(),
  emoji: z.string().max(8).optional(),
});

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

categoriesRouter.post("/", requireAuth, validateBody(createCategorySchema), async (req, res, next) => {
  try {
    const { name, emoji, kind } = req.body as z.infer<typeof createCategorySchema>;
    const result = await pool.query(
      `INSERT INTO categories (id, user_id, parent_id, name, emoji, kind, is_system)
       VALUES ($1, $2, NULL, $3, $4, $5, false) RETURNING id, name, emoji, kind, sort_order, is_system`,
      [newId(), req.userId, name, emoji ?? null, kind]
    );
    res.status(201).json({ category: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

categoriesRouter.patch("/:id", requireAuth, validateBody(updateCategorySchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof updateCategorySchema>;
    const result = await pool.query(
      `UPDATE categories SET name = COALESCE($1, name), emoji = COALESCE($2, emoji)
       WHERE id = $3 AND user_id = $4 AND deleted_at IS NULL
       RETURNING id, name, emoji, kind, sort_order, is_system`,
      [body.name ?? null, body.emoji ?? null, req.params.id, req.userId]
    );
    if (result.rows.length === 0) throw new AppError(404, "not_found", "Category not found.");
    res.json({ category: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

categoriesRouter.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const existing = await pool.query("SELECT is_system FROM categories WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL", [
      req.params.id,
      req.userId,
    ]);
    if (existing.rows.length === 0) throw new AppError(404, "not_found", "Category not found.");
    if (existing.rows[0].is_system) throw new AppError(400, "system_category", "Built-in categories can't be deleted.");

    await pool.query("UPDATE categories SET deleted_at = now() WHERE id = $1 AND user_id = $2", [req.params.id, req.userId]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
