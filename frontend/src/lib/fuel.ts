import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export type DayType = "hard" | "easy" | "rest";
export type GoalProfile = "mileage_fueling" | "fat_loss_endurance" | "lean_gain";

export interface Food {
  id: string;
  name: string;
  barcode: string | null;
  kcal_100g: number;
  protein_100g: number;
  carbs_100g: number;
  fat_100g: number;
  fiber_100g: number | null;
  sugar_100g: number | null;
  serving_g: number | null;
  is_sweet: boolean;
  source: string;
}
export type FoodDraft = Omit<Food, "id">;

export interface Entry {
  id: string;
  date: string;
  eaten_at: string;
  food_id: string | null;
  name: string;
  grams: number;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  is_sweet: boolean;
  is_planned: boolean;
  source: string;
}

export interface Reading {
  id: string;
  date: string;
  measured_at: string;
  weight_kg: number;
  body_fat_pct: number | null;
  skeletal_muscle_mass_kg: number | null;
  body_water_pct: number | null;
  context: "fasted_morning" | "post_run" | "other";
}

export interface Summary {
  date: string;
  profile: { goal_profile: GoalProfile; sweets_kcal_cap_pct: number };
  day_type: DayType;
  day_type_inferred: boolean;
  week: { date: string; day_type: DayType }[];
  today: { kcal: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number; sugar_g: number; sweets_kcal: number; sweets_planned_kcal: number; entries: number; protein_g_per_kg: number | null };
  targets: { kcal: number; protein_g: number; fat_g: number; carbs_g: number; fiber_g: number; sweets_kcal_cap: number; notes: string[] } | null;
  weight: { latest_kg: number | null; points: { date: string; value: number }[]; trend: { date: string; value: number }[] };
  body_fat_weekly: { week_start: string; mean: number; n: number; low_confidence: boolean }[];
  tape: { id: string; date: string; waist_cm: number | null }[];
  maintenance: {
    kcal: number;
    bootstrap_kcal: number;
    measured_kcal: number | null;
    blend_weight: number;
    confidence: "low" | "medium" | "high" | "manual";
    inputs: { bmr_kcal: number; scale_bmr_kcal: number | null; activity_factor: number; exercise_kcal_per_day: number; daily_activity_kcal: number; intake_days: number; weigh_ins: number; slope_kg_per_week: number | null };
  } | null;
  energy_balance_7d: number | null;
  training: {
    this_week: { km: number; minutes: number; long_run_km: number };
    last_week: { km: number; minutes: number; long_run_km: number };
    km_change_pct: number | null;
  };
  recovery: { date: string; sleep_h: number | null; resting_hr: number | null; soreness: number | null }[];
}

export interface Profile {
  height_cm: number;
  sex: "male" | "female";
  birth_year: number;
  goal_profile: GoalProfile;
  maintenance_override_kcal: number | null;
  config: { race_date: string | null; sweets_kcal_cap_pct: number; daily_activity_kcal: number; allow_deficit_below_floor: boolean } & Record<string, unknown>;
}

// Every fuel query key starts with "fuel", so one invalidation refreshes the dashboard after any write.
const useFuelMutation = <V,>(fn: (v: V) => Promise<unknown>) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ["fuel"] }) });
};

export const useSummary = (date: string) =>
  useQuery({ queryKey: ["fuel", "summary", date], queryFn: () => api.get<Summary>(`/fuel/summary?date=${date}`) });
export const useEntries = (date: string) =>
  useQuery({ queryKey: ["fuel", "entries", date], queryFn: () => api.get<{ entries: Entry[] }>(`/fuel/entries?date=${date}`).then((r) => r.entries) });
export const useFoods = (q: string) =>
  useQuery({ queryKey: ["fuel", "foods", q], queryFn: () => api.get<{ foods: Food[] }>(`/fuel/foods?q=${encodeURIComponent(q)}`).then((r) => r.foods) });
export const useReadings = (from: string, to: string) =>
  useQuery({ queryKey: ["fuel", "body", from, to], queryFn: () => api.get<{ readings: Reading[] }>(`/fuel/body?from=${from}&to=${to}`).then((r) => r.readings) });
export const useProfile = () => useQuery({ queryKey: ["fuel", "profile"], queryFn: () => api.get<{ profile: Profile }>("/fuel/profile").then((r) => r.profile) });

export const useAddEntry = () => useFuelMutation((body: Record<string, unknown>) => api.post("/fuel/entries", body));
export const usePatchEntry = () => useFuelMutation(({ id, ...body }: { id: string } & Partial<Entry>) => api.patch(`/fuel/entries/${id}`, body));
export const useDeleteEntry = () => useFuelMutation((id: string) => api.del(`/fuel/entries/${id}`));
export const useCopyDay = () => useFuelMutation((body: { from: string; to: string }) => api.post("/fuel/entries/copy", body));
export const useSaveFood = () => useFuelMutation((body: Partial<FoodDraft>) => api.post<{ food: Food }>("/fuel/foods", body).then((r) => r.food));
export const useAddReading = () => useFuelMutation((body: Record<string, unknown>) => api.post("/fuel/body", body));
export const useDeleteData = () => useFuelMutation(() => api.del("/fuel/data"));
export const useAddTape = () => useFuelMutation((body: Record<string, unknown>) => api.post("/fuel/tape", body));
export const useSaveProfile = () => useFuelMutation((p: Profile) => api.put("/fuel/profile", p));
export const useSetDay = () =>
  useFuelMutation(({ date, ...body }: { date: string; day_type: DayType | null; sleep_h?: number | null; resting_hr?: number | null; soreness?: number | null }) => api.put(`/fuel/days/${date}`, body));

export const lookupBarcode = (code: string) => api.get<{ food: FoodDraft & { id?: string }; saved: boolean; missing: string[] }>(`/fuel/barcode/${code}`);

/** "" or junk → null; "56,7" → 56.7. */
export const numOrNull = (v: string) => {
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

export const DAY_LABEL: Record<DayType, string> = { hard: "Hard day", easy: "Easy day", rest: "Rest day" };
