// Body-composition readings: plausibility ranges, cross-field checks, derived fields, default context.
// The cross-field checks catch misread numbers for free, before a reading is saved.

export interface BodyReadingInput {
  measured_at: string;
  weight_kg: number;
  body_fat_pct?: number | null;
  body_fat_mass_kg?: number | null;
  skeletal_muscle_mass_kg?: number | null;
  body_water_pct?: number | null;
  protein_mass_kg?: number | null;
  protein_pct?: number | null;
  bone_mass_kg?: number | null;
  visceral_fat_index?: number | null;
  subcutaneous_fat_pct?: number | null;
  bmr_kcal?: number | null;
  limb_muscle_index?: number | null;
  muscle_rate_pct?: number | null;
  body_age?: number | null;
  bmi?: number | null;
}

export type Context = "fasted_morning" | "post_run" | "other";

export interface Issue {
  field: keyof BodyReadingInput;
  level: "error" | "warn";
  message: string;
}

export const RANGES: Partial<Record<keyof BodyReadingInput, [number, number]>> = {
  weight_kg: [25, 250],
  body_fat_pct: [2, 60],
  body_fat_mass_kg: [0.5, 150],
  skeletal_muscle_mass_kg: [5, 80],
  body_water_pct: [30, 80],
  protein_mass_kg: [1, 40],
  protein_pct: [5, 30],
  bone_mass_kg: [0.5, 8],
  visceral_fat_index: [1, 60],
  subcutaneous_fat_pct: [1, 60],
  bmr_kcal: [600, 4000],
  limb_muscle_index: [2, 15],
  muscle_rate_pct: [30, 95],
  body_age: [10, 100],
  bmi: [10, 60],
};

const has = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const round = (v: number, dp = 2) => Math.round(v * 10 ** dp) / 10 ** dp;

/**
 * Checks a reading as entered (run this before deriveReading, or a derived fat mass passes trivially).
 * `prev` is the previous reading, for jump warnings.
 */
export function checkReading(r: BodyReadingInput, heightCm: number | null, prev?: { weight_kg: number; body_fat_pct: number | null } | null): Issue[] {
  const issues: Issue[] = [];
  for (const [field, [lo, hi]] of Object.entries(RANGES) as [keyof BodyReadingInput, [number, number]][]) {
    const v = r[field];
    if (has(v as number) && ((v as number) < lo || (v as number) > hi)) {
      issues.push({ field, level: "error", message: `${field} ${v} is outside ${lo}–${hi}.` });
    }
  }
  const w = r.weight_kg;
  if (has(r.body_fat_mass_kg) && has(r.body_fat_pct) && Math.abs((r.body_fat_mass_kg / w) * 100 - r.body_fat_pct) > 0.5) {
    issues.push({ field: "body_fat_mass_kg", level: "warn", message: "Fat mass and body fat % don't agree. Check both numbers." });
  }
  if (has(r.bmi) && heightCm && Math.abs(w / (heightCm / 100) ** 2 - r.bmi) > 0.2) {
    issues.push({ field: "bmi", level: "warn", message: "BMI doesn't match weight and height. Check the weight." });
  }
  if (has(r.muscle_rate_pct) && has(r.body_fat_pct) && has(r.bone_mass_kg) && Math.abs(100 - r.body_fat_pct - (r.bone_mass_kg / w) * 100 - r.muscle_rate_pct) > 0.5) {
    issues.push({ field: "muscle_rate_pct", level: "warn", message: "Muscle rate doesn't match body fat and bone mass. Check those numbers." });
  }
  if (prev) {
    if (Math.abs(w - prev.weight_kg) > 2) issues.push({ field: "weight_kg", level: "warn", message: `Weight moved ${round(w - prev.weight_kg, 1)} kg since the last reading.` });
    if (has(r.body_fat_pct) && has(prev.body_fat_pct) && Math.abs(r.body_fat_pct - prev.body_fat_pct) > 3) {
      issues.push({ field: "body_fat_pct", level: "warn", message: `Body fat moved ${round(r.body_fat_pct - prev.body_fat_pct, 1)} points since the last reading.` });
    }
  }
  return issues;
}

/** The app screen shows rates, not masses: fill fat mass and protein mass from them when missing. */
export function deriveReading<T extends BodyReadingInput>(r: T): T & { body_fat_mass_kg: number | null; protein_mass_kg: number | null } {
  return {
    ...r,
    body_fat_mass_kg: has(r.body_fat_mass_kg) ? r.body_fat_mass_kg : has(r.body_fat_pct) ? round((r.weight_kg * r.body_fat_pct) / 100) : null,
    protein_mass_kg: has(r.protein_mass_kg) ? r.protein_mass_kg : has(r.protein_pct) ? round((r.weight_kg * r.protein_pct) / 100) : null,
  };
}

/** Hour 0–23 of an instant in a timezone. */
export function localHour(at: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(at));
}

/** Readings between 04:00 and 09:00 local time are assumed fasted morning readings. */
export const defaultContext = (hour: number): Context => (hour >= 4 && hour < 9 ? "fasted_morning" : "other");
