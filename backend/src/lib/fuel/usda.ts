// Per-100g data for AI-listed items: USDA FoodData Central (Foundation, SR Legacy) first, then the user's
// saved foods, and only then the model's own estimate, marked `estimated` so the confirm screen says so.
import { pool } from "../../db/pool.js";
import { env } from "../../env.js";
import type { MealExtract } from "./ai.js";

export interface Per100Data {
  kcal_100g: number;
  protein_100g: number;
  carbs_100g: number;
  fat_100g: number;
  fiber_100g: number | null;
  sugar_100g: number | null;
}

// FDC nutrient ids. Foundation foods often carry Atwater energy (2047/2048) instead of 1008, and total sugars as 1063.
const ID = { kcal: [1008, 2048, 2047], protein: [1003], fat: [1004], carbs: [1005], fiber: [1079], sugar: [2000, 1063] };

interface FdcFood {
  description: string;
  foodNutrients?: { nutrientId: number; value?: number }[];
}

export function fdcPer100(food: FdcFood): Per100Data | null {
  const pick = (ids: number[]) => {
    for (const id of ids) {
      const v = food.foodNutrients?.find((x) => x.nutrientId === id)?.value;
      if (typeof v === "number") return v;
    }
    return null;
  };
  const kcal = pick(ID.kcal);
  if (kcal === null) return null;
  return { kcal_100g: kcal, protein_100g: pick(ID.protein) ?? 0, carbs_100g: pick(ID.carbs) ?? 0, fat_100g: pick(ID.fat) ?? 0, fiber_100g: pick(ID.fiber), sugar_100g: pick(ID.sugar) };
}

// ponytail: per-process cache by normalised name; generic foods don't change, and the key's limit is ~1,000 requests/hour.
const cache = new Map<string, { name: string; per100: Per100Data } | null>();

export async function usdaLookup(name: string): Promise<{ name: string; per100: Per100Data } | null> {
  if (!env.USDA_API_KEY) return null;
  const key = name.trim().toLowerCase();
  if (cache.has(key)) return cache.get(key)!;
  const res = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(env.USDA_API_KEY)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ query: name, dataType: ["Foundation", "SR Legacy"], pageSize: 1 }),
  }).catch(() => null);
  if (!res?.ok) {
    if (res) console.error(`usda lookup: ${res.status}`);
    return null; // not cached: a transient failure shouldn't stick
  }
  const food = ((await res.json().catch(() => null)) as { foods?: FdcFood[] } | null)?.foods?.[0];
  const per100 = food ? fdcPer100(food) : null;
  const hit = food && per100 ? { name: food.description, per100 } : null;
  cache.set(key, hit);
  return hit;
}

export type Per100Source = "usda" | "saved" | "estimated";

/** Gives every item per-100g values and says where they came from. Totals are computed by the app from these. */
export async function resolveItems(userId: string | null, items: MealExtract["items"]) {
  return Promise.all(
    items
      .filter((it) => it.name.trim() && it.grams > 0 && it.grams <= 3000)
      .map(async (it) => {
        const base = { name: it.name.trim(), grams: Math.round(it.grams), confidence: Math.max(0, Math.min(1, it.confidence)) };
        const usda = await usdaLookup(base.name);
        if (usda) return { ...base, per100: usda.per100, per100_source: "usda" as Per100Source, matched: usda.name };
        const saved = userId === null ? null : (await pool.query("SELECT * FROM foods WHERE user_id = $1 AND name ILIKE '%' || $2 || '%' ORDER BY length(name) LIMIT 1", [userId, base.name])).rows[0];
        if (saved) {
          const { kcal_100g, protein_100g, carbs_100g, fat_100g, fiber_100g, sugar_100g } = saved;
          return { ...base, per100: { kcal_100g, protein_100g, carbs_100g, fat_100g, fiber_100g, sugar_100g }, per100_source: "saved" as Per100Source, matched: saved.name as string };
        }
        const e = it.per_100g_estimate;
        const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
        return {
          ...base,
          per100: { kcal_100g: clamp(e.kcal, 900), protein_100g: clamp(e.protein_g, 100), carbs_100g: clamp(e.carbs_g, 100), fat_100g: clamp(e.fat_g, 100), fiber_100g: null, sugar_100g: null },
          per100_source: "estimated" as Per100Source,
          matched: null,
        };
      })
  );
}
