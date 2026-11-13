import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG, withDefaults } from "./config.js";
import { checkReading, defaultContext, deriveReading, localHour } from "./body.js";
import {
  addDaysKey, dailyMeans, dayTargets, estimateMaintenance, inferDayType, movingAverage, runKm, slopePerDay,
  trainingLoad, weekStartKey, weeklyBodyFat, type DayValue, type PlannerEventLike,
} from "./energy.js";
import { entryTotals, looksSweet, parseOffProduct } from "./nutrition.js";

// Appendix A of the requirements: a real AiLink report and app screen, height 169 cm.
const report = {
  measured_at: "2026-11-10T06:58:00+07:00",
  weight_kg: 56.7, body_fat_pct: 12.3, body_fat_mass_kg: 7.0, skeletal_muscle_mass_kg: 25.5,
  body_water_pct: 60.1, protein_mass_kg: 9.2, protein_pct: 16.2, bone_mass_kg: 2.5,
  visceral_fat_index: 3, subcutaneous_fat_pct: 11.4, bmr_kcal: 1377, limb_muscle_index: 7.4,
  bmi: 19.8, muscle_rate_pct: 83.2,
};
const appScreen = {
  measured_at: "2026-11-10T06:58:00+07:00",
  weight_kg: 56.7, bmi: 19.8, body_fat_pct: 12.3, muscle_rate_pct: 83.2, skeletal_muscle_mass_kg: 25.5,
  body_water_pct: 60.1, bone_mass_kg: 2.5, bmr_kcal: 1377, protein_pct: 16.2, body_age: 24,
  visceral_fat_index: 3, subcutaneous_fat_pct: 11.4,
};

describe("body readings", () => {
  it("passes every check on both Appendix A fixtures", () => {
    expect(checkReading(report, 169)).toEqual([]);
    expect(checkReading(appScreen, 169)).toEqual([]);
  });

  it("derives fat and protein mass from the app screen's rates", () => {
    const d = deriveReading(appScreen);
    expect(d.body_fat_mass_kg).toBeCloseTo(6.97, 2);
    expect(d.protein_mass_kg).toBeCloseTo(9.19, 2);
    expect(deriveReading(report).body_fat_mass_kg).toBe(7.0);
  });

  it("flags a misread digit and big jumps", () => {
    const misread = checkReading({ ...report, weight_kg: 65.7 }, 169, { weight_kg: 56.7, body_fat_pct: 12.3 });
    expect(misread.map((i) => i.field)).toEqual(expect.arrayContaining(["body_fat_mass_kg", "bmi", "muscle_rate_pct", "weight_kg"]));
    expect(checkReading({ ...appScreen, body_fat_pct: 400 }, 169).some((i) => i.level === "error")).toBe(true);
  });

  it("defaults 04:00–09:00 local to fasted morning", () => {
    expect(localHour(new Date("2026-11-10T06:58:00+07:00"), "Asia/Jakarta")).toBe(6);
    expect(defaultContext(6)).toBe("fasted_morning");
    expect(defaultContext(9)).toBe("other");
    expect(defaultContext(3)).toBe("other");
  });
});

const days = (start: string, n: number, f: (i: number) => number): DayValue[] =>
  Array.from({ length: n }, (_, i) => ({ date: addDaysKey(start, i), value: f(i) }));

