// Contract and fixture tests for Fuel's AI inputs. No live AI calls: provider replies are recorded fixtures.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { app } from "../app.js";
import { pool } from "../db/pool.js";
import { env } from "../env.js";
import { runMigrations } from "../db/migrate.js";
import { checkReading, deriveReading } from "../lib/fuel/body.js";
import { labelSchema, labelToFood, mealSchema, scaleSchema, scaleToReading, zonedToIso } from "../lib/fuel/ai.js";
import { fdcPer100, resolveItems } from "../lib/fuel/usda.js";

// Appendix A, fixture 2: what the model should return for the AiLink app screen.
const ailinkScreen = {
  measured_at: "2026-11-10T06:58:00", weight_kg: 56.7, bmi: 19.8, body_fat_pct: 12.3, muscle_rate_pct: 83.2,
  skeletal_muscle_mass_kg: 25.5, body_water_pct: 60.1, bone_mass_kg: 2.5, bmr_kcal: 1377, protein_pct: 16.2, body_age: 24,
  visceral_fat_index: 3, subcutaneous_fat_pct: 11.4, body_fat_mass_kg: null, protein_mass_kg: null, limb_muscle_index: null,
  segmental_fat_kg: { right_arm: 0.5, left_arm: 0.5, trunk: 3.4, right_leg: 0.8, left_leg: 0.8 },
  segmental_muscle_kg: { right_arm: 2.7, left_arm: 2.4, trunk: 21.7, right_leg: 8.1, left_leg: 8.0 },
};

describe("normalisers", () => {
  it("turns the AiLink screen into a reading that passes every check", () => {
    const reading = scaleToReading(scaleSchema.parse(ailinkScreen), "Asia/Jakarta");
    expect(reading.measured_at).toBe("2026-11-09T23:58:00.000Z");
    expect(checkReading(reading, 169)).toEqual([]);
    expect(deriveReading(reading).body_fat_mass_kg).toBeCloseTo(6.97, 2);
    expect(reading.segmental).toEqual({ fat: ailinkScreen.segmental_fat_kg, muscle: ailinkScreen.segmental_muscle_kg });
  });

  it("converts local wall time across timezones", () => {
    expect(zonedToIso("2026-11-10T06:58:00", "UTC")).toBe("2026-11-10T06:58:00.000Z");
    expect(zonedToIso("2026-11-10T06:58:00", "Asia/Tokyo")).toBe("2026-11-09T21:58:00.000Z");
  });

  it("scales a per-serving-only label to per 100 g and lists what's missing", () => {
    const label = labelSchema.parse({
      product_name: "Biskuit", basis: "per_serving", serving_size: { value: 30, unit: "g" }, servings_per_pack: 4,
      per_serving: { kcal: 150, protein_g: 2, carbs_g: 20, fat_g: null, fiber_g: null, sugar_g: 9 }, per_100g: null,
      language: "id", confidence: 0.8, notes: null,
    });
    const { food, missing, derived_from_serving } = labelToFood(label);
    expect(food).toMatchObject({ kcal_100g: 500, protein_100g: 6.7, carbs_100g: 66.7, sugar_100g: 30, serving_g: 30 });
    expect(missing).toEqual(["fat_100g"]);
    expect(derived_from_serving).toBe(true);
  });

  it("prefers the printed per-100g column", () => {
    const { food } = labelToFood(labelSchema.parse({ per_100g: { kcal: 380, protein_g: 13, carbs_g: 60, fat_g: 7 }, per_serving: { kcal: 1 }, serving_size: { value: 40, unit: "g" }, confidence: 0.9 }));
    expect(food.kcal_100g).toBe(380);
  });

  it("reads Atwater energy from FDC Foundation foods", () => {
    expect(fdcPer100({ description: "Rice, white, cooked", foodNutrients: [{ nutrientId: 2047, value: 130 }, { nutrientId: 1003, value: 2.7 }, { nutrientId: 1005, value: 28.2 }, { nutrientId: 1004, value: 0.3 }] }))
      .toEqual({ kcal_100g: 130, protein_100g: 2.7, carbs_100g: 28.2, fat_100g: 0.3, fiber_100g: null, sugar_100g: null });
  });

  it("builds a structured-output format from the meal schema", () => {
    expect(() => zodOutputFormat(mealSchema)).not.toThrow();
  });
});

beforeAll(async () => {
  await runMigrations();
});

