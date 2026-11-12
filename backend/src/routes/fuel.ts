import { Router } from "express";
import { z } from "zod";
import { pool, withTransaction } from "../db/pool.js";
import { env } from "../env.js";
import { newId } from "../lib/ids.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { validateQuery } from "../middleware/validateQuery.js";
import { AppError } from "../middleware/errorHandler.js";
import { withDefaults, type DayType, type FuelConfig } from "../lib/fuel/config.js";
import { checkReading, defaultContext, deriveReading, localHour } from "../lib/fuel/body.js";
import {
  addDaysKey, dailyMeans, dayTargets, estimateMaintenance, inferDayType, movingAverage, trainingLoad, weekStartKey,
  weeklyBodyFat, type PlannerEventLike,
} from "../lib/fuel/energy.js";
import { entryTotals, looksSweet, parseOffProduct } from "../lib/fuel/nutrition.js";

// Fuel: nutrition, body composition and recovery. Training comes from planner_events (runs and workouts).
// Health data never goes to logs: errors log status codes only.
export const fuelRouter = Router();
fuelRouter.use(requireAuth);

fuelRouter.param("id", (_req, _res, next, id) => {
  next(z.string().uuid().safeParse(id).success ? undefined : new AppError(404, "not_found", "Not found."));
});

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");
const rangeQuery = z.object({ from: dateStr, to: dateStr });
const n = (lo: number, hi: number) => z.number().min(lo).max(hi);
const opt = (lo: number, hi: number) => n(lo, hi).nullable().optional();

// ---------- profile ----------

const PROFILE_DEFAULTS = { height_cm: 169, sex: "male", birth_year: 2001, goal_profile: "mileage_fueling", maintenance_override_kcal: null, config: {} };

async function loadProfile(userId: string) {
  const row = (await pool.query("SELECT * FROM fuel_profiles WHERE user_id = $1", [userId])).rows[0] ?? PROFILE_DEFAULTS;
  return { ...row, config: withDefaults(row.config) };
}

const profileSchema = z.object({
  height_cm: n(100, 250),
  sex: z.enum(["male", "female"]),
  birth_year: z.number().int().min(1920).max(2020),
  goal_profile: z.enum(["mileage_fueling", "fat_loss_endurance", "lean_gain"]),
  maintenance_override_kcal: z.number().int().min(1000).max(6000).nullable(),
  // Only known keys are kept; values are re-checked loosely since they are the user's own tuning.
  config: z
    .object({
      race_date: dateStr.nullable(),
      taper_weeks: z.number().int().min(0).max(6),
      sweets_kcal_cap_pct: n(0, 50),
      daily_activity_kcal: n(0, 1500),
      long_run_km: n(5, 60),
      fat_floor_pct: n(15, 40),
      fiber_target_g: n(0, 80),
      allow_deficit_below_floor: z.boolean(),
      day_type_weights: z.object({ rest: n(0.7, 1.3), easy: n(0.7, 1.3), hard: n(0.7, 1.5) }),
      sweet_keywords: z.array(z.string().min(1).max(40)).max(100),
    })
    .partial(),
});

fuelRouter.get("/profile", async (req, res, next) => {
  try {
    res.json({ profile: await loadProfile(req.userId!) });
  } catch (err) {
    next(err);
  }
});

fuelRouter.put("/profile", validateBody(profileSchema), async (req, res, next) => {
  try {
    const p = req.body as z.infer<typeof profileSchema>;
    await pool.query(
      `INSERT INTO fuel_profiles (user_id, height_cm, sex, birth_year, goal_profile, maintenance_override_kcal, config)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) DO UPDATE SET height_cm = EXCLUDED.height_cm, sex = EXCLUDED.sex, birth_year = EXCLUDED.birth_year,
         goal_profile = EXCLUDED.goal_profile, maintenance_override_kcal = EXCLUDED.maintenance_override_kcal, config = EXCLUDED.config`,
      [req.userId, p.height_cm, p.sex, p.birth_year, p.goal_profile, p.maintenance_override_kcal, JSON.stringify(p.config)]
    );
    res.json({ profile: await loadProfile(req.userId!) });
  } catch (err) {
    next(err);
  }
});

// ---------- body readings ----------

