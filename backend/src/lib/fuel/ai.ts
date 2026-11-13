// Fuel AI inputs. AI is the last resort: barcode, saved foods and forms come first, and every AI result
// ends in an editable confirm screen. The model never computes totals; the app does, from per-100g data.
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { env } from "../../env.js";
import { newId } from "../ids.js";
import { AppError } from "../../middleware/errorHandler.js";
import type { BodyReadingInput } from "./body.js";

export type Task = "scale" | "label" | "meal" | "text";
export type Provider = "deepseek" | "anthropic";

// Default provider per task (requirements §6.1). Run scripts/fuelEval.ts and change these when the data says so.
export const TASK_PROVIDER: Record<Task, Provider> = { scale: "deepseek", label: "deepseek", meal: "anthropic", text: "anthropic" };
const MODEL: Record<Provider, string> = { deepseek: env.DEEPSEEK_MODEL, anthropic: "claude-haiku-5-5" };
// USD per million tokens. Haiku 5.5 is Anthropic's list price for prompts up to 100K tokens.
// [VERIFY] DeepSeek: these are placeholders; check https://api-docs.deepseek.com pricing and update.
const PRICE: Record<Provider, { in: number; out: number }> = { anthropic: { in: 0.1, out: 0.5 }, deepseek: { in: 0.3, out: 1.2 } };

export interface Input {
  image?: { mime: string; data: Buffer };
  text?: string;
}

// ---------- schemas (the model's reply is untrusted: every field is re-checked) ----------

const n = z.number().nullish();
const segment = z.object({ right_arm: n, left_arm: n, trunk: n, right_leg: n, left_leg: n }).nullish();

export const scaleSchema = z.object({
  measured_at: z.string().nullish(),
  weight_kg: z.number(),
  body_fat_pct: n, body_fat_mass_kg: n, skeletal_muscle_mass_kg: n, body_water_pct: n, protein_mass_kg: n, protein_pct: n,
  bone_mass_kg: n, visceral_fat_index: n, subcutaneous_fat_pct: n, bmr_kcal: n, limb_muscle_index: n, bmi: n,
  muscle_rate_pct: n, body_age: n,
  segmental_fat_kg: segment,
  segmental_muscle_kg: segment,
});
export type ScaleExtract = z.infer<typeof scaleSchema>;

const macros = z.object({ kcal: n, protein_g: n, carbs_g: n, fat_g: n, fiber_g: n, sugar_g: n });
export const labelSchema = z.object({
  product_name: z.string().nullish(),
  basis: z.enum(["per_serving", "per_100g", "per_100ml"]).nullish(),
  serving_size: z.object({ value: n, unit: z.enum(["g", "ml"]).nullish() }).nullish(),
  servings_per_pack: n,
  per_serving: macros.nullish(),
  per_100g: macros.nullish(),
  language: z.string().nullish(),
  confidence: z.number().min(0).max(1),
  notes: z.string().nullish(),
});
export type LabelExtract = z.infer<typeof labelSchema>;

export const mealSchema = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      grams: z.number(),
      confidence: z.number(),
      per_100g_estimate: z.object({ kcal: z.number(), protein_g: z.number(), carbs_g: z.number(), fat_g: z.number() }),
    })
  ),
  assumptions: z.array(z.string()),
  needs_user_input: z.array(z.string()),
});
export type MealExtract = z.infer<typeof mealSchema>;

// ---------- prompts (static first, so the provider can cache them; the variable input goes last) ----------

/** The AiLink app screen (requirements §6.4). One scale, so a constant rather than a scale_templates table. */
const AILINK = {
  app: "AiLink",
  synonyms: "weight (Weight); bmi (BMI); body_fat_pct (BFR, Body fat rate); muscle_rate_pct (Muscle rate); skeletal_muscle_mass_kg (Skeletal muscle mass); body_water_pct (Moisture content, Body water); bone_mass_kg (Bone mass); bmr_kcal (BMR); protein_pct (Protein rate); body_age (Body age); visceral_fat_index (Visceral fat); subcutaneous_fat_pct (Subcutaneous fat)",
};

