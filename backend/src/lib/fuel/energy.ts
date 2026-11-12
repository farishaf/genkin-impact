// Trend, maintenance and target math. Pure functions over plain numbers; the route does the SQL.
import type { DayType, FuelConfig, GoalProfile, Sex } from "./config.js";

export interface DayValue {
  date: string; // YYYY-MM-DD
  value: number;
}

// ---------- date keys (UTC arithmetic on YYYY-MM-DD, no timezone drift) ----------

const DAY_MS = 864e5;
const keyMs = (k: string) => Date.parse(`${k}T00:00:00Z`);
export const addDaysKey = (k: string, n: number) => new Date(keyMs(k) + n * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((keyMs(b) - keyMs(a)) / DAY_MS);
/** Monday of the key's week. */
export const weekStartKey = (k: string) => addDaysKey(k, -((new Date(keyMs(k)).getUTCDay() + 6) % 7));

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const round = (v: number, dp = 0) => Math.round(v * 10 ** dp) / 10 ** dp;

// ---------- trends ----------

/** Several readings on one day collapse to their mean. Sorted by date. */
export function dailyMeans(points: DayValue[]): DayValue[] {
  const byDay = new Map<string, number[]>();
  for (const p of points) byDay.set(p.date, [...(byDay.get(p.date) ?? []), p.value]);
  return [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([date, vs]) => ({ date, value: mean(vs) }));
}

/** Trailing moving average per day that has a value: the mean of daily values in (d − window, d]. */
export function movingAverage(daily: DayValue[], window = 7): DayValue[] {
  return daily.map((d) => {
    const inWindow = daily.filter((p) => p.date <= d.date && daysBetween(p.date, d.date) < window);
    return { date: d.date, value: mean(inWindow.map((p) => p.value)) };
  });
}

/** Least-squares slope in value per day. Null with fewer than two distinct days. */
export function slopePerDay(points: DayValue[]): number | null {
  if (points.length < 2) return null;
  const x0 = points[0].date;
  const xs = points.map((p) => daysBetween(x0, p.date));
  const ys = points.map((p) => p.value);
  const mx = mean(xs);
  const my = mean(ys);
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  if (sxx === 0) return null;
  return xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / sxx;
}

export interface FatReading {
  date: string;
  body_fat_pct: number;
  context: string;
}

/**
 * Weekly mean body fat. BIA swings with hydration and food, so a week with 3+ fasted-morning readings
 * uses only those; otherwise all readings, labelled low confidence.
 */
export function weeklyBodyFat(readings: FatReading[]) {
  const byWeek = new Map<string, FatReading[]>();
  for (const r of readings) {
    const w = weekStartKey(r.date);
    byWeek.set(w, [...(byWeek.get(w) ?? []), r]);
  }
  return [...byWeek]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week_start, rs]) => {
      const fasted = rs.filter((r) => r.context === "fasted_morning");
      const used = fasted.length >= 3 ? fasted : rs;
      return { week_start, mean: round(mean(used.map((r) => r.body_fat_pct)), 1), n: used.length, low_confidence: fasted.length < 3 };
    });
}

// ---------- training ----------

interface RunStep {
  amount?: string;
  unit?: string;
  intensity?: string;
  pace?: string;
  paceTo?: string;
}
export interface PlannerEventLike {
  date: string;
  type: string;
  title: string;
  done: boolean;
  details: {
    segments?: { rounds: number; steps: RunStep[] }[];
    km?: string;
    runType?: string;
    duration_min?: string;
    device_kcal?: string;
  };
}

