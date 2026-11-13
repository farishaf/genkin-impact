import { api } from "./api";
import type { FoodDraft } from "./fuel";

/**
 * Downsizes a photo to ≤ 1024 px on the long edge as JPEG ~80% before upload. Re-encoding through a canvas
 * also drops EXIF (location, device), so the photo that leaves the phone carries pixels only.
 */
export async function shrinkImage(file: Blob, maxEdge = 1024): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read that image."))), "image/jpeg", 0.8));
}

async function upload<T>(path: string, file: Blob, extra: Record<string, string> = {}) {
  const form = new FormData();
  form.append("file", await shrinkImage(file), "photo.jpg");
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return api.postForm<T>(path, form);
}

export type Per100Source = "usda" | "saved" | "estimated";
export interface AiItem {
  name: string;
  grams: number;
  confidence: number;
  per100: { kcal_100g: number; protein_100g: number; carbs_100g: number; fat_100g: number; fiber_100g: number | null; sugar_100g: number | null };
  per100_source: Per100Source;
  matched: string | null;
}
export interface AiMeal {
  items: AiItem[];
  assumptions: string[];
  needs_user_input: string[];
  image_hash: string | null;
}

export interface ScaleImport {
  reading: Record<string, number | null | string | object> & { measured_at: string };
  context: "fasted_morning" | "post_run" | "other";
  issues: { field: string; level: "error" | "warn"; message: string }[];
}

export interface AiUsage {
  month_usd: number;
  cap_usd: number;
  by_task: { task: string; calls: number; usd: number; avg_ms: number; failed: number }[];
}

export const readMealPhoto = (file: Blob) => upload<AiMeal>("/fuel/ai/meal", file);
export const parseMealText = (text: string) => api.post<AiMeal>("/fuel/ai/text", { text });
export const readLabel = (file: Blob, barcode?: string) =>
  upload<{ food: Partial<FoodDraft> & { name: string }; missing: string[]; confidence: number; notes: string | null; derived_from_serving: boolean }>(
    "/fuel/ai/label", file, barcode ? { barcode } : {},
  );
export const readScaleScreenshot = (file: Blob) => upload<ScaleImport>("/fuel/ai/scale", file);
export const getAiUsage = () => api.get<AiUsage>("/fuel/ai/usage");

/** The Web Share Target's service worker parks a shared image here (public/sw.js). */
export async function takeSharedImage(): Promise<Blob | null> {
  if (!("caches" in window)) return null;
  const cache = await caches.open("fuel-share");
  const res = await cache.match("/shared-image");
  if (!res) return null;
  await cache.delete("/shared-image");
  return res.blob();
}
