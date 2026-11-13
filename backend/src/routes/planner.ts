import { Router } from "express";
import { z } from "zod";
import { pool, withTransaction } from "../db/pool.js";
import { newId } from "../lib/ids.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { validateQuery } from "../middleware/validateQuery.js";
import { AppError } from "../middleware/errorHandler.js";

// Mainichi planner: calendar events (workouts/runs/events), workout routines, daily to-dos, pages.
export const plannerRouter = Router();
plannerRouter.use(requireAuth);

// A malformed id can't match any row; answer 404 instead of letting Postgres reject the cast.
plannerRouter.param("id", (_req, _res, next, id) => {
  next(z.string().uuid().safeParse(id).success ? undefined : new AppError(404, "not_found", "Not found."));
});

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");
const itemId = z.string().min(1).max(64);

const setSchema = z.object({ id: itemId, reps: z.string().max(20), kg: z.string().max(20), done: z.boolean() });
const exerciseSchema = z.object({
  id: itemId,
  name: z.string().max(120),
  note: z.string().max(1000),
  sets: z.array(setSchema).max(50),
  // How each set's `reps` value counts: repetitions, or seconds for holds like a plank. Absent means reps.
  measure: z.enum(["reps", "time"]).optional(),
});
const exercisesSchema = z.array(exerciseSchema).max(60);
const checkItemSchema = z.object({ id: itemId, text: z.string().max(1000), done: z.boolean() });
const todoSchema = checkItemSchema.extend({ page_id: z.string().uuid().nullable() });

// Run structure, Runna-style: each segment is one step (rounds = 1) or a repeat block (rounds > 1).
const runStepSchema = z.object({
  id: itemId,
  kind: z.enum(["warmup", "run", "recovery", "cooldown"]),
  amount: z.string().max(20),
  unit: z.enum(["km", "m", "min", "s"]),
  // Intensity focus: none, a pace range (pace–paceTo, min/km), or a heart-rate range (bpm).
  intensity: z.enum(["none", "pace", "hr"]).optional(),
  pace: z.string().max(40),
  paceTo: z.string().max(20).optional(),
  hrLow: z.string().max(10).optional(),
  hrHigh: z.string().max(10).optional(),
  note: z.string().max(500),
});
const segmentSchema = z.object({ id: itemId, rounds: z.number().int().min(1).max(50), steps: z.array(runStepSchema).min(1).max(10) });

const detailsSchema = z.object({
  segments: z.array(segmentSchema).max(30).optional(),
  // What kind of run this is; drives its drawing. Older runs have none and are guessed from the title.
  runType: z.enum(["easy", "long", "tempo", "intervals", "hills", "threshold"]).optional(),
  km: z.string().max(20).optional(),
  pace: z.string().max(20).optional(),
  detail: z.string().max(2000).optional(),
  routine_id: z.string().uuid().nullable().optional(),
  focus: z.string().max(80).optional(),
  exercises: exercisesSchema.optional(),
  // Logged when a run is marked done: elevation gain in metres and average heart rate in bpm.
  elevation: z.string().max(10).optional(),
  avgHr: z.string().max(10).optional(),
  // Also logged on done, for Fuel's weekly hours and energy out: actual minutes, effort 1–10, device calories (display only for runs).
  duration_min: z.string().max(10).optional(),
  rpe: z.string().max(4).optional(),
  device_kcal: z.string().max(10).optional(),
});

/** UPDATE only the provided columns. Keys come from a zod schema's parsed output, never raw client input. */
async function updateRow(table: string, id: string, userId: string, fields: Record<string, unknown>, jsonColumns: string[]) {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) {
    const current = await pool.query(`SELECT * FROM ${table} WHERE id = $1 AND user_id = $2`, [id, userId]);
    return current.rows[0];
  }
  // pg serializes JS arrays as Postgres arrays, so JSONB values must be stringified explicitly.
  const values = entries.map(([k, v]) => (jsonColumns.includes(k) ? JSON.stringify(v) : v));
  const sets = entries.map(([k], i) => `${k} = $${i + 3}`);
  if (table === "planner_pages") sets.push("updated_at = now()");
  const result = await pool.query(
    `UPDATE ${table} SET ${sets.join(", ")} WHERE id = $1 AND user_id = $2 RETURNING *`,
    [id, userId, ...values]
  );
  return result.rows[0];
}

function freshExercises(exercises: z.infer<typeof exercisesSchema>) {
  return exercises.map((x) => ({ ...x, id: newId(), sets: x.sets.map((s) => ({ ...s, id: newId(), done: false })) }));
}

// ---------- events ----------

const rangeQuery = z.object({ from: dateStr, to: dateStr });

const createEventSchema = z.object({
  date: dateStr,
  type: z.enum(["workout", "run", "event"]),
  title: z.string().min(1).max(200),
  time: z.string().max(20).nullable().optional(),
  notes: z.string().max(20000).optional(),
  details: detailsSchema.optional(),
  // Workout: copy this routine's exercises into the session so ticking sets never edits the template.
  routine_id: z.string().uuid().optional(),
  // Create the same item on this many consecutive weeks (1 = just this date).
  repeat_weeks: z.number().int().min(1).max(26).optional(),
});