const num = (v?: string) => {
  const n = parseFloat((v ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const paceMin = (p = "") => {
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(p.trim());
  return m ? Number(m[1]) + Number(m[2]) / 60 : 0;
};

/** Planned distance of a run. Mirrors frontend runTotals: time steps count only when they carry a pace. */
export function runKm(e: PlannerEventLike): number {
  const segs = e.details.segments;
  if (!segs?.length) return num(e.details.km);
  let km = 0;
  for (const seg of segs) {
    for (const s of seg.steps) {
      const a = num(s.amount);
      const lo = paceMin(s.pace);
      const hi = paceMin(s.paceTo);
      const pace = s.intensity === "pace" || (!s.intensity && s.pace) ? (lo && hi ? (lo + hi) / 2 : lo || hi) : 0;
      const stepKm = s.unit === "km" ? a : s.unit === "m" ? a / 1000 : pace ? (s.unit === "min" ? a : a / 60) / pace : 0;
      km += stepKm * seg.rounds;
    }
  }
  return round(km, 2);
}

const HARD_RUNS = ["long", "tempo", "intervals", "hills", "threshold"];
/** Same title guess as frontend runTypeOf, for runs saved before runType existed. */
function runType(e: PlannerEventLike) {
  if (e.details.runType) return e.details.runType;
  const t = e.title.toLowerCase();
  return HARD_RUNS.find((k) => t.includes(k === "intervals" ? "interval" : k === "hills" ? "hill" : k)) ?? "easy";
}

/** A long or quality run makes the day hard; any other session makes it easy; nothing planned is rest. */
export function inferDayType(dayEvents: PlannerEventLike[], cfg: FuelConfig): DayType {
  const runs = dayEvents.filter((e) => e.type === "run");
  if (runs.some((r) => HARD_RUNS.includes(runType(r)) || runKm(r) >= cfg.long_run_km)) return "hard";
  return dayEvents.some((e) => e.type === "run" || e.type === "workout") ? "easy" : "rest";
}

/** Done sessions in a list: km, minutes (where logged) and exercise kcal (runs ≈ 1 kcal/kg/km, others device kcal). */
export function trainingLoad(events: PlannerEventLike[], weightKg: number) {
  let km = 0;
  let minutes = 0;
  let kcal = 0;
  let longRun = 0;
  for (const e of events) {
    if (!e.done || (e.type !== "run" && e.type !== "workout")) continue;
    minutes += num(e.details.duration_min);
    if (e.type === "run") {
      const k = runKm(e);
      km += k;
      longRun = Math.max(longRun, k);
      kcal += k * weightKg;
    } else {
      kcal += num(e.details.device_kcal);
    }
  }
  return { km: round(km, 1), minutes: Math.round(minutes), exercise_kcal: Math.round(kcal), long_run_km: round(longRun, 1) };
}

// ---------- maintenance ----------

export function mifflinBmr(p: { weightKg: number; heightCm: number; age: number; sex: Sex }) {
  return 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === "male" ? 5 : -161);
}

export interface MaintenanceInput {
  weightKg: number;
  heightCm: number;
  age: number;
  sex: Sex;
  cfg: FuelConfig;
  /** Kcal per day with logged food, inside the window. */
  intake: DayValue[];
  /** Daily mean weights inside the window. */
  weights: DayValue[];
  /** Logged exercise kcal over the whole window. */
  exerciseKcal: number;
  scaleBmr: number | null;
  override: number | null;
}

/**
 * Bootstrap (Mifflin–St Jeor × activity + logged exercise) blended toward the measured estimate
 * (mean intake − weight slope × kcal/kg) as logged days accumulate: w = min(1, days / window).
 */
export function estimateMaintenance(inp: MaintenanceInput) {
  const { cfg } = inp;
  const window = cfg.maintenance_window_days;
  const bmr = mifflinBmr(inp);
  const exercisePerDay = inp.exerciseKcal / window;
  const bootstrap = bmr * cfg.activity_factor + exercisePerDay + cfg.daily_activity_kcal;

  // Only full 7-day windows: a shorter window at the start averages fewer days and flattens the slope.
  const first = inp.weights[0]?.date;
  const slope = slopePerDay(movingAverage(inp.weights).filter((p) => daysBetween(first, p.date) >= 6));
  // ponytail: a day with any logged food counts as complete; add an explicit "day complete" flag if half-logged days skew this.
  const enough = inp.intake.length >= cfg.min_intake_days && inp.weights.length >= cfg.min_weigh_ins && slope !== null;
  const measured = enough ? mean(inp.intake.map((d) => d.value)) - slope! * cfg.kcal_per_kg : null;
  const w = measured === null ? 0 : Math.min(1, inp.intake.length / window);
  const blended = w * (measured ?? 0) + (1 - w) * bootstrap;

  return {
    kcal: Math.round(inp.override ?? blended),
    bootstrap_kcal: Math.round(bootstrap),
    measured_kcal: measured === null ? null : Math.round(measured),
    blend_weight: round(w, 2),
    confidence: inp.override ? ("manual" as const) : w === 0 ? ("low" as const) : w < 1 ? ("medium" as const) : ("high" as const),
    inputs: {
      bmr_kcal: Math.round(bmr),
      scale_bmr_kcal: inp.scaleBmr,
      activity_factor: cfg.activity_factor,
      exercise_kcal_per_day: Math.round(exercisePerDay),
      daily_activity_kcal: cfg.daily_activity_kcal,
      intake_days: inp.intake.length,
      weigh_ins: inp.weights.length,
      slope_kg_per_week: slope === null ? null : round(slope * 7, 2),
    },
  };
}

// ---------- targets ----------

export interface TargetInput {
  maintenance: number;
  goal: GoalProfile;
  cfg: FuelConfig;
  weightKg: number;
  dayType: DayType;
  /** Day types of the 7 days of this week, for normalising the day weights. */
  weekDayTypes: DayType[];
  bodyFatPct: number | null;
  bmi: number | null;
  date: string;
}

export function dayTargets(t: TargetInput) {
  const { cfg } = t;
  const notes: string[] = [];
  let budget = t.maintenance;
  if (t.goal === "fat_loss_endurance") {
    const lean = (t.bodyFatPct !== null && t.bodyFatPct <= cfg.lean_floor_bf_pct) || (t.bmi !== null && t.bmi <= cfg.lean_floor_bmi);
    const taper = cfg.race_date !== null && daysBetween(t.date, cfg.race_date) >= 0 && daysBetween(t.date, cfg.race_date) < cfg.taper_weeks * 7;
    if (taper) notes.push("Race taper: eating at maintenance.");
    else if (lean && !cfg.allow_deficit_below_floor) notes.push("Already lean, so no deficit is set. Maintenance or a small surplus fits better.");
    else {
      if (lean) notes.push("Deficit below the lean floor is on by your choice. BIA body fat can be off by several points.");
      budget = t.maintenance * (1 - Math.min(cfg.deficit_pct, cfg.deficit_cap_pct) / 100);
    }
  } else if (t.goal === "lean_gain") {
    budget = t.maintenance + cfg.surplus_kcal;
  }

  const weights = cfg.day_type_weights;
  const weekMean = t.weekDayTypes.length ? mean(t.weekDayTypes.map((d) => weights[d])) : 1;
  const kcal = Math.round((budget * weights[t.dayType]) / weekMean);
  const protein_g = Math.round(cfg.protein_g_per_kg[t.goal] * t.weightKg);
  const fat_g = Math.round((kcal * cfg.fat_floor_pct) / 100 / 9);
  const carbs_g = Math.max(0, Math.round((kcal - protein_g * 4 - fat_g * 9) / 4));
  return {
    kcal,
    protein_g,
    fat_g,
    carbs_g,
    fiber_g: cfg.fiber_target_g,
    sweets_kcal_cap: Math.round((kcal * cfg.sweets_kcal_cap_pct) / 100),
    notes,
  };
}