const segment = z.object({ right_arm: opt(0, 60), left_arm: opt(0, 60), trunk: opt(0, 100), right_leg: opt(0, 60), left_leg: opt(0, 60) }).partial();
const readingSchema = z.object({
  measured_at: z.iso.datetime({ offset: true }),
  weight_kg: n(1, 400),
  body_fat_pct: opt(0, 100),
  body_fat_mass_kg: opt(0, 300),
  skeletal_muscle_mass_kg: opt(0, 200),
  body_water_pct: opt(0, 100),
  protein_mass_kg: opt(0, 100),
  protein_pct: opt(0, 100),
  bone_mass_kg: opt(0, 20),
  visceral_fat_index: opt(0, 100),
  subcutaneous_fat_pct: opt(0, 100),
  bmr_kcal: z.number().int().min(0).max(10000).nullable().optional(),
  limb_muscle_index: opt(0, 50),
  muscle_rate_pct: opt(0, 100),
  body_age: z.number().int().min(0).max(150).nullable().optional(),
  bmi: opt(0, 100),
  segmental: z.object({ fat: segment, muscle: segment }).partial().nullable().optional(),
  context: z.enum(["fasted_morning", "post_run", "other"]).optional(),
  // Save despite warnings (the user saw them on the confirm step).
  force: z.boolean().optional(),
});

const READING_COLUMNS = [
  "weight_kg", "body_fat_pct", "body_fat_mass_kg", "skeletal_muscle_mass_kg", "body_water_pct", "protein_mass_kg", "protein_pct",
  "bone_mass_kg", "visceral_fat_index", "subcutaneous_fat_pct", "bmr_kcal", "limb_muscle_index", "muscle_rate_pct", "body_age", "bmi",
] as const;

async function userTimezone(userId: string): Promise<string> {
  return (await pool.query("SELECT timezone FROM users WHERE id = $1", [userId])).rows[0]?.timezone ?? "UTC";
}

fuelRouter.get("/body", validateQuery(rangeQuery), async (req, res, next) => {
  try {
    const { from, to } = req.validatedQuery as z.infer<typeof rangeQuery>;
    const tz = await userTimezone(req.userId!);
    const result = await pool.query(
      `SELECT *, (measured_at AT TIME ZONE $4)::date AS date FROM body_readings
       WHERE user_id = $1 AND (measured_at AT TIME ZONE $4)::date BETWEEN $2 AND $3 ORDER BY measured_at DESC`,
      [req.userId, from, to, tz]
    );
    res.json({ readings: result.rows });
  } catch (err) {
    next(err);
  }
});

fuelRouter.post("/body", validateBody(readingSchema), async (req, res, next) => {
  try {
    const { force, context, segmental, ...input } = req.body as z.infer<typeof readingSchema>;
    const [profile, tz, prev] = await Promise.all([
      loadProfile(req.userId!),
      userTimezone(req.userId!),
      pool.query("SELECT weight_kg, body_fat_pct FROM body_readings WHERE user_id = $1 AND measured_at < $2 ORDER BY measured_at DESC LIMIT 1", [req.userId, input.measured_at]),
    ]);
    const issues = checkReading(input, profile.height_cm, prev.rows[0]);
    const errors = issues.filter((i) => i.level === "error");
    if (errors.length) throw new AppError(400, "validation_error", errors.map((i) => i.message).join(" "));
    if (issues.length && !force) throw new AppError(409, "needs_confirm", issues.map((i) => i.message).join(" "));

    const r = deriveReading(input);
    const ctx = context ?? defaultContext(localHour(new Date(r.measured_at), tz));
    const values = READING_COLUMNS.map((c) => r[c] ?? null);
    const inserted = await pool.query(
      `INSERT INTO body_readings (id, user_id, measured_at, ${READING_COLUMNS.join(", ")}, segmental, context, source, origin, raw)
       VALUES ($1, $2, $3, ${READING_COLUMNS.map((_, i) => `$${i + 4}`).join(", ")}, $19, $20, 'manual', '', $21)
       ON CONFLICT (user_id, measured_at, source, origin) DO NOTHING RETURNING *`,
      [newId(), req.userId, r.measured_at, ...values, segmental ? JSON.stringify(segmental) : null, ctx, JSON.stringify(req.body)]
    );
    if (inserted.rows[0]) {
      res.status(201).json({ reading: inserted.rows[0], duplicate: false });
      return;
    }
    const existing = await pool.query("SELECT * FROM body_readings WHERE user_id = $1 AND measured_at = $2 AND source = 'manual' AND origin = ''", [req.userId, r.measured_at]);
    res.json({ reading: existing.rows[0], duplicate: true });
  } catch (err) {
    next(err);
  }
});