const PROMPTS: Record<Task, string> = {
  scale: `You read a screenshot of the ${AILINK.app} body-composition app and reply with json only, exactly this shape:
{"measured_at": "2026-11-10T06:58:00", "weight_kg": 56.7, "body_fat_pct": 12.3, "body_fat_mass_kg": null, "skeletal_muscle_mass_kg": 25.5, "body_water_pct": 60.1, "protein_mass_kg": null, "protein_pct": 16.2, "bone_mass_kg": 2.5, "visceral_fat_index": 3, "subcutaneous_fat_pct": 11.4, "bmr_kcal": 1377, "limb_muscle_index": null, "bmi": 19.8, "muscle_rate_pct": 83.2, "body_age": 24, "segmental_fat_kg": {"right_arm": 0.5, "left_arm": 0.5, "trunk": 3.4, "right_leg": 0.8, "left_leg": 0.8}, "segmental_muscle_kg": {"right_arm": 2.7, "left_arm": 2.4, "trunk": 21.7, "right_leg": 8.1, "left_leg": 8.0}}
Field labels on screen (json key, then label): ${AILINK.synonyms}.
- measured_at: the date and time in the header, as local time without a timezone, or null.
- Units: kg, %, kcal. Copy digits exactly as printed. Use null for anything not visible. Never estimate or calculate a value.
- In the segment diagram, R and L are the person's right and left; image-left is the person's right side.
- Ignore status labels (Standard, Low, Excellent), scores, the avatar, the weight-range bar and the person's name.`,
  label: `You read a photo of a packaged food's nutrition facts table and reply with json only, exactly this shape:
{"product_name": "string or null", "basis": "per_serving | per_100g | per_100ml", "serving_size": {"value": 30, "unit": "g"}, "servings_per_pack": 4, "per_serving": {"kcal": 120, "protein_g": 3, "carbs_g": 20, "fat_g": 3, "fiber_g": null, "sugar_g": 8}, "per_100g": {"kcal": 400, "protein_g": 10, "carbs_g": 66.7, "fat_g": 10, "fiber_g": null, "sugar_g": 26.7}, "language": "id", "confidence": 0.9, "notes": null}
- Labels may be Japanese, Indonesian or English. Energy: エネルギー, energi, kalori, energy. Protein: たんぱく質, protein. Carbohydrate: 炭水化物, karbohidrat. Fat: 脂質, lemak. Fiber: 食物繊維, serat. Sugar: 糖類, gula.
- If energy is only printed in kJ, convert to kcal (kJ / 4.184). Copy every other number as printed.
- Fill per_serving and per_100g only with columns that are actually printed; null for any field or column not printed. Never infer or calculate missing values.
- confidence: 0–1, how sure you are the digits are read correctly.`,
  meal: `You look at a photo of a meal and list every visible food item with its estimated cooked weight in grams.
- One item per distinct food. Estimate grams from plate and utensil size; say what you assumed (cooking oil, sauce, plate size) in assumptions.
- per_100g_estimate is your best estimate of typical values per 100 g of that item as served; the app looks up real data first and uses yours only as a fallback.
- Do not guess hidden ingredients: ask in needs_user_input instead (e.g. "Was the rice fried in oil?").
- confidence: 0–1 per item. Do not add up totals.`,
  text: `You turn a short meal description into food items with weights in grams.
- One item per food. Convert counts and household measures to grams (e.g. 1 large egg ≈ 50 g, 1 cup cooked rice ≈ 160 g). Keep weights the user gave exactly.
- Note cooked vs raw in the item name when the text says it.
- per_100g_estimate is your best estimate of typical values per 100 g; the app looks up real data first.
- Put anything ambiguous in needs_user_input. confidence: 0–1 per item. Do not add up totals.`,
};

// ---------- providers ----------

class InvalidOutput extends Error {}

interface ProviderResult<T> {
  data: T;
  tokensIn: number;
  tokensOut: number;
}

