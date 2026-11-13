// Fuel AI bake-off (requirements §10). Runs every provider on the same fixtures and prints a report.
// Spends real money (cents): each fixture is one call per provider.
//
//   npx tsx src/scripts/fuelEval.ts <fixtures-dir> [anthropic,deepseek]
//
// <fixtures-dir>/labels/<name>.jpg|png + <name>.json  {"kcal": 380, "protein_g": 13, "carbs_g": 60, "fat_g": 7}   (printed per-100 g values)
// <fixtures-dir>/meals/<name>.jpg|png  + <name>.json  {"items": [{"name": "rice", "grams": 180}], "kcal": 520, "protein_g": 24}  (weighed truth)
// Writes <fixtures-dir>/report.md. Pick TASK_PROVIDER in lib/fuel/ai.ts from it.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { evalCall, labelToFood, type LabelExtract, type MealExtract, type Provider, type Task } from "../lib/fuel/ai.js";
import { resolveItems } from "../lib/fuel/usda.js";
import { pool } from "../db/pool.js";

const [dir, providerArg] = process.argv.slice(2);
if (!dir) {
  console.error("usage: npx tsx src/scripts/fuelEval.ts <fixtures-dir> [anthropic,deepseek]");
  process.exit(1);
}
const providers = (providerArg ?? "anthropic,deepseek").split(",") as Provider[];
const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

function fixtures(sub: string) {
  const d = path.join(dir, sub);
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((f) => MIME[path.extname(f).toLowerCase()])
    .map((f) => ({ name: f, image: { mime: MIME[path.extname(f).toLowerCase()], data: readFileSync(path.join(d, f)) }, truth: JSON.parse(readFileSync(path.join(d, f.replace(/\.[^.]+$/, ".json")), "utf8")) }));
}

const pctErr = (got: number | null | undefined, want: number) => (got == null ? null : want === 0 ? Math.abs(got) : (Math.abs(got - want) / want) * 100);
const mean = (xs: (number | null)[]) => {
  const ok = xs.filter((x): x is number => x !== null);
  return ok.length ? ok.reduce((s, x) => s + x, 0) / ok.length : null;
};
const fmt = (v: number | null, unit = "%") => (v === null ? "—" : `${v.toFixed(1)}${unit}`);

interface Row { provider: Provider; task: Task; n: number; valid: number; cost: number; ms: number; metrics: Record<string, number | null> }
const rows: Row[] = [];

for (const provider of providers) {
  const labels = fixtures("labels");
  if (labels.length) {
    const errs: Record<string, (number | null)[]> = { kcal: [], protein_g: [], carbs_g: [], fat_g: [] };
    const r: Row = { provider, task: "label", n: labels.length, valid: 0, cost: 0, ms: 0, metrics: {} };
    for (const f of labels) {
      const out = await evalCall(provider, "label", { image: f.image });
      r.cost += out.cost;
      r.ms += out.ms;
      if (!out.valid) continue;
      r.valid++;
      const { food } = labelToFood(out.data as LabelExtract);
      errs.kcal.push(pctErr(food.kcal_100g, f.truth.kcal));
      errs.protein_g.push(pctErr(food.protein_100g, f.truth.protein_g));
      errs.carbs_g.push(pctErr(food.carbs_100g, f.truth.carbs_g));
      errs.fat_g.push(pctErr(food.fat_100g, f.truth.fat_g));
    }
    r.metrics = Object.fromEntries(Object.entries(errs).map(([k, v]) => [`${k} error`, mean(v)]));
    rows.push(r);
  }

  const meals = fixtures("meals");
  if (meals.length) {
    const gramErr: (number | null)[] = [];
    const kcalErr: (number | null)[] = [];
    const proteinErr: (number | null)[] = [];
    let found = 0;
    let truthItems = 0;
    const r: Row = { provider, task: "meal", n: meals.length, valid: 0, cost: 0, ms: 0, metrics: {} };
    for (const f of meals) {
      const out = await evalCall(provider, "meal", { image: f.image });
      r.cost += out.cost;
      r.ms += out.ms;
      truthItems += f.truth.items.length;
      if (!out.valid) continue;
      r.valid++;
      const items = await resolveItems(null, (out.data as MealExtract).items);
      // ponytail: items match by substring either way; a fuzzier matcher if names drift too much to compare.
      for (const t of f.truth.items as { name: string; grams: number }[]) {
        const hit = items.find((i) => i.name.toLowerCase().includes(t.name.toLowerCase()) || t.name.toLowerCase().includes(i.name.toLowerCase()));
        if (hit) found++;
        gramErr.push(hit ? pctErr(hit.grams, t.grams) : null);
      }
      const kcal = items.reduce((s, i) => s + (i.per100.kcal_100g * i.grams) / 100, 0);
      const protein = items.reduce((s, i) => s + (i.per100.protein_100g * i.grams) / 100, 0);
      if (f.truth.kcal) kcalErr.push(pctErr(kcal, f.truth.kcal));
      if (f.truth.protein_g) proteinErr.push(pctErr(protein, f.truth.protein_g));
    }
    r.metrics = { "item gram error": mean(gramErr), "total kcal error": mean(kcalErr), "total protein error": mean(proteinErr), "items recognised": truthItems ? (found / truthItems) * 100 : null };
    rows.push(r);
  }
}

const lines = [
  `# Fuel AI eval · ${new Date().toISOString().slice(0, 10)}`,
  "",
  "| Task | Provider | Fixtures | Valid JSON | Avg cost | Avg latency | Metrics |",
  "|---|---|---|---|---|---|---|",
  ...rows.map((r) =>
    `| ${r.task} | ${r.provider} | ${r.n} | ${fmt((r.valid / r.n) * 100)} | $${(r.cost / r.n).toFixed(5)} | ${Math.round(r.ms / r.n)} ms | ${Object.entries(r.metrics).map(([k, v]) => `${k} ${fmt(v)}`).join(" · ")} |`
  ),
  "",
  "Errors are mean absolute percentage error against the transcribed or weighed truth. Lower is better.",
];
writeFileSync(path.join(dir, "report.md"), lines.join("\n") + "\n");
console.log(lines.join("\n"));
await pool.end();