beforeEach(async () => {
  for (const t of [
    "ai_calls", "food_entries", "foods", "body_readings", "tape_measurements", "fuel_days", "fuel_profiles",
    "planner_events", "planner_routines", "planner_days", "planner_pages", "planner_goals", "transaction_tags",
  ]) await pool.query(`DELETE FROM ${t}`);
  await pool.query("UPDATE transactions SET installment_plan_id = NULL WHERE installment_plan_id IS NOT NULL");
  for (const t of [
    "installment_plans", "transactions", "budgets", "savings_goals", "recurring_rules", "accounts", "sessions", "members",
    "categories", "tags", "saved_filters", "users",
  ]) await pool.query(`DELETE FROM ${t}`);
  env.DEEPSEEK_API_KEY = "test-key";
  env.USDA_API_KEY = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await pool.end();
});

const deepseekReply = (json: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(json) } }], usage: { prompt_tokens: 900, completion_tokens: 300 } }), { status: 200 });
const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

async function login() {
  const agent = request.agent(app);
  await agent.post("/auth/register").send({ email: "fuel-ai@example.com", password: "password12345", display_name: "Fuel AI" });
  return agent;
}

describe("POST /fuel/ai/scale", () => {
  it("returns a checked draft, caches by image, and logs cost", async () => {
    const agent = await login();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(deepseekReply(ailinkScreen));
    const first = await agent.post("/fuel/ai/scale").attach("file", png, { filename: "a.png", contentType: "image/png" });
    expect(first.status).toBe(200);
    expect(first.body.issues).toEqual([]);
    expect(first.body.reading.protein_mass_kg).toBeCloseTo(9.19, 2);
    expect(JSON.parse(fetchSpy.mock.calls[0][1]!.body as string).thinking).toEqual({ type: "disabled" });

    const again = await agent.post("/fuel/ai/scale").attach("file", png, { filename: "a.png", contentType: "image/png" });
    expect(again.body.cached).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const usage = (await agent.get("/fuel/ai/usage")).body;
    expect(usage.by_task[0]).toMatchObject({ task: "scale", calls: 1, failed: 0 });
    expect(usage.month_usd).toBeGreaterThan(0);

    // Saving the import twice keeps one reading (dedupe on measured_at).
    const save = { ...first.body.reading, source: "screenshot" };
    await agent.post("/fuel/body").send(save);
    expect((await agent.post("/fuel/body").send(save)).body.duplicate).toBe(true);
  });

  it("retries an invalid reply once, then fails to the manual form", async () => {
    const agent = await login();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => deepseekReply({ nonsense: true }));
    const res = await agent.post("/fuel/ai/scale").attach("file", png, { filename: "a.png", contentType: "image/png" });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("ai_failed");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("stops at the monthly cap and rejects non-images", async () => {
    const agent = await login();
    const uid = (await pool.query("SELECT id FROM users WHERE email = 'fuel-ai@example.com'")).rows[0].id;
    await pool.query(
      "INSERT INTO ai_calls (id, user_id, task, provider, model, cost_usd, outcome, cache_key) VALUES (gen_random_uuid(), $1, 'meal', 'anthropic', 'x', $2, 'ok', 'k')",
      [uid, env.AI_MONTHLY_CAP_USD]
    );
    const capped = await agent.post("/fuel/ai/scale").attach("file", png, { filename: "a.png", contentType: "image/png" });
    expect(capped.body.error.code).toBe("ai_cap_reached");
    const txt = await agent.post("/fuel/ai/label").attach("file", Buffer.from("hi"), { filename: "a.txt", contentType: "text/plain" });
    expect(txt.status).toBe(400);
  });
});

describe("resolveItems", () => {
  it("uses a saved food before the model's estimate, and marks estimates", async () => {
    const agent = await login();
    await agent.post("/fuel/foods").send({ name: "Cooked rice", kcal_100g: 130, protein_100g: 2.7, carbs_100g: 28, fat_100g: 0.3 });
    const uid = (await pool.query("SELECT id FROM users WHERE email = 'fuel-ai@example.com'")).rows[0].id;
    const est = { kcal: 200, protein_g: 10, carbs_g: 10, fat_g: 12 };
    const items = await resolveItems(uid, [
      { name: "rice", grams: 150.4, confidence: 0.7, per_100g_estimate: est },
      { name: "Rendang", grams: 120, confidence: 1.4, per_100g_estimate: est },
      { name: "Air", grams: 0, confidence: 0.9, per_100g_estimate: est },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ grams: 150, per100_source: "saved", matched: "Cooked rice" });
    expect(items[1]).toMatchObject({ per100_source: "estimated", confidence: 1 });
  });
});
