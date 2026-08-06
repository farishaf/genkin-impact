import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { newId } from "../lib/ids.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";

export const tagsRouter = Router();

const createTagSchema = z.object({
  name: z.string().min(1).max(80),
  color: z.string().max(20).optional(),
});

tagsRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT id, name, color, parent_id FROM tags WHERE user_id = $1 AND deleted_at IS NULL ORDER BY name",
      [req.userId]
    );
    res.json({ tags: result.rows });
  } catch (err) {
    next(err);
  }
});

tagsRouter.post("/", requireAuth, validateBody(createTagSchema), async (req, res, next) => {
  try {
    const { name, color } = req.body as z.infer<typeof createTagSchema>;
    const result = await pool.query(
      `INSERT INTO tags (id, user_id, parent_id, name, color) VALUES ($1, $2, NULL, $3, $4) RETURNING *`,
      [newId(), req.userId, name, color ?? null]
    );
    res.status(201).json({ tag: result.rows[0] });
  } catch (err) {
    next(err);
  }
});