const updateEventSchema = z.object({
  date: dateStr.optional(),
  title: z.string().min(1).max(200).optional(),
  time: z.string().max(20).nullable().optional(),
  notes: z.string().max(20000).optional(),
  done: z.boolean().optional(),
  details: detailsSchema.optional(),
});

plannerRouter.get("/events", validateQuery(rangeQuery), async (req, res, next) => {
  try {
    const { from, to } = req.validatedQuery as z.infer<typeof rangeQuery>;
    const result = await pool.query(
      `SELECT * FROM planner_events WHERE user_id = $1 AND date BETWEEN $2 AND $3
       ORDER BY date, time NULLS FIRST, created_at`,
      [req.userId, from, to]
    );
    res.json({ events: result.rows });
  } catch (err) {
    next(err);
  }
});

plannerRouter.get("/events/:id", async (req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM planner_events WHERE id = $1 AND user_id = $2", [req.params.id, req.userId]);
    if (result.rows.length === 0) throw new AppError(404, "not_found", "Event not found.");
    res.json({ event: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

plannerRouter.post("/events", validateBody(createEventSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof createEventSchema>;
    let details: z.infer<typeof detailsSchema> = body.details ?? {};
    if (body.type === "workout" && body.routine_id) {
      const routine = await pool.query("SELECT * FROM planner_routines WHERE id = $1 AND user_id = $2", [body.routine_id, req.userId]);
      if (routine.rows.length === 0) throw new AppError(404, "not_found", "Routine not found.");
      details = { ...details, routine_id: routine.rows[0].id, focus: routine.rows[0].focus, exercises: routine.rows[0].exercises };
    }

    const events = await withTransaction(async (client) => {
      const created = [];
      for (let week = 0; week < (body.repeat_weeks ?? 1); week++) {
        const row = await client.query(
          `INSERT INTO planner_events (id, user_id, date, type, title, time, notes, details)
           VALUES ($1, $2, $3::date + $4::int, $5, $6, $7, $8, $9) RETURNING *`,
          [
            newId(), req.userId, body.date, week * 7, body.type, body.title, body.time ?? null, body.notes ?? "",
            JSON.stringify(details.exercises ? { ...details, exercises: freshExercises(details.exercises) } : details),
          ]
        );
        created.push(row.rows[0]);
      }
      return created;
    });
    res.status(201).json({ events });
  } catch (err) {
    next(err);
  }
});

plannerRouter.patch("/events/:id", validateBody(updateEventSchema), async (req, res, next) => {
  try {
    const event = await updateRow("planner_events", req.params.id as string, req.userId!, req.body, ["details"]);
    if (!event) throw new AppError(404, "not_found", "Event not found.");
    res.json({ event });
  } catch (err) {
    next(err);
  }
});

plannerRouter.delete("/events/:id", async (req, res, next) => {
  try {
    const result = await pool.query("DELETE FROM planner_events WHERE id = $1 AND user_id = $2 RETURNING id", [req.params.id, req.userId]);
    if (result.rows.length === 0) throw new AppError(404, "not_found", "Event not found.");
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ---------- routines ----------

const createRoutineSchema = z.object({
  title: z.string().min(1).max(120),
  focus: z.string().max(80).optional(),
  exercises: exercisesSchema.optional(),
});
const updateRoutineSchema = createRoutineSchema.partial();

plannerRouter.get("/routines", async (req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM planner_routines WHERE user_id = $1 ORDER BY created_at", [req.userId]);
    res.json({ routines: result.rows });
  } catch (err) {
    next(err);
  }
});

plannerRouter.get("/routines/:id", async (req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM planner_routines WHERE id = $1 AND user_id = $2", [req.params.id, req.userId]);
    if (result.rows.length === 0) throw new AppError(404, "not_found", "Routine not found.");
    res.json({ routine: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

plannerRouter.post("/routines", validateBody(createRoutineSchema), async (req, res, next) => {
  try {
    const { title, focus, exercises } = req.body as z.infer<typeof createRoutineSchema>;
    const result = await pool.query(
      "INSERT INTO planner_routines (id, user_id, title, focus, exercises) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [newId(), req.userId, title, focus ?? "", JSON.stringify(exercises ?? [])]
    );
    res.status(201).json({ routine: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

plannerRouter.patch("/routines/:id", validateBody(updateRoutineSchema), async (req, res, next) => {
  try {
    const routine = await updateRow("planner_routines", req.params.id as string, req.userId!, req.body, ["exercises"]);
    if (!routine) throw new AppError(404, "not_found", "Routine not found.");
    res.json({ routine });
  } catch (err) {
    next(err);
  }
});

plannerRouter.delete("/routines/:id", async (req, res, next) => {
  try {
    const result = await pool.query("DELETE FROM planner_routines WHERE id = $1 AND user_id = $2 RETURNING id", [req.params.id, req.userId]);
    if (result.rows.length === 0) throw new AppError(404, "not_found", "Routine not found.");
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ---------- days (to-dos + notes) ----------

const putDaySchema = z.object({ todos: z.array(todoSchema).max(200), notes: z.string().max(20000) });

plannerRouter.get("/days/:date", async (req, res, next) => {
  try {
    const date = dateStr.safeParse(req.params.date);
    if (!date.success) throw new AppError(400, "validation_error", "date must be YYYY-MM-DD");
    const result = await pool.query("SELECT date, todos, notes FROM planner_days WHERE user_id = $1 AND date = $2", [req.userId, date.data]);
    res.json({ day: result.rows[0] ?? { date: date.data, todos: [], notes: "" } });
  } catch (err) {
    next(err);
  }
});

plannerRouter.put("/days/:date", validateBody(putDaySchema), async (req, res, next) => {
  try {
    const date = dateStr.safeParse(req.params.date);
    if (!date.success) throw new AppError(400, "validation_error", "date must be YYYY-MM-DD");
    const { todos, notes } = req.body as z.infer<typeof putDaySchema>;
    const result = await pool.query(
      `INSERT INTO planner_days (user_id, date, todos, notes) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, date) DO UPDATE SET todos = EXCLUDED.todos, notes = EXCLUDED.notes
       RETURNING date, todos, notes`,
      [req.userId, date.data, JSON.stringify(todos), notes]
    );
    res.json({ day: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ---------- goals (long-term, one list per user) ----------

const putGoalsSchema = z.object({
  goals: z.array(z.object({ id: itemId, title: z.string().max(200), note: z.string().max(2000) })).max(20),
});

plannerRouter.get("/goals", async (req, res, next) => {
  try {
    const result = await pool.query("SELECT goals FROM planner_goals WHERE user_id = $1", [req.userId]);
    res.json({ goals: result.rows[0]?.goals ?? [] });
  } catch (err) {
    next(err);
  }
});

plannerRouter.put("/goals", validateBody(putGoalsSchema), async (req, res, next) => {
  try {
    const { goals } = req.body as z.infer<typeof putGoalsSchema>;
    const result = await pool.query(
      `INSERT INTO planner_goals (user_id, goals) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET goals = EXCLUDED.goals
       RETURNING goals`,
      [req.userId, JSON.stringify(goals)]
    );
    res.json({ goals: result.rows[0].goals });
  } catch (err) {
    next(err);
  }
});

// ---------- pages ----------

const createPageSchema = z.object({ title: z.string().max(200).optional(), icon: z.string().min(1).max(16).optional() });
const updatePageSchema = z.object({
  icon: z.string().min(1).max(16).optional(),
  title: z.string().max(200).optional(),
  description: z.string().max(5000).optional(),
  checklist: z.array(checkItemSchema).max(300).optional(),
  notes: z.string().max(50000).optional(),
});

plannerRouter.get("/pages", async (req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM planner_pages WHERE user_id = $1 ORDER BY updated_at DESC", [req.userId]);
    res.json({ pages: result.rows });
  } catch (err) {
    next(err);
  }
});

plannerRouter.get("/pages/:id", async (req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM planner_pages WHERE id = $1 AND user_id = $2", [req.params.id, req.userId]);
    if (result.rows.length === 0) throw new AppError(404, "not_found", "Page not found.");
    res.json({ page: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

plannerRouter.post("/pages", validateBody(createPageSchema), async (req, res, next) => {
  try {
    const { title, icon } = req.body as z.infer<typeof createPageSchema>;
    const result = await pool.query(
      "INSERT INTO planner_pages (id, user_id, title, icon) VALUES ($1, $2, $3, COALESCE($4, '📄')) RETURNING *",
      [newId(), req.userId, title ?? "", icon ?? null]
    );
    res.status(201).json({ page: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

plannerRouter.patch("/pages/:id", validateBody(updatePageSchema), async (req, res, next) => {
  try {
    const page = await updateRow("planner_pages", req.params.id as string, req.userId!, req.body, ["checklist"]);
    if (!page) throw new AppError(404, "not_found", "Page not found.");
    res.json({ page });
  } catch (err) {
    next(err);
  }
});

plannerRouter.delete("/pages/:id", async (req, res, next) => {
  try {
    await withTransaction(async (client) => {
      const result = await client.query("DELETE FROM planner_pages WHERE id = $1 AND user_id = $2 RETURNING id", [req.params.id, req.userId]);
      if (result.rows.length === 0) throw new AppError(404, "not_found", "Page not found.");
      // Unlink to-dos that pointed at the deleted page.
      await client.query(
        `UPDATE planner_days
         SET todos = (SELECT jsonb_agg(CASE WHEN t->>'page_id' = $1 THEN t || '{"page_id": null}' ELSE t END)
                      FROM jsonb_array_elements(todos) t)
         WHERE user_id = $2 AND todos @> jsonb_build_array(jsonb_build_object('page_id', $1::text))`,
        [req.params.id, req.userId]
      );
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