describe("trends", () => {
  it("averages same-day readings, then a trailing 7-day mean", () => {
    const daily = dailyMeans([{ date: "2026-11-02", value: 57 }, { date: "2026-11-02", value: 56 }, { date: "2026-11-01", value: 58 }]);
    expect(daily).toEqual([{ date: "2026-11-01", value: 58 }, { date: "2026-11-02", value: 56.5 }]);
    const ma = movingAverage(days("2026-11-01", 10, (i) => i));
    expect(ma[0].value).toBe(0);
    expect(ma[9].value).toBe(6); // mean of 3..9
  });

  it("fits a least-squares slope per day", () => {
    expect(slopePerDay(days("2026-11-01", 10, (i) => 60 - 0.1 * i))).toBeCloseTo(-0.1, 6);
    expect(slopePerDay([{ date: "2026-11-01", value: 1 }])).toBeNull();
  });

  it("uses fasted readings for weekly body fat only when there are 3+", () => {
    const wk = weeklyBodyFat([
      { date: "2026-11-02", body_fat_pct: 12, context: "fasted_morning" },
      { date: "2026-11-03", body_fat_pct: 12.4, context: "fasted_morning" },
      { date: "2026-11-04", body_fat_pct: 12.2, context: "fasted_morning" },
      { date: "2026-11-05", body_fat_pct: 15, context: "post_run" },
      { date: "2026-11-10", body_fat_pct: 13, context: "other" },
    ]);
    expect(wk).toEqual([
      { week_start: "2026-11-02", mean: 12.2, n: 3, low_confidence: false },
      { week_start: "2026-11-09", mean: 13, n: 1, low_confidence: true },
    ]);
    expect(weekStartKey("2026-11-08")).toBe("2026-11-02"); // Sunday → Monday before
  });
});

const run = (date: string, km: string, extra: Partial<PlannerEventLike["details"]> = {}, title = "Run"): PlannerEventLike => ({
  date, type: "run", title, done: true, details: { km, ...extra },
});

describe("training", () => {
  it("sums structured run distance like the frontend", () => {
    const e: PlannerEventLike = {
      date: "2026-11-10", type: "run", title: "Intervals", done: true,
      details: { segments: [
        { rounds: 1, steps: [{ amount: "2", unit: "km" }] },
        { rounds: 4, steps: [{ amount: "800", unit: "m" }, { amount: "2", unit: "min" }] },
        { rounds: 1, steps: [{ amount: "10", unit: "min", intensity: "pace", pace: "5:00" }] },
      ] },
    };
    expect(runKm(e)).toBe(7.2);
  });

  it("infers hard, easy and rest days", () => {
    const cfg = withDefaults({});
    expect(inferDayType([run("d", "18")], cfg)).toBe("hard");
    expect(inferDayType([run("d", "8", {}, "Tempo Tuesday")], cfg)).toBe("hard");
    expect(inferDayType([run("d", "8", { runType: "easy" })], cfg)).toBe("easy");
    expect(inferDayType([], cfg)).toBe("rest");
  });

  it("counts runs at 1 kcal/kg/km and other sessions at device kcal", () => {
    const load = trainingLoad(
      [run("d", "10", { duration_min: "55" }), { date: "d", type: "workout", title: "Gym", done: true, details: { device_kcal: "200", duration_min: "45" } }, { ...run("d", "5"), done: false }],
      56.7,
    );
    expect(load).toEqual({ km: 10, minutes: 100, exercise_kcal: 767, long_run_km: 10 });
  });
});

const profile = { weightKg: 56.7, heightCm: 169, age: 25, sex: "male" as const, scaleBmr: 1377, override: null };

describe("maintenance", () => {
  it("bootstrap lands near 2,400–2,600 kcal for the Appendix A runner", () => {
    // 42 km/week over the 21-day window, plus a ~135 kcal daily bike commute.
    const m = estimateMaintenance({ ...profile, cfg: withDefaults({ daily_activity_kcal: 135 }), intake: [], weights: [], exerciseKcal: 126 * 56.7 });
    expect(m.inputs.bmr_kcal).toBe(1503);
    expect(m.kcal).toBeGreaterThanOrEqual(2400);
    expect(m.kcal).toBeLessThanOrEqual(2600);
    expect(m.confidence).toBe("low");
    expect(m.measured_kcal).toBeNull();
  });

  it("moves fully to the measured value after 21 logged days", () => {
    const losing = days("2026-10-01", 21, (i) => 57 - (0.1 / 7) * i); // −0.1 kg/week
    const m = estimateMaintenance({ ...profile, cfg: withDefaults({}), intake: days("2026-10-01", 21, () => 2500), weights: losing, exerciseKcal: 0 });
    expect(m.blend_weight).toBe(1);
    expect(m.measured_kcal).toBe(2610); // 2500 + 0.0143 kg/day × 7700
    expect(m.kcal).toBe(2610);
    expect(m.confidence).toBe("high");
  });

  it("blends partway between 14 and 21 days and honours an override", () => {
    const m = estimateMaintenance({ ...profile, cfg: withDefaults({}), intake: days("2026-10-01", 14, () => 2500), weights: days("2026-10-01", 14, () => 57), exerciseKcal: 0 });
    expect(m.blend_weight).toBeCloseTo(0.67, 2);
    expect(Math.abs(m.kcal - ((2 / 3) * 2500 + m.bootstrap_kcal / 3))).toBeLessThanOrEqual(1);
    expect(estimateMaintenance({ ...profile, override: 2700, cfg: withDefaults({}), intake: [], weights: [], exerciseKcal: 0 }).kcal).toBe(2700);
  });
});

