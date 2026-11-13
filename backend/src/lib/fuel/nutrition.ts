// Food math: per-100g snapshot × grams, the sweet suggestion, and Open Food Facts parsing.
import type { FuelConfig } from "./config.js";

export interface Per100 {
  kcal_100g: number;
  protein_100g: number;
  carbs_100g: number;
  fat_100g: number;
  fiber_100g?: number | null;
  sugar_100g?: number | null;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const scale = (v: number | null | undefined, grams: number) => (v == null ? null : r1((v * grams) / 100));

/** Entry totals from a per-100g snapshot. Recomputed on every grams edit, so totals never drift from the snapshot. */
export function entryTotals(p: Per100, grams: number) {
  return {
    kcal: r1((p.kcal_100g * grams) / 100),
    protein_g: r1((p.protein_100g * grams) / 100),
    carbs_g: r1((p.carbs_100g * grams) / 100),
    fat_g: r1((p.fat_100g * grams) / 100),
    fiber_g: scale(p.fiber_100g, grams),
    sugar_g: scale(p.sugar_100g, grams),
  };
}

/** Suggest the `sweet` tag. Only a suggestion: the user's choice always wins. */
export function looksSweet(name: string, sugar100: number | null | undefined, cfg: Pick<FuelConfig, "sweet_sugar_g_100g" | "sweet_keywords">) {
  const n = name.toLowerCase();
  return (sugar100 != null && sugar100 >= cfg.sweet_sugar_g_100g) || cfg.sweet_keywords.some((k) => n.includes(k.toLowerCase()));
}

export interface OffFood extends Per100 {
  name: string;
  barcode: string;
  serving_g: number | null;
}

const numOrNull = (v: unknown) => {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Normalises an Open Food Facts v2 product response. Community data: many products lack nutriments,
 * so missing fields come back as 0 (or null for fiber/sugar) and are listed in `missing` for the form to flag.
 */
export function parseOffProduct(barcode: string, body: unknown): { food: OffFood; missing: string[] } | null {
  const b = body as { status?: number; product?: { product_name?: string; serving_quantity?: unknown; nutriments?: Record<string, unknown> } };
  if (b?.status !== 1 || !b.product) return null;
  const nm = b.product.nutriments ?? {};
  const kj = numOrNull(nm["energy_100g"]);
  const values = {
    kcal_100g: numOrNull(nm["energy-kcal_100g"]) ?? (kj === null ? null : r1(kj / 4.184)),
    protein_100g: numOrNull(nm["proteins_100g"]),
    carbs_100g: numOrNull(nm["carbohydrates_100g"]),
    fat_100g: numOrNull(nm["fat_100g"]),
    fiber_100g: numOrNull(nm["fiber_100g"]),
    sugar_100g: numOrNull(nm["sugars_100g"]),
  };
  const missing = (["kcal_100g", "protein_100g", "carbs_100g", "fat_100g"] as const).filter((k) => values[k] === null);
  return {
    food: {
      name: b.product.product_name?.trim() || `Product ${barcode}`,
      barcode,
      serving_g: numOrNull(b.product.serving_quantity),
      kcal_100g: values.kcal_100g ?? 0,
      protein_100g: values.protein_100g ?? 0,
      carbs_100g: values.carbs_100g ?? 0,
      fat_100g: values.fat_100g ?? 0,
      fiber_100g: values.fiber_100g,
      sugar_100g: values.sugar_100g,
    },
    missing,
  };
}