async function askDeepseek<T>(task: Task, schema: z.ZodType<T>, input: Input): Promise<ProviderResult<T>> {
  if (!env.DEEPSEEK_API_KEY) throw new AppError(503, "ai_unavailable", "DeepSeek isn't set up. Add DEEPSEEK_API_KEY to the server env.");
  const content: unknown[] = [{ type: "text", text: input.text ?? "Read this image as json." }];
  if (input.image) content.push({ type: "image_url", image_url: { url: `data:${input.image.mime};base64,${input.image.data.toString("base64")}` } });
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model: MODEL.deepseek,
      // Thinking is on by default and bills as output; reading a label needs none.
      thinking: { type: "disabled" },
      temperature: 0,
      max_tokens: 2000,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: PROMPTS[task] }, { role: "user", content }],
    }),
  });
  if (!res.ok) throw new Error(`deepseek ${res.status}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const usage = { tokensIn: body.usage?.prompt_tokens ?? 0, tokensOut: body.usage?.completion_tokens ?? 0 };
  let json: unknown;
  try {
    json = JSON.parse(body.choices?.[0]?.message?.content ?? "");
  } catch {
    throw Object.assign(new InvalidOutput("not json"), usage);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw Object.assign(new InvalidOutput("schema"), usage);
  return { data: parsed.data, ...usage };
}

let anthropic: Anthropic | null = null;

async function askClaude<T>(task: Task, schema: z.ZodType<T>, input: Input): Promise<ProviderResult<T>> {
  if (!env.ANTHROPIC_API_KEY) throw new AppError(503, "ai_unavailable", "Claude isn't set up. Add ANTHROPIC_API_KEY to the server env.");
  anthropic ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 1 });
  const content: Anthropic.ContentBlockParam[] = [];
  if (input.image) {
    content.push({ type: "image", source: { type: "base64", media_type: input.image.mime as "image/jpeg", data: input.image.data.toString("base64") } });
  }
  content.push({ type: "text", text: input.text ?? "List the food items in this photo." });
  const response = await anthropic.messages.parse({
    model: MODEL.anthropic,
    max_tokens: 2000,
    // Extraction needs no reasoning; disabled is accepted on Haiku 5.5 at effort high or below (default medium).
    thinking: { type: "disabled" },
    system: PROMPTS[task],
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(schema as z.ZodType<T> & z.ZodObject) },
  });
  const usage = { tokensIn: response.usage.input_tokens, tokensOut: response.usage.output_tokens };
  if (response.stop_reason === "refusal" || !response.parsed_output) throw Object.assign(new InvalidOutput(response.stop_reason ?? "no output"), usage);
  return { data: response.parsed_output as T, ...usage };
}

// ---------- the one entry point: cache, cap, rate limit, retry once, log ----------

export const hashOf = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

// ponytail: in-memory, per process. Postgres-backed if the backend ever runs as more than one instance.
const HOURLY_LIMIT = 40;
const recent = new Map<string, number[]>();
function rateLimit(userId: string) {
  const now = Date.now();
  const calls = (recent.get(userId) ?? []).filter((t) => now - t < 3600_000);
  if (calls.length >= HOURLY_LIMIT) throw new AppError(429, "ai_rate_limited", "Too many AI reads this hour. Try again later, or enter it by hand.");
  recent.set(userId, [...calls, now]);
}

export async function monthSpend(userId: string): Promise<number> {
  const r = await pool.query("SELECT COALESCE(sum(cost_usd), 0) AS usd FROM ai_calls WHERE user_id = $1 AND ts >= date_trunc('month', now())", [userId]);
  return r.rows[0].usd;
}

const SCHEMAS = { scale: scaleSchema, label: labelSchema, meal: mealSchema, text: mealSchema } as const;
type Result<K extends Task> = z.infer<(typeof SCHEMAS)[K]>;

export async function runAi<K extends Task>(userId: string, task: K, input: Input, provider: Provider = TASK_PROVIDER[task]): Promise<{ result: Result<K>; cached: boolean; cache_key: string }> {
  const cacheKey = hashOf(input.image ? input.image.data : `${task}:${(input.text ?? "").trim().toLowerCase().replace(/\s+/g, " ")}`);
  const hit = await pool.query(
    "SELECT result FROM ai_calls WHERE user_id = $1 AND task = $2 AND cache_key = $3 AND outcome = 'ok' ORDER BY ts DESC LIMIT 1",
    [userId, task, cacheKey]
  );
  if (hit.rows[0]) return { result: hit.rows[0].result, cached: true, cache_key: cacheKey };

  if ((await monthSpend(userId)) >= env.AI_MONTHLY_CAP_USD) {
    throw new AppError(429, "ai_cap_reached", "This month's AI budget is used up. Manual entry, barcodes and saved foods still work.");
  }
  rateLimit(userId);

  const ask = provider === "anthropic" ? askClaude : askDeepseek;
  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    try {
      const out = await ask(task, SCHEMAS[task] as unknown as z.ZodType<Result<K>>, input);
      await logCall(userId, task, provider, cacheKey, "ok", out.tokensIn, out.tokensOut, Date.now() - started, out.data);
      return { result: out.data, cached: false, cache_key: cacheKey };
    } catch (err) {
      if (err instanceof AppError) throw err;
      const invalid = err instanceof InvalidOutput;
      const usage = err as { tokensIn?: number; tokensOut?: number };
      await logCall(userId, task, provider, cacheKey, invalid ? "invalid" : "error", usage.tokensIn ?? 0, usage.tokensOut ?? 0, Date.now() - started, null);
      // Logs carry the task and outcome only, never the image, the text or the reply.
      console.error(`fuel ai ${task}/${provider}: ${invalid ? "invalid output" : (err as Error).message}`);
      if (invalid && attempt === 0) continue;
      throw new AppError(502, "ai_failed", "Couldn't read that. Try a sharper photo, or enter it by hand.");
    }
  }
}

async function logCall(userId: string, task: Task, provider: Provider, cacheKey: string, outcome: string, tin: number, tout: number, ms: number, result: unknown) {
  const cost = (tin * PRICE[provider].in + tout * PRICE[provider].out) / 1e6;
  await pool.query(
    `INSERT INTO ai_calls (id, user_id, task, provider, model, tokens_in, tokens_out, cost_usd, latency_ms, outcome, cache_key, result)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [newId(), userId, task, provider, MODEL[provider], tin, tout, cost, ms, outcome, cacheKey, result === null ? null : JSON.stringify(result)]
  );
}