describe("targets", () => {
  const week = ["hard", "easy", "rest", "easy", "hard", "rest", "easy"] as const;
  const base = { maintenance: 2500, cfg: withDefaults({}), weightKg: 56.7, weekDayTypes: [...week], bodyFatPct: 12.3, bmi: 19.8, date: "2026-11-12" };

  it("spreads the weekly budget by day type and keeps protein constant", () => {
    const perDay = week.map((dayType) => dayTargets({ ...base, goal: "mileage_fueling", dayType }));
    const total = perDay.reduce((s, t) => s + t.kcal, 0);
    expect(Math.abs(total - 2500 * 7)).toBeLessThanOrEqual(7);
    expect(perDay[0].kcal).toBeGreaterThan(perDay[2].kcal);
    expect(new Set(perDay.map((t) => t.protein_g))).toEqual(new Set([102])); // 1.8 g/kg
    const t = perDay[1];
    expect(t.fat_g * 9).toBeGreaterThanOrEqual(t.kcal * 0.25 - 9);
    expect(t.sweets_kcal_cap).toBe(Math.round(t.kcal * 0.1));
  });

  it("never sets a deficit for a lean runner unless asked", () => {
    expect(dayTargets({ ...base, goal: "fat_loss_endurance", dayType: "easy" }).notes[0]).toMatch(/lean/i);
    const lean = dayTargets({ ...base, goal: "fat_loss_endurance", dayType: "easy", bodyFatPct: 18, bmi: 23 });
    expect(lean.kcal).toBeLessThan(2500 * 0.9);
    const taper = dayTargets({ ...base, goal: "fat_loss_endurance", dayType: "easy", bodyFatPct: 18, bmi: 23, cfg: withDefaults({ race_date: "2026-11-20" }) });
    expect(taper.notes[0]).toMatch(/taper/i);
  });
});

describe("nutrition", () => {
  it("scales per-100g values by grams", () => {
    expect(entryTotals({ kcal_100g: 130, protein_100g: 2.7, carbs_100g: 28, fat_100g: 0.3, fiber_100g: null }, 150)).toEqual({
      kcal: 195, protein_g: 4.1, carbs_g: 42, fat_g: 0.5, fiber_g: null, sugar_g: null,
    });
  });

  it("suggests sweet from sugar or keywords", () => {
    expect(looksSweet("Granola", 22, DEFAULT_CONFIG)).toBe(true);
    expect(looksSweet("Dark Chocolate", null, DEFAULT_CONFIG)).toBe(true);
    expect(looksSweet("Rice", 0.1, DEFAULT_CONFIG)).toBe(false);
  });

  it("parses Open Food Facts and lists missing nutriments", () => {
    const parsed = parseOffProduct("8991", { status: 1, product: { product_name: "Teh", nutriments: { energy_100g: 418.4, sugars_100g: 10 } } });
    expect(parsed?.food.kcal_100g).toBe(100);
    expect(parsed?.missing).toEqual(["protein_100g", "carbs_100g", "fat_100g"]);
    expect(parseOffProduct("0", { status: 0 })).toBeNull();
  });
});
