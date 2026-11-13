import { useState, type FormEvent } from "react";
import { numOrNull, useAddEntry } from "../../lib/fuel";
import { parseMealText, readLabel, readMealPhoto, type AiItem, type AiMeal } from "../../lib/fuelAi";
import { useEnter } from "../../lib/motion";
import { Icon } from "./parts";

const SOURCE_LABEL = { usda: "USDA", saved: "Your food", estimated: "Estimate" } as const;
const r0 = (v: number) => Math.round(v);
const errorText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

/** A photo picker. On a phone, `capture` opens the camera straight away; the gallery is one tap further. */
export function PhotoPick({ label, busy, onFile }: { label: string; busy: boolean; onFile: (f: File) => void }) {
  return (
    <label className="btn btn--primary mi-fuel__pick" aria-disabled={busy}>
      {busy ? "Reading…" : label}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
    </label>
  );
}

/** Text or meal photo → items to confirm. Typing the meal is the most accurate AI path, so it comes first. */
export function AiMealFlow({ date, kind, onDone }: { date: string; kind: "text" | "photo"; onDone: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meal, setMeal] = useState<AiMeal | null>(null);

  async function run(p: Promise<AiMeal>) {
    setBusy(true);
    setError(null);
    try {
      const m = await p;
      if (!m.items.length) setError("No food found in that. Try again, or add it by hand.");
      else setMeal(m);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (meal) return <ItemsConfirm meal={meal} date={date} source={kind} onBack={() => setMeal(null)} onDone={onDone} />;
  return (
    <div className="mi-form">
      {kind === "text" ? (
        <form
          className="mi-form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            run(parseMealText(text));
          }}
        >
          <label className="field">
            <span>What did you eat?</span>
            <textarea value={text} rows={3} onChange={(e) => setText(e.target.value)} placeholder="2 eggs, 150 g cooked rice, a banana" autoFocus />
          </label>
          <button type="submit" className="btn btn--primary" disabled={busy || text.trim().length < 2}>{busy ? "Reading…" : "Read it"}</button>
        </form>
      ) : (
        <>
          <p className="mi-muted">Photo estimates are rough, mostly on portion size. You check every amount before anything is saved.</p>
          <PhotoPick label="Take a meal photo" busy={busy} onFile={(f) => run(readMealPhoto(f))} />
        </>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}

/** Every AI item is editable here; totals are worked out from per-100g data as the grams change. */
function ItemsConfirm({ meal, date, source, onBack, onDone }: { meal: AiMeal; date: string; source: "text" | "photo"; onBack: () => void; onDone: () => void }) {
  const [items, setItems] = useState<(AiItem & { key: number; gramsText: string })[]>(() => meal.items.map((it, key) => ({ ...it, key, gramsText: String(it.grams) })));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const add = useAddEntry();
  const listRef = useEnter<HTMLDivElement>();
  const set = (key: number, patch: Partial<(typeof items)[number]>) => setItems(items.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  const grams = (it: (typeof items)[number]) => numOrNull(it.gramsText) ?? 0;
  const total = items.reduce((s, it) => s + (it.per100.kcal_100g * grams(it)) / 100, 0);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      // Sequential, so a failure part-way leaves the rest on screen to retry rather than half-saved silently.
      for (const it of items) {
        if (grams(it) <= 0) continue;
        await add.mutateAsync({
          date,
          name: note.trim() ? `${it.name} (${note.trim()})` : it.name,
          grams: grams(it),
          ...it.per100,
          source,
          confidence: it.confidence,
          ...(meal.image_hash ? { image_hash: meal.image_hash } : {}),
        });
        setItems((cur) => cur.filter((x) => x.key !== it.key));
      }
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mi-form">
      <h3 className="mi-h2">Check the amounts</h3>
      {meal.needs_user_input.length > 0 && (
        <div className="mi-fuel__warn">
          {meal.needs_user_input.map((q) => <p key={q}>{q}</p>)}
        </div>
      )}
      <div ref={listRef} className="mi-list mi-list--tight">
        {items.map((it) => (
          <div key={it.key} className="mi-pagerow mi-fuel__entry" data-enter>
            <span className="mi-pagerow__text">
              <input className="mi-input mi-pagerow__title" value={it.name} aria-label="Food name" onChange={(e) => set(it.key, { name: e.target.value })} />
              <span className="mi-pagerow__sub">
                {r0((it.per100.kcal_100g * grams(it)) / 100)} kcal · {SOURCE_LABEL[it.per100_source]}
                {it.matched && it.per100_source !== "estimated" ? `: ${it.matched}` : ""}
                {it.confidence < 0.5 ? " · unsure" : ""}
              </span>
            </span>
            <label className="mi-unitfield">
              <input className="mi-input mi-fuel__grams" value={it.gramsText} inputMode="decimal" aria-label={`Grams of ${it.name}`} onChange={(e) => set(it.key, { gramsText: e.target.value })} />
              g
            </label>
            <button type="button" className="mi-iconbtn mi-iconbtn--sm" aria-label={`Remove ${it.name}`} onClick={() => setItems(items.filter((x) => x.key !== it.key))}>
              <Icon name="x" />
            </button>
          </div>
        ))}
      </div>
      {meal.assumptions.length > 0 && <p className="mi-muted">Assumed: {meal.assumptions.join("; ")}</p>}
      <label className="field">
        <span>Note (optional)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="fried in oil" />
      </label>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="mi-form__actions">
        <button type="button" className="btn btn--ghost" onClick={onBack} disabled={saving}>Back</button>
        <span className="mi-fuel__num">{r0(total)} kcal</span>
        <button type="button" className="btn btn--primary" onClick={save} disabled={saving || !items.some((it) => grams(it) > 0)}>
          {saving ? "Adding…" : `Add ${items.length} ${items.length === 1 ? "item" : "items"}`}
        </button>
      </div>
    </div>
  );
}

/** Nutrition-label photo → a food draft for the regular food form (which saves it for next time). */
export function LabelPhoto({ barcode, onDraft }: { barcode?: string; onDraft: (d: Awaited<ReturnType<typeof readLabel>>) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mi-form">
      <p className="mi-muted">Photograph the nutrition table flat and sharp. Japanese, Indonesian and English labels work.</p>
      <PhotoPick
        label="Photograph the label"
        busy={busy}
        onFile={async (f) => {
          setBusy(true);
          setError(null);
          try {
            onDraft(await readLabel(f, barcode));
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      />
      {error && <p className="field-error" role="alert">{error} You can fill it in by hand under Manual.</p>}
    </div>
  );
}
