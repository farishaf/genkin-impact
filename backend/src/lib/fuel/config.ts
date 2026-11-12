// Fuel defaults. These are common training/nutrition guidance, not medical advice.
// A user's fuel_profiles.config holds only the keys they changed; withDefaults fills the rest.

export type GoalProfile = "mileage_fueling" | "fat_loss_endurance" | "lean_gain";
export type DayType = "hard" | "easy" | "rest";
export type Sex = "male" | "female";

export const DEFAULT_CONFIG = {
  /** Calorie weight per day type, normalised so the week averages the weekly budget. */
  day_type_weights: { rest: 0.95, easy: 1.0, hard: 1.1 } as Record<DayType, number>,
  /** A run this long or longer makes the day `hard`, whatever its type. */
  long_run_km: 16,
  kcal_per_kg: 7700,
  maintenance_window_days: 21,
  min_intake_days: 14,
  min_weigh_ins: 10,
  /** Living, excluding logged exercise, as a multiple of BMR (bootstrap estimate). */
  activity_factor: 1.3,
  /** Daily activity that isn't logged as a session, e.g. a 30-minute bike commute (~100–170 kcal). */
  daily_activity_kcal: 0,
  protein_g_per_kg: { mileage_fueling: 1.8, fat_loss_endurance: 2.1, lean_gain: 1.9 } as Record<GoalProfile, number>,
  fat_floor_pct: 25,
  fiber_target_g: 30,
  sweets_kcal_cap_pct: 10,
  /** Sugar per 100 g at or above which a food is suggested as `sweet`. */
  sweet_sugar_g_100g: 15,
  sweet_keywords: [
    "chocolate", "cake", "cookie", "candy", "ice cream", "donut", "doughnut", "soda", "biscuit", "pastry", "dessert",
    "coklat", "kue", "permen", "es krim", "martabak manis", "チョコ", "ケーキ", "アイス",
  ],
  deficit_pct: 12.5,
  deficit_cap_pct: 20,
  surplus_kcal: 300,
  lean_floor_bf_pct: 12,
  lean_floor_bmi: 20,
  /** Explicit opt-in to a deficit below the lean floor. */
  allow_deficit_below_floor: false,
  race_date: null as string | null,
  taper_weeks: 2,
};

export type FuelConfig = typeof DEFAULT_CONFIG;

export function withDefaults(stored: Partial<FuelConfig> | null | undefined): FuelConfig {
  const c = stored ?? {};
  return {
    ...DEFAULT_CONFIG,
    ...c,
    day_type_weights: { ...DEFAULT_CONFIG.day_type_weights, ...c.day_type_weights },
    protein_g_per_kg: { ...DEFAULT_CONFIG.protein_g_per_kg, ...c.protein_g_per_kg },
  };
}