fuelRouter.patch("/body/:id", validateBody(z.object({ context: z.enum(["fasted_morning", "post_run", "other"]) })), async (req, res, next) => {
  try {
    const result = await pool.query("UPDATE body_readings SET context = $3 WHERE id = $1 AND user_id = $2 RETURNING *", [req.params.id, req.userId, req.body.context]);
    if (!result.rows[0]) throw new AppError(404, "not_found", "Reading not found.");
    res.json({ reading: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ---------- tape measurements ----------

const tapeSchema = z.object({ date: dateStr, waist_cm: opt(30, 250), chest_cm: opt(30, 250), arm_cm: opt(10, 100), thigh_cm: opt(20, 150) });

fuelRouter.get("/tape", async (req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM tape_measurements WHERE user_id = $1 ORDER BY date DESC LIMIT 50", [req.userId]);
    res.json({ measurements: result.rows });
  } catch (err) {
    next(err);
  }
});

fuelRouter.post("/tape", validateBody(tapeSchema), async (req, res, next) => {
  try {
    const t = req.body as z.infer<typeof tapeSchema>;
    const result = await pool.query(
      "INSERT INTO tape_measurements (id, user_id, date, waist_cm, chest_cm, arm_cm, thigh_cm) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
      [newId(), req.userId, t.date, t.waist_cm ?? null, t.chest_cm ?? null, t.arm_cm ?? null, t.thigh_cm ?? null]
    );
    res.status(201).json({ measurement: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ---------- foods ----------

const per100 = {
  kcal_100g: n(0, 900),
  protein_100g: n(0, 100),
  carbs_100g: n(0, 100),
  fat_100g: n(0, 100),
  fiber_100g: opt(0, 100),
  sugar_100g: opt(0, 100),
};
const foodSchema = z.object({
  name: z.string().trim().min(1).max(200),
  barcode: z.string().regex(/^\d{6,14}$/).nullable().optional(),
  ...per100,
  serving_g: opt(0, 5000),
  is_sweet: z.boolean().optional(),
  source: z.enum(["manual", "barcode", "label", "usda", "estimated"]).optional(),
});

fuelRouter.get("/foods", validateQuery(z.object({ q: z.string().max(100).optional() })), async (req, res, next) => {
  try {
    const { q } = req.validatedQuery as { q?: string };
    // Most recently eaten first, so the usual foods are one tap away.
    const result = await pool.query(
      `SELECT f.*, (SELECT max(e.eaten_at) FROM food_entries e WHERE e.food_id = f.id) AS last_eaten
       FROM foods f WHERE f.user_id = $1 AND ($2::text IS NULL OR f.name ILIKE '%' || $2 || '%')
       ORDER BY last_eaten DESC NULLS LAST, f.name LIMIT 40`,
      [req.userId, q?.trim() || null]
    );
    res.json({ foods: result.rows });
  } catch (err) {
    next(err);
  }
});

fuelRouter.post("/foods", validateBody(foodSchema), async (req, res, next) => {
  try {
    const f = req.body as z.infer<typeof foodSchema>;
    const cfg = (await loadProfile(req.userId!)).config;
    const result = await pool.query(
      `INSERT INTO foods (id, user_id, name, barcode, kcal_100g, protein_100g, carbs_100g, fat_100g, fiber_100g, sugar_100g, serving_g, is_sweet, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [
        newId(), req.userId, f.name, f.barcode ?? null, f.kcal_100g, f.protein_100g, f.carbs_100g, f.fat_100g, f.fiber_100g ?? null,
        f.sugar_100g ?? null, f.serving_g ?? null, f.is_sweet ?? looksSweet(f.name, f.sugar_100g, cfg), f.source ?? "manual",
      ]
    );
    res.status(201).json({ food: result.rows[0] });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") next(new AppError(409, "duplicate", "A food with that barcode is already saved."));
    else next(err);
  }
});

fuelRouter.patch("/foods/:id", validateBody(foodSchema.partial()), async (req, res, next) => {
  try {
    const entries = Object.entries(req.body as Record<string, unknown>).filter(([, v]) => v !== undefined);
    if (!entries.length) throw new AppError(400, "validation_error", "Nothing to update.");
    // Keys come from the zod schema's parsed output, never raw client input.
    const result = await pool.query(
      `UPDATE foods SET ${entries.map(([k], i) => `${k} = $${i + 3}`).join(", ")} WHERE id = $1 AND user_id = $2 RETURNING *`,
      [req.params.id, req.userId, ...entries.map(([, v]) => v)]
    );
    if (!result.rows[0]) throw new AppError(404, "not_found", "Food not found.");
    res.json({ food: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

fuelRouter.delete("/foods/:id", async (req, res, next) => {
  try {
    const result = await pool.query("DELETE FROM foods WHERE id = $1 AND user_id = $2 RETURNING id", [req.params.id, req.userId]);
    if (!result.rows[0]) throw new AppError(404, "not_found", "Food not found.");
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/** A saved food by barcode, else Open Food Facts (not saved until the user confirms it). */
fuelRouter.get("/barcode/:code", async (req, res, next) => {
  try {
    const code = req.params.code as string;
    if (!/^\d{6,14}$/.test(code)) throw new AppError(400, "validation_error", "A barcode is 6–14 digits.");
    const saved = await pool.query("SELECT * FROM foods WHERE user_id = $1 AND barcode = $2", [req.userId, code]);
    if (saved.rows[0]) {
      res.json({ food: saved.rows[0], saved: true, missing: [] });
      return;
    }
    const off = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,nutriments,serving_quantity`, {
      headers: { "User-Agent": env.OFF_USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {
      throw new AppError(504, "lookup_failed", "Couldn't reach Open Food Facts. Enter it by hand.");
    });
    if (off.status === 404) throw new AppError(404, "not_found", "Not in Open Food Facts. Enter it by hand.");
    if (!off.ok) {
      console.error(`barcode lookup: Open Food Facts returned ${off.status}`);
      throw new AppError(502, "lookup_failed", "Open Food Facts failed. Enter it by hand.");
    }
    const parsed = parseOffProduct(code, await off.json().catch(() => null));
    if (!parsed) throw new AppError(404, "not_found", "Not in Open Food Facts. Enter it by hand.");
    const cfg = (await loadProfile(req.userId!)).config;
    res.json({ food: { ...parsed.food, is_sweet: looksSweet(parsed.food.name, parsed.food.sugar_100g, cfg), source: "barcode" }, saved: false, missing: parsed.missing });
  } catch (err) {
    next(err);
  }
});

// ---------- food entries ----------

const entrySchema = z.object({
  date: dateStr,
  eaten_at: z.iso.datetime({ offset: true }).optional(),
  grams: n(0.1, 5000),
  // Either a saved food, or a one-off item with its own per-100g values.
  food_id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  ...z.object(per100).partial().shape,
  is_sweet: z.boolean().optional(),
  is_planned: z.boolean().optional(),
});
const patchEntrySchema = z.object({ grams: n(0.1, 5000).optional(), name: z.string().trim().min(1).max(200).optional(), is_sweet: z.boolean().optional(), is_planned: z.boolean().optional() });

const ENTRY_INSERT = `INSERT INTO food_entries (id, user_id, date, eaten_at, food_id, name, grams, kcal_100g, protein_100g, carbs_100g, fat_100g, fiber_100g, sugar_100g,
  kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g, is_sweet, is_planned, source)
  VALUES ($1, $2, $3, COALESCE($4, now()), $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22) RETURNING *`;

type Snapshot = { name: string; kcal_100g: number; protein_100g: number; carbs_100g: number; fat_100g: number; fiber_100g: number | null; sugar_100g: number | null };
const entryValues = (p: Snapshot, grams: number) => {
  const t = entryTotals(p, grams);
  return [p.name, grams, p.kcal_100g, p.protein_100g, p.carbs_100g, p.fat_100g, p.fiber_100g, p.sugar_100g, t.kcal, t.protein_g, t.carbs_g, t.fat_g, t.fiber_g, t.sugar_g];
};

fuelRouter.get("/entries", validateQuery(z.object({ date: dateStr })), async (req, res, next) => {
  try {
    const { date } = req.validatedQuery as { date: string };
    const result = await pool.query("SELECT * FROM food_entries WHERE user_id = $1 AND date = $2 ORDER BY eaten_at, created_at", [req.userId, date]);
    res.json({ entries: result.rows });
  } catch (err) {
    next(err);
  }
});

fuelRouter.post("/entries", validateBody(entrySchema), async (req, res, next) => {
  try {
    const e = req.body as z.infer<typeof entrySchema>;
    let snap: Snapshot;
    let sweet: boolean;
    if (e.food_id) {
      const food = (await pool.query("SELECT * FROM foods WHERE id = $1 AND user_id = $2", [e.food_id, req.userId])).rows[0];
      if (!food) throw new AppError(404, "not_found", "Food not found.");
      snap = { ...food, name: e.name ?? food.name };
      sweet = e.is_sweet ?? food.is_sweet;
    } else {
      if (!e.name || e.kcal_100g === undefined) throw new AppError(400, "validation_error", "Give a food, or a name and kcal per 100 g.");
      snap = { name: e.name, kcal_100g: e.kcal_100g, protein_100g: e.protein_100g ?? 0, carbs_100g: e.carbs_100g ?? 0, fat_100g: e.fat_100g ?? 0, fiber_100g: e.fiber_100g ?? null, sugar_100g: e.sugar_100g ?? null };
      sweet = e.is_sweet ?? looksSweet(e.name, e.sugar_100g, (await loadProfile(req.userId!)).config);
    }
    const result = await pool.query(ENTRY_INSERT, [
      newId(), req.userId, e.date, e.eaten_at ?? null, e.food_id ?? null, ...entryValues(snap, e.grams), sweet, e.is_planned ?? false, e.food_id ? "saved" : "manual",
    ]);
    res.status(201).json({ entry: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

fuelRouter.patch("/entries/:id", validateBody(patchEntrySchema), async (req, res, next) => {
  try {
    const p = req.body as z.infer<typeof patchEntrySchema>;
    const cur = (await pool.query("SELECT * FROM food_entries WHERE id = $1 AND user_id = $2", [req.params.id, req.userId])).rows[0];
    if (!cur) throw new AppError(404, "not_found", "Entry not found.");
    const grams = p.grams ?? cur.grams;
    const t = entryTotals(cur, grams);
    const result = await pool.query(
      `UPDATE food_entries SET name = $3, grams = $4, kcal = $5, protein_g = $6, carbs_g = $7, fat_g = $8, fiber_g = $9, sugar_g = $10, is_sweet = $11, is_planned = $12
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [req.params.id, req.userId, p.name ?? cur.name, grams, t.kcal, t.protein_g, t.carbs_g, t.fat_g, t.fiber_g, t.sugar_g, p.is_sweet ?? cur.is_sweet, p.is_planned ?? cur.is_planned]
    );
    res.json({ entry: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

fuelRouter.delete("/entries/:id", async (req, res, next) => {
  try {
    const result = await pool.query("DELETE FROM food_entries WHERE id = $1 AND user_id = $2 RETURNING id", [req.params.id, req.userId]);
    if (!result.rows[0]) throw new AppError(404, "not_found", "Entry not found.");
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/** "Copy yesterday": repeat every entry of one day on another. */
fuelRouter.post("/entries/copy", validateBody(z.object({ from: dateStr, to: dateStr })), async (req, res, next) => {
  try {
    const { from, to } = req.body as { from: string; to: string };
    const result = await pool.query(
      `INSERT INTO food_entries (id, user_id, date, eaten_at, food_id, name, grams, kcal_100g, protein_100g, carbs_100g, fat_100g, fiber_100g, sugar_100g,
         kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g, is_sweet, is_planned, source)
       SELECT gen_random_uuid(), user_id, $3::date, eaten_at + ($3::date - date) * interval '1 day', food_id, name, grams, kcal_100g, protein_100g, carbs_100g,
         fat_100g, fiber_100g, sugar_100g, kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g, is_sweet, false, 'saved'
       FROM food_entries WHERE user_id = $1 AND date = $2 RETURNING *`,
      [req.userId, from, to]
    );
    res.status(201).json({ entries: result.rows });
  } catch (err) {
    next(err);
  }
});

// ---------- days (day type override + recovery) ----------

const daySchema = z.object({
  day_type: z.enum(["hard", "easy", "rest"]).nullable(),
  sleep_h: opt(0, 24),
  resting_hr: z.number().int().min(20).max(200).nullable().optional(),
  steps: z.number().int().min(0).max(200000).nullable().optional(),
  soreness: z.number().int().min(1).max(5).nullable().optional(),
});

fuelRouter.put("/days/:date", validateBody(daySchema), async (req, res, next) => {
  try {
    const date = dateStr.safeParse(req.params.date);
    if (!date.success) throw new AppError(400, "validation_error", "date must be YYYY-MM-DD");
    const d = req.body as z.infer<typeof daySchema>;
    const result = await pool.query(
      `INSERT INTO fuel_days (user_id, date, day_type, sleep_h, resting_hr, steps, soreness) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, date) DO UPDATE SET day_type = EXCLUDED.day_type, sleep_h = EXCLUDED.sleep_h, resting_hr = EXCLUDED.resting_hr,
         steps = EXCLUDED.steps, soreness = EXCLUDED.soreness
       RETURNING *`,
      [req.userId, date.data, d.day_type, d.sleep_h ?? null, d.resting_hr ?? null, d.steps ?? null, d.soreness ?? null]
    );
    res.json({ day: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ---------- summary (dashboard) ----------

const r1 = (v: number) => Math.round(v * 10) / 10;

fuelRouter.get("/summary", validateQuery(z.object({ date: dateStr })), async (req, res, next) => {
  try {
    const { date } = req.validatedQuery as { date: string };
    const uid = req.userId!;
    const [profile, tz] = await Promise.all([loadProfile(uid), userTimezone(uid)]);
    const cfg: FuelConfig = profile.config;
    const window = cfg.maintenance_window_days;
    const ws = weekStartKey(date);
    const lastWs = addDaysKey(ws, -7);
    const earliest = addDaysKey(date, -Math.max(window, 13));

    const [readings, intake, events, days, totals, tape] = await Promise.all([
      pool.query(
        `SELECT (measured_at AT TIME ZONE $3)::date AS date, weight_kg, body_fat_pct, context, bmi, bmr_kcal
         FROM body_readings WHERE user_id = $1 AND measured_at < ($2::date + 1)::timestamp AT TIME ZONE $3
         AND measured_at > ($2::date - 120)::timestamp AT TIME ZONE $3 ORDER BY measured_at`,
        [uid, date, tz]
      ),
      pool.query("SELECT date, sum(kcal) AS kcal FROM food_entries WHERE user_id = $1 AND date BETWEEN $2 AND $3 GROUP BY date", [uid, earliest, date]),
      pool.query("SELECT date, type, title, done, details FROM planner_events WHERE user_id = $1 AND date BETWEEN $2 AND $3", [uid, [earliest, lastWs].sort()[0], addDaysKey(ws, 6)]),
      pool.query("SELECT * FROM fuel_days WHERE user_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date", [uid, addDaysKey(date, -13), addDaysKey(ws, 6)]),
      pool.query(
        `SELECT COALESCE(sum(kcal), 0) AS kcal, COALESCE(sum(protein_g), 0) AS protein_g, COALESCE(sum(carbs_g), 0) AS carbs_g,
           COALESCE(sum(fat_g), 0) AS fat_g, COALESCE(sum(fiber_g), 0) AS fiber_g, COALESCE(sum(sugar_g), 0) AS sugar_g,
           COALESCE(sum(kcal) FILTER (WHERE is_sweet), 0) AS sweets_kcal, COALESCE(sum(kcal) FILTER (WHERE is_sweet AND is_planned), 0) AS sweets_planned_kcal,
           count(*)::int AS entries
         FROM food_entries WHERE user_id = $1 AND date = $2`,
        [uid, date]
      ),
      pool.query("SELECT * FROM tape_measurements WHERE user_id = $1 AND date <= $2 ORDER BY date DESC LIMIT 12", [uid, date]),
    ]);

    // Weight: raw points plus the 7-day average. Latest smoothed value drives the per-kg targets.
    const daily = dailyMeans(readings.rows.map((r) => ({ date: r.date, value: r.weight_kg })));
    const smoothed = movingAverage(daily);
    const weightKg = smoothed.at(-1)?.value ?? null;
    const latest = readings.rows.at(-1);

    const evs = events.rows as PlannerEventLike[];
    const inRange = (from: string, to: string) => evs.filter((e) => e.date >= from && e.date <= to);
    const overrides = new Map<string, DayType>(days.rows.filter((d) => d.day_type).map((d) => [d.date, d.day_type]));
    const dayTypeOf = (k: string) => overrides.get(k) ?? inferDayType(inRange(k, k), cfg);
    const week = Array.from({ length: 7 }, (_, i) => addDaysKey(ws, i));
    const dayType = dayTypeOf(date);

    const windowStart = addDaysKey(date, -window);
    const intakeDays = intake.rows.filter((d) => d.date >= windowStart && d.date < date).map((d) => ({ date: d.date, value: d.kcal }));
    const maintenance = weightKg === null ? null : estimateMaintenance({
      weightKg,
      heightCm: profile.height_cm,
      age: Number(date.slice(0, 4)) - profile.birth_year,
      sex: profile.sex,
      cfg,
      intake: intakeDays,
      weights: daily.filter((d) => d.date >= windowStart && d.date <= date),
      exerciseKcal: trainingLoad(inRange(windowStart, addDaysKey(date, -1)), weightKg).exercise_kcal,
      scaleBmr: latest?.bmr_kcal ?? null,
      override: profile.maintenance_override_kcal,
    });

    const targets = maintenance && weightKg !== null
      ? dayTargets({ maintenance: maintenance.kcal, goal: profile.goal_profile, cfg, weightKg, dayType, weekDayTypes: week.map(dayTypeOf), bodyFatPct: latest?.body_fat_pct ?? null, bmi: latest?.bmi ?? null, date })
      : null;

    const t = totals.rows[0];
    const thisWeek = trainingLoad(inRange(ws, addDaysKey(ws, 6)), weightKg ?? 0);
    const prevWeek = trainingLoad(inRange(lastWs, addDaysKey(lastWs, 6)), weightKg ?? 0);
    const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
    const last7 = intake.rows.filter((d) => d.date >= addDaysKey(date, -7) && d.date < date);

    res.json({
      date,
      profile: { goal_profile: profile.goal_profile, sweets_kcal_cap_pct: cfg.sweets_kcal_cap_pct },
      day_type: dayType,
      day_type_inferred: !overrides.has(date),
      week: week.map((k) => ({ date: k, day_type: dayTypeOf(k) })),
      today: {
        ...Object.fromEntries(Object.entries(t).map(([k, v]) => [k, k === "entries" ? v : r1(v as number)])),
        protein_g_per_kg: weightKg ? Math.round((t.protein_g / weightKg) * 100) / 100 : null,
      },
      targets,
      weight: { latest_kg: weightKg === null ? null : r1(weightKg), points: daily.map((d) => ({ date: d.date, value: r1(d.value) })), trend: smoothed.map((d) => ({ date: d.date, value: Math.round(d.value * 100) / 100 })) },
      body_fat_weekly: weeklyBodyFat(readings.rows.filter((r) => r.body_fat_pct != null)),
      tape: tape.rows,
      maintenance,
      energy_balance_7d: maintenance && last7.length ? Math.round(last7.reduce((s, d) => s + d.kcal, 0) / last7.length - maintenance.kcal) : null,
      training: { this_week: thisWeek, last_week: prevWeek, km_change_pct: pct(thisWeek.km, prevWeek.km), minutes_change_pct: pct(thisWeek.minutes, prevWeek.minutes) },
      recovery: days.rows.filter((d) => d.date <= date && d.date > addDaysKey(date, -14)),
    });
  } catch (err) {
    next(err);
  }
});

// ---------- data ownership ----------

const FUEL_TABLES = ["food_entries", "foods", "body_readings", "tape_measurements", "fuel_days", "fuel_profiles"] as const;

fuelRouter.get("/export", async (req, res, next) => {
  try {
    const data = Object.fromEntries(
      await Promise.all(FUEL_TABLES.map(async (t) => [t, (await pool.query(`SELECT * FROM ${t} WHERE user_id = $1`, [req.userId])).rows] as const))
    );
    res.setHeader("Content-Disposition", 'attachment; filename="fuel-export.json"');
    res.json({ exported_at: new Date().toISOString(), ...data });
  } catch (err) {
    next(err);
  }
});

fuelRouter.delete("/data", async (req, res, next) => {
  try {
    await withTransaction(async (client) => {
      for (const t of FUEL_TABLES) await client.query(`DELETE FROM ${t} WHERE user_id = $1`, [req.userId]);
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
