import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import { app } from "../app.js";
import { pool } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";

beforeAll(async () => {
  await runMigrations();
});

beforeEach(async () => {
  // Same wipe order as planner.test.ts (users don't cascade to every table), plus the fuel tables.
  for (const t of [
    "food_entries", "foods", "body_readings", "tape_measurements", "fuel_days", "fuel_profiles",
    "planner_events", "planner_routines", "planner_days", "planner_pages", "planner_goals", "transaction_tags",
  ]) await pool.query(`DELETE FROM ${t}`);
  await pool.query("UPDATE transactions SET installment_plan_id = NULL WHERE installment_plan_id IS NOT NULL");
  for (const t of [
    "installment_plans", "transactions", "budgets", "savings_goals", "recurring_rules", "accounts", "sessions", "members",
    "categories", "tags", "saved_filters", "users",
  ]) await pool.query(`DELETE FROM ${t}`);
});

afterAll(async () => {
  await pool.end();
});

async function login(email = "fuel@example.com") {
  const agent = request.agent(app);
  await agent.post("/auth/register").send({ email, password: "password12345", display_name: "Fuel User" });
  return agent;
}

const reading = { measured_at: "2026-11-10T06:58:00+00:00", weight_kg: 56.7, bmi: 19.8, body_fat_pct: 12.3, muscle_rate_pct: 83.2, bone_mass_kg: 2.5, protein_pct: 16.2 };

describe("/fuel/body", () => {
  it("saves a reading with derived masses and default context, and dedupes a repeat", async () => {
    const agent = await login();
    const first = await agent.post("/fuel/body").send(reading);
    expect(first.status).toBe(201);
    expect(first.body.reading.body_fat_mass_kg).toBeCloseTo(6.97, 2);
    expect(first.body.reading.context).toBe("fasted_morning"); // user timezone defaults to UTC

    const again = await agent.post("/fuel/body").send(reading);
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect((await pool.query("SELECT count(*)::int AS n FROM body_readings")).rows[0].n).toBe(1);
  });

  it("asks to confirm a reading that fails a cross-check, and saves it when forced", async () => {
    const agent = await login();
    const bad = { ...reading, bmi: 25 };
    expect((await agent.post("/fuel/body").send(bad)).body.error.code).toBe("needs_confirm");
    expect((await agent.post("/fuel/body").send({ ...bad, force: true })).status).toBe(201);
    expect((await agent.post("/fuel/body").send({ ...reading, body_fat_pct: 90 })).status).toBe(400);
  });

  it("keeps readings private to their owner", async () => {
    const a = await login("fuel-a@example.com");
    await a.post("/fuel/body").send(reading);
    const b = await login("fuel-b@example.com");
    expect((await b.get("/fuel/body?from=2026-11-01&to=2026-11-30")).body.readings).toEqual([]);
    expect((await request(app).get("/fuel/summary?date=2026-11-10")).status).toBe(401);
  });
});

describe("/fuel/entries", () => {
  it("logs a saved food, recomputes on a grams edit, and copies a day", async () => {
    const agent = await login();
    const food = (await agent.post("/fuel/foods").send({ name: "Cooked rice", kcal_100g: 130, protein_100g: 2.7, carbs_100g: 28, fat_100g: 0.3 })).body.food;
    expect(food.is_sweet).toBe(false);

    const entry = (await agent.post("/fuel/entries").send({ date: "2026-11-10", food_id: food.id, grams: 150 })).body.entry;
    expect(entry.kcal).toBe(195);
    expect(entry.source).toBe("saved");

    const edited = (await agent.patch(`/fuel/entries/${entry.id}`).send({ grams: 200 })).body.entry;
    expect(edited.kcal).toBe(260);
    expect(edited.carbs_g).toBe(56);

    const copied = await agent.post("/fuel/entries/copy").send({ from: "2026-11-10", to: "2026-11-11" });
    expect(copied.body.entries).toHaveLength(1);
    expect((await agent.get("/fuel/entries?date=2026-11-11")).body.entries[0].kcal).toBe(260);
  });

  it("suggests the sweet tag for a one-off item", async () => {
    const agent = await login();
    const res = await agent.post("/fuel/entries").send({ date: "2026-11-10", name: "Chocolate bar", grams: 40, kcal_100g: 540, protein_100g: 7, carbs_100g: 57, fat_100g: 31, sugar_100g: 50 });
    expect(res.body.entry.is_sweet).toBe(true);
    expect(res.body.entry.source).toBe("manual");
  });
});

describe("/fuel/barcode", () => {
  it("returns a parsed Open Food Facts product with missing fields, then the saved food once kept", async () => {
    const agent = await login();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 1, product: { product_name: "Teh Botol", nutriments: { "energy-kcal_100g": 40, sugars_100g: 9.5, carbohydrates_100g: 10 } } }), { status: 200 })
    );
    const res = await agent.get("/fuel/barcode/8991002101012");
    expect(res.body.saved).toBe(false);
    expect(res.body.food.kcal_100g).toBe(40);
    expect(res.body.missing).toEqual(["protein_100g", "fat_100g"]);
    expect(fetchSpy.mock.calls[0][1]?.headers).toMatchObject({ "User-Agent": expect.stringContaining("Hitsune") });
    fetchSpy.mockRestore();

    await agent.post("/fuel/foods").send({ ...res.body.food });
    const cached = await agent.get("/fuel/barcode/8991002101012");
    expect(cached.body.saved).toBe(true);
  });
});

describe("/fuel/summary", () => {
  it("builds targets from the bootstrap and infers a hard day from a long run", async () => {
    const agent = await login();
    await agent.post("/fuel/body").send(reading);
    await agent.post("/planner/events").send({ date: "2026-11-10", type: "run", title: "Long run", details: { km: "18" } });
    await agent.post("/fuel/entries").send({ date: "2026-11-10", name: "Oats", grams: 80, kcal_100g: 380, protein_100g: 13, carbs_100g: 60, fat_100g: 7 });

    const s = (await agent.get("/fuel/summary?date=2026-11-10")).body;
    expect(s.day_type).toBe("hard");
    expect(s.maintenance.confidence).toBe("low");
    expect(s.maintenance.inputs.scale_bmr_kcal).toBe(null);
    expect(s.targets.protein_g).toBe(102);
    expect(s.targets.kcal).toBeGreaterThan(s.maintenance.kcal);
    expect(s.today.kcal).toBe(304);
    expect(s.weight.latest_kg).toBe(56.7);

    await agent.put("/fuel/days/2026-11-10").send({ day_type: "rest" });
    expect((await agent.get("/fuel/summary?date=2026-11-10")).body.day_type).toBe("rest");
  });

  it("exports and deletes all fuel data", async () => {
    const agent = await login();
    await agent.post("/fuel/body").send(reading);
    expect((await agent.get("/fuel/export")).body.body_readings).toHaveLength(1);
    expect((await agent.delete("/fuel/data")).status).toBe(204);
    expect((await agent.get("/fuel/export")).body.body_readings).toHaveLength(0);
  });
});
