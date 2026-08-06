import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { newId } from "../lib/ids.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";

export const membersRouter = Router();

const createMemberSchema = z.object({
  name: z.string().min(1).max(80),
  initials: z.string().min(1).max(4),
  color: z.string().max(20).optional(),
});

membersRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT id, name, initials, color, is_default FROM members WHERE user_id = $1 AND deleted_at IS NULL ORDER BY is_default DESC, name",
      [req.userId]
    );
    res.json({ members: result.rows });
  } catch (err) {
    next(err);
  }
});

membersRouter.post("/", requireAuth, validateBody(createMemberSchema), async (req, res, next) => {
  try {
    const { name, initials, color } = req.body as z.infer<typeof createMemberSchema>;
    const result = await pool.query(
      `INSERT INTO members (id, user_id, name, initials, color) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [newId(), req.userId, name, initials, color ?? null]
    );
    res.status(201).json({ member: result.rows[0] });
  } catch (err) {
    next(err);
  }
});
