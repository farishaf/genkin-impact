import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { env } from "../env.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { AppError } from "../middleware/errorHandler.js";
import { labelToFood, monthSpend, runAi, scaleToReading } from "../lib/fuel/ai.js";
import { checkReading, defaultContext, deriveReading, localHour } from "../lib/fuel/body.js";
import { looksSweet } from "../lib/fuel/nutrition.js";
import { withDefaults } from "../lib/fuel/config.js";
import { resolveItems } from "../lib/fuel/usda.js";

// AI reads for Fuel. Every answer here is a draft for a confirm screen: nothing is saved without the user.
// Images pass through memory only (never written to disk); the client downsizes them and drops EXIF first.
export const fuelAiRouter = Router();
fuelAiRouter.use(requireAuth);

const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, IMAGE_MIME.has(file.mimetype)),
});

function image(req: Express.Request) {
  if (!req.file) throw new AppError(400, "invalid_file", "Send a JPEG, PNG or WebP photo up to 4 MB.");
  return { mime: req.file.mimetype, data: req.file.buffer };
}

async function profileOf(userId: string) {
  const [p, u] = await Promise.all([
    pool.query("SELECT height_cm, config FROM fuel_profiles WHERE user_id = $1", [userId]),
    pool.query("SELECT timezone FROM users WHERE id = $1", [userId]),
  ]);
  return { heightCm: (p.rows[0]?.height_cm as number | undefined) ?? 169, cfg: withDefaults(p.rows[0]?.config), tz: (u.rows[0]?.timezone as string | undefined) ?? "UTC" };
}

/** Scale screenshot → a reading draft with the free cross-field checks already run. */
fuelAiRouter.post("/scale", upload.single("file"), async (req, res, next) => {
  try {
    const img = image(req);
    const { heightCm, tz } = await profileOf(req.userId!);
    const { result, cached } = await runAi(req.userId!, "scale", { image: img });
    const reading = scaleToReading(result, tz);
    const prev = await pool.query("SELECT weight_kg, body_fat_pct FROM body_readings WHERE user_id = $1 AND measured_at < $2 ORDER BY measured_at DESC LIMIT 1", [req.userId, reading.measured_at]);
    res.json({
      reading: deriveReading(reading),
      context: defaultContext(localHour(new Date(reading.measured_at), tz)),
      issues: checkReading(reading, heightCm, prev.rows[0]),
      cached,
    });
  } catch (err) {
    next(err);
  }
});

/** Nutrition label photo → a per-100g food draft. */
fuelAiRouter.post("/label", upload.single("file"), async (req, res, next) => {
  try {
    const { cfg } = await profileOf(req.userId!);
    const { result, cached, cache_key } = await runAi(req.userId!, "label", { image: image(req) });
    const draft = labelToFood(result);
    const barcode = typeof req.body?.barcode === "string" && /^\d{6,14}$/.test(req.body.barcode) ? req.body.barcode : null;
    res.json({ ...draft, food: { ...draft.food, barcode, is_sweet: looksSweet(draft.food.name, draft.food.sugar_100g, cfg), source: "label" }, image_hash: cache_key, cached });
  } catch (err) {
    next(err);
  }
});

/** Meal photo → items with grams; per-100g values come from USDA, saved foods, or (last) the model. */
fuelAiRouter.post("/meal", upload.single("file"), async (req, res, next) => {
  try {
    const { result, cached, cache_key } = await runAi(req.userId!, "meal", { image: image(req) });
    res.json({ items: await resolveItems(req.userId!, result.items), assumptions: result.assumptions, needs_user_input: result.needs_user_input, image_hash: cache_key, cached });
  } catch (err) {
    next(err);
  }
});

/** "2 eggs, 150 g cooked rice" → items. The most accurate AI path: the user states the amounts. */
fuelAiRouter.post("/text", validateBody(z.object({ text: z.string().trim().min(2).max(1000) })), async (req, res, next) => {
  try {
    const { result, cached } = await runAi(req.userId!, "text", { text: req.body.text });
    res.json({ items: await resolveItems(req.userId!, result.items), assumptions: result.assumptions, needs_user_input: result.needs_user_input, image_hash: null, cached });
  } catch (err) {
    next(err);
  }
});

fuelAiRouter.get("/usage", async (req, res, next) => {
  try {
    const byTask = await pool.query(
      `SELECT task, count(*)::int AS calls, COALESCE(sum(cost_usd), 0) AS usd, round(avg(latency_ms))::int AS avg_ms,
         count(*) FILTER (WHERE outcome <> 'ok')::int AS failed
       FROM ai_calls WHERE user_id = $1 AND ts >= date_trunc('month', now()) GROUP BY task ORDER BY task`,
      [req.userId]
    );
    res.json({ month_usd: await monthSpend(req.userId!), cap_usd: env.AI_MONTHLY_CAP_USD, by_task: byTask.rows });
  } catch (err) {
    next(err);
  }
});