// ---------- normalisers (pure; covered by fixture tests) ----------

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Local wall time ("2026-11-10T06:58:00") in a timezone → ISO instant. */
export function zonedToIso(local: string, timeZone: string): string {
  const asUtc = new Date(`${local.slice(0, 19)}Z`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(asUtc)
      .map((p) => [p.type, p.value])
  );
  const tzAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return new Date(asUtc.getTime() - (tzAsUtc - asUtc.getTime())).toISOString();
}

/** Scale extraction → a reading for the confirm form. Fat and protein mass are derived later by deriveReading. */
export function scaleToReading(s: ScaleExtract, timeZone: string, now = new Date()): BodyReadingInput & { segmental: unknown } {
  const valid = s.measured_at && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s.measured_at);
  const { segmental_fat_kg, segmental_muscle_kg, measured_at: _m, ...rest } = s;
  const fields = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v ?? null])) as Omit<BodyReadingInput, "measured_at">;
  return {
    ...fields,
    measured_at: valid ? zonedToIso(s.measured_at!, timeZone) : now.toISOString(),
    segmental: segmental_fat_kg || segmental_muscle_kg ? { fat: segmental_fat_kg ?? undefined, muscle: segmental_muscle_kg ?? undefined } : null,
  };
}

/** Label → a per-100g food draft. Uses the printed per-100g column, else scales per-serving by the serving size. */
export function labelToFood(l: LabelExtract) {
  const per = l.per_100g?.kcal != null ? l.per_100g : null;
  const serving = l.serving_size?.value && l.serving_size.value > 0 ? l.serving_size.value : null;
  const scale = per ? 1 : l.per_serving?.kcal != null && serving ? 100 / serving : null;
  const src = per ?? l.per_serving;
  const v = (k: keyof NonNullable<LabelExtract["per_100g"]>) => (src && scale && src[k] != null ? r1(src[k]! * scale) : null);
  const food = {
    name: l.product_name?.trim() || "Packaged food",
    kcal_100g: v("kcal"),
    protein_100g: v("protein_g"),
    carbs_100g: v("carbs_g"),
    fat_100g: v("fat_g"),
    fiber_100g: v("fiber_g"),
    sugar_100g: v("sugar_g"),
    serving_g: serving,
  };
  const missing = (["kcal_100g", "protein_100g", "carbs_100g", "fat_100g"] as const).filter((k) => food[k] === null);
  return { food, missing, confidence: l.confidence, notes: l.notes ?? null, derived_from_serving: !per && scale !== null };
}

/** One raw provider call with no cache, cap or log: for the eval harness only (scripts/fuelEval.ts). */
export async function evalCall(provider: Provider, task: Task, input: Input) {
  const started = Date.now();
  const ask = provider === "anthropic" ? askClaude : askDeepseek;
  try {
    const out = await ask(task, SCHEMAS[task] as unknown as z.ZodType<unknown>, input);
    return { data: out.data, valid: true, ms: Date.now() - started, cost: (out.tokensIn * PRICE[provider].in + out.tokensOut * PRICE[provider].out) / 1e6 };
  } catch (err) {
    const u = err as { tokensIn?: number; tokensOut?: number };
    return { data: null, valid: false, ms: Date.now() - started, cost: ((u.tokensIn ?? 0) * PRICE[provider].in + (u.tokensOut ?? 0) * PRICE[provider].out) / 1e6 };
  }
}
