import type { CSSProperties } from "react";

// Stable hue per category name, so "Coffee" is always the same soft tint wherever it appears.
// Hues are snapped to a curated set that sits well on graphite and on paper; raw 0–360 hashing
// produces muddy olives and clashing magentas.
const HUES = [28, 52, 85, 128, 158, 178, 200, 225, 255, 290, 320, 350] as const;

export function categoryHue(name: string | null | undefined): number {
  if (!name) return HUES[5];
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return HUES[hash % HUES.length];
}

/** Inline style that feeds a category tint into `.cat-badge` via the --hue custom property. */
export function hueStyle(name: string | null | undefined): CSSProperties {
  return { "--hue": String(categoryHue(name)) } as CSSProperties;
}
