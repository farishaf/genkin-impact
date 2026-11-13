import { useState, type FormEvent } from "react";
import { NavLink, Outlet, useSearchParams } from "react-router-dom";
import { addDays, fromKey, isValidKey, toKey, todayKey } from "../../lib/planner";
import {
  DAY_LABEL, lookupBarcode, numOrNull, useAddEntry, useCopyDay, useDeleteEntry, useEntries, useFoods, usePatchEntry, useSaveFood,
  useSetDay, useSummary, type DayType, type Entry, type Food, type FoodDraft,
} from "../../lib/fuel";
import { useEnter } from "../../lib/motion";
import { Drawer, Icon, Progress, Skeleton } from "./parts";
import { AiMealFlow, LabelPhoto } from "./FuelAi";

const FUEL_TABS = [
  { to: "/mainichi/fuel", label: "Today", end: true },
  { to: "/mainichi/fuel/body", label: "Body & trends" },
  { to: "/mainichi/fuel/settings", label: "Settings" },
];

export function FuelLayout() {
  return (
    <>
      <nav className="mi-filters mi-fueltabs" aria-label="Fuel">
        {FUEL_TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `mi-chip-btn${isActive ? " mi-chip-btn--on" : ""}`}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
      <p className="mi-muted mi-fuel__disclaimer">
        A tracking and planning aid, not medical advice. If fatigue, illness or injury persists, adjust intake and see a professional.
      </p>
    </>
  );
}

function useFuelDate() {
  const [params, setParams] = useSearchParams();
  const date = isValidKey(params.get("date")) ? params.get("date")! : todayKey();
  return [date, (k: string) => setParams(k === todayKey() ? {} : { date: k }, { replace: true })] as const;
}

const r0 = (v: number) => Math.round(v);
const shortDate = (k: string) => fromKey(k).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

/** One target row: eaten vs target. Going past the target is shown plainly, without colour alarms. */
function Macro({ label, value, target, unit }: { label: string; value: number; target: number | null; unit: string }) {
  return (
    <div className="mi-fuel__macro">
      <div className="mi-fuel__macrohead">
        <span>{label}</span>
        <span className="mi-fuel__num">
          {r0(value)}
          {target !== null && <span className="mi-muted"> / {target} {unit}</span>}
        </span>
      </div>
      {target !== null && <Progress done={Math.min(value, target)} total={target} />}
    </div>
  );
}

export function FuelToday() {
  const [date, setDate] = useFuelDate();
  const summary = useSummary(date);
  const entries = useEntries(date);
  const setDay = useSetDay();
  const copyDay = useCopyDay();
  const [logging, setLogging] = useState(false);
  const listRef = useEnter<HTMLDivElement>();
  const s = summary.data;
  const t = s?.targets ?? null;

  const chooseDayType = (d: DayType | null) => setDay.mutate({ ...s?.recovery.find((x) => x.date === date), date, day_type: d });

  return (
    <div className="mi-narrow">
      <header className="mi-today__head">
        <div className="mi-today__nav">
          <button type="button" className="mi-iconbtn" aria-label="Previous day" onClick={() => setDate(toKey(addDays(fromKey(date), -1)))}>
            <Icon name="back" />
          </button>
          <h1 className="mi-h1">{date === todayKey() ? "Today" : shortDate(date)}</h1>
          <button type="button" className="mi-iconbtn" aria-label="Next day" onClick={() => setDate(toKey(addDays(fromKey(date), 1)))}>
            <Icon name="chevron" />
          </button>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setLogging(true)}>+ Log food</button>
      </header>

      <section className="mi-sheet mi-fuel__sheet" aria-label="Energy for the day">
        <div className="mi-dayhead__titles">
          <span className="mi-spend__label">Eaten</span>
          <span className="mi-money__total">
            {s ? `${r0(s.today.kcal)} kcal` : "…"}
            {t && <span className="mi-fuel__of"> of {t.kcal}</span>}
          </span>
        </div>
        {s && !t && <p>Add a weigh-in on Body &amp; trends to get targets.</p>}
        {t?.notes.map((n) => <p key={n}>{n}</p>)}
      </section>

      <div className="mi-seg" role="group" aria-label="Day type">
        {(["rest", "easy", "hard"] as const).map((d) => (
          <button key={d} type="button" className={`mi-seg__btn${s?.day_type === d ? " mi-seg__btn--on" : ""}`} aria-pressed={s?.day_type === d} onClick={() => chooseDayType(d)}>
            {DAY_LABEL[d]}
          </button>
        ))}
      </div>
      {s && (
        <p className="mi-muted mi-fuel__hint">
          {s.day_type_inferred ? "Picked from your planned runs and workouts." : "Set by you. "}
          {!s.day_type_inferred && <button type="button" className="mi-textbtn" onClick={() => chooseDayType(null)}>Use the plan</button>}
        </p>
      )}

      <section className="card mi-card" aria-label="Macros">
        {s ? (
          <>
            <Macro label="Protein" value={s.today.protein_g} target={t?.protein_g ?? null} unit="g" />
            <Macro label="Carbs" value={s.today.carbs_g} target={t?.carbs_g ?? null} unit="g" />
            <Macro label="Fat" value={s.today.fat_g} target={t?.fat_g ?? null} unit="g" />
            <Macro label="Fiber" value={s.today.fiber_g} target={t?.fiber_g ?? null} unit="g" />
            <dl className="mi-figs">
              <div><dt>Protein per kg</dt><dd>{s.today.protein_g_per_kg ?? "—"} g</dd></div>
              <div>
                <dt>Sweets</dt>
                <dd>{r0(s.today.sweets_kcal)}{t && <span className="mi-muted"> / {t.sweets_kcal_cap}</span>} kcal</dd>
              </div>
              <div><dt>Planned treats</dt><dd>{r0(s.today.sweets_planned_kcal)} kcal</dd></div>
            </dl>
          </>
        ) : (
          <Skeleton rows={4} height="2.5rem" />
        )}
      </section>

      <div className="mi-sechead mi-sechead--spaced">
        <h2 className="mi-h2">Food</h2>
        <button type="button" className="mi-textbtn" disabled={copyDay.isPending} onClick={() => copyDay.mutate({ from: toKey(addDays(fromKey(date), -1)), to: date })}>
          Copy yesterday
        </button>
      </div>
      <div ref={listRef} className="mi-list mi-list--tight">
        {entries.data?.map((e) => <EntryRow key={e.id} entry={e} />)}
        {entries.isLoading && <Skeleton rows={2} height="3rem" />}
        {entries.data?.length === 0 && <p className="mi-muted">Nothing logged yet.</p>}
      </div>

      {logging && (
        <Drawer title="Log food" onClose={() => setLogging(false)}>
          <LogFood date={date} onDone={() => setLogging(false)} />
        </Drawer>
      )}
    </div>
  );
}

function EntryRow({ entry }: { entry: Entry }) {
  const patch = usePatchEntry();
  const del = useDeleteEntry();
  const [grams, setGrams] = useState(String(entry.grams));
  const commit = () => {
    const g = numOrNull(grams);
    if (g && g > 0 && g !== entry.grams) patch.mutate({ id: entry.id, grams: g });
    else setGrams(String(entry.grams));
  };
  return (
    <div className="mi-pagerow mi-fuel__entry" data-enter>
      <span className="mi-pagerow__text">
        <span className="mi-pagerow__title">{entry.name}</span>
        <span className="mi-pagerow__sub">
          {r0(entry.kcal)} kcal · P {r0(entry.protein_g)} · C {r0(entry.carbs_g)} · F {r0(entry.fat_g)}
        </span>
      </span>
      <label className="mi-unitfield">
        <input className="mi-input mi-fuel__grams" value={grams} inputMode="decimal" aria-label={`Grams of ${entry.name}`} onChange={(e) => setGrams(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
        g
      </label>
      <button type="button" className={`mi-chip-btn${entry.is_sweet ? " mi-chip-btn--on" : ""}`} aria-pressed={entry.is_sweet} onClick={() => patch.mutate({ id: entry.id, is_sweet: !entry.is_sweet })}>
        Sweet
      </button>
      <button type="button" className="mi-iconbtn mi-iconbtn--sm" aria-label={`Remove ${entry.name}`} onClick={() => del.mutate(entry.id)}>
        <Icon name="x" />
      </button>
    </div>
  );
}

type Mode = "saved" | "text" | "photo" | "barcode" | "label" | "manual";
const MODES: { id: Mode; label: string }[] = [
  { id: "saved", label: "Saved" },
  { id: "text", label: "Describe" },
  { id: "photo", label: "Photo" },
  { id: "barcode", label: "Barcode" },
  { id: "label", label: "Label" },
  { id: "manual", label: "Manual" },
];

/** Saved foods first (zero AI, a tap and an amount), then describing it (the most accurate AI path), photo, barcode, label, by hand. */
function LogFood({ date, onDone }: { date: string; onDone: () => void }) {
  const [mode, setMode] = useState<Mode>("saved");
  const [q, setQ] = useState("");
  const foods = useFoods(q);
  const [picked, setPicked] = useState<Food | null>(null);
  const [draft, setDraft] = useState<{ food: FoodDraft; missing: string[]; saved: boolean } | null>(null);
  const [barcode, setBarcode] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);

  async function lookup(e: FormEvent) {
    e.preventDefault();
    setLookupError(null);
    setLooking(true);
    try {
      const res = await lookupBarcode(barcode.trim());
      if (res.saved && res.food.id) setPicked(res.food as Food);
      else setDraft(res);
    } catch (err) {
      setLookupError((err as Error).message);
    } finally {
      setLooking(false);
    }
  }

  if (picked) return <AmountStep date={date} food={picked} onBack={() => setPicked(null)} onDone={onDone} />;

  return (
    <div className="mi-form">
      <div className="mi-filters" role="group" aria-label="How to add">
        {MODES.map((m) => (
          <button key={m.id} type="button" className={`mi-chip-btn${mode === m.id ? " mi-chip-btn--on" : ""}`} aria-pressed={mode === m.id} onClick={() => { setMode(m.id); setDraft(null); setLookupError(null); }}>
            {m.label}
          </button>
        ))}
      </div>

      {(mode === "text" || mode === "photo") && <AiMealFlow key={mode} date={date} kind={mode} onDone={onDone} />}

      {mode === "saved" && (
        <>
          <label className="field">
            <span>Search your foods</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rice, eggs, oats…" autoFocus />
          </label>
          <div className="mi-list mi-list--tight">
            {foods.data?.map((f) => (
              <button key={f.id} type="button" className="mi-pagerow" onClick={() => setPicked(f)}>
                <span className="mi-pagerow__text">
                  <span className="mi-pagerow__title">{f.name}</span>
                  <span className="mi-pagerow__sub">{r0(f.kcal_100g)} kcal · P {f.protein_100g} per 100 g</span>
                </span>
              </button>
            ))}
            {foods.data?.length === 0 && <p className="mi-muted">No saved foods{q ? " match" : " yet"}. Add one by barcode or by hand; it's kept for next time.</p>}
          </div>
        </>
      )}

      {mode === "barcode" && !draft && (
        <form onSubmit={lookup} className="mi-form">
          <label className="field">
            <span>Barcode</span>
            <input value={barcode} onChange={(e) => setBarcode(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="8991002101012" autoFocus />
          </label>
          <button type="submit" className="btn btn--primary" disabled={barcode.length < 6 || looking}>{looking ? "Looking up…" : "Look up"}</button>
        </form>
      )}
      {lookupError && (
        <div className="mi-form__actions">
          <p className="field-error">{lookupError}</p>
          <button type="button" className="mi-textbtn" onClick={() => setDraft({ food: { ...EMPTY_FOOD, barcode: barcode.trim() }, missing: [], saved: false })}>Enter it by hand</button>
        </div>
      )}
      {/* Not in Open Food Facts: read the label instead, and keep it under this barcode for next time. */}
      {((mode === "barcode" && lookupError && !draft) || (mode === "label" && !draft)) && (
        <LabelPhoto
          barcode={mode === "barcode" ? barcode.trim() : undefined}
          onDraft={(d) => {
            setLookupError(null);
            setDraft({ food: { ...EMPTY_FOOD, ...d.food, barcode: d.food.barcode ?? null, source: "label" } as FoodDraft, missing: d.missing, saved: false });
          }}
        />
      )}

      {(mode === "manual" || draft) && (
        <FoodForm key={`${mode}-${draft?.food.source}-${draft?.food.name}`} initial={draft?.food ?? EMPTY_FOOD} missing={draft?.missing ?? []} date={date} onDone={onDone} />
      )}
    </div>
  );
}

const EMPTY_FOOD: FoodDraft = { name: "", barcode: null, kcal_100g: 0, protein_100g: 0, carbs_100g: 0, fat_100g: 0, fiber_100g: null, sugar_100g: null, serving_g: null, is_sweet: false, source: "manual" };

function AmountStep({ date, food, onBack, onDone }: { date: string; food: Food; onBack: () => void; onDone: () => void }) {
  const add = useAddEntry();
  const [grams, setGrams] = useState(String(food.serving_g ?? 100));
  const [planned, setPlanned] = useState(false);
  const g = numOrNull(grams) ?? 0;
  return (
    <form
      className="mi-form"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate({ date, food_id: food.id, grams: g, is_planned: planned }, { onSuccess: onDone });
      }}
    >
      <h3 className="mi-h2">{food.name}</h3>
      <label className="field">
        <span>Amount (g)</span>
        <input value={grams} onChange={(e) => setGrams(e.target.value)} inputMode="decimal" autoFocus />
      </label>
      <p className="mi-muted">{r0((food.kcal_100g * g) / 100)} kcal · P {r0((food.protein_100g * g) / 100)} g</p>
      {food.is_sweet && (
        <label className="field field--checkbox">
          <input type="checkbox" checked={planned} onChange={(e) => setPlanned(e.target.checked)} />
          <span>Planned treat</span>
        </label>
      )}
      {add.isError && <p className="field-error">{(add.error as Error).message}</p>}
      <div className="mi-form__actions">
        <button type="button" className="btn btn--ghost" onClick={onBack}>Back</button>
        <button type="submit" className="btn btn--primary" disabled={g <= 0 || add.isPending}>Add</button>
      </div>
    </form>
  );
}

const NUM_FIELDS = [
  ["kcal_100g", "kcal"],
  ["protein_100g", "Protein (g)"],
  ["carbs_100g", "Carbs (g)"],
  ["fat_100g", "Fat (g)"],
  ["sugar_100g", "Sugar (g)"],
  ["fiber_100g", "Fiber (g)"],
] as const;

/** A food per 100 g. Logs it once, or saves it as a food too (always saved when it has a barcode). */
function FoodForm({ initial, missing, date, onDone }: { initial: FoodDraft; missing: string[]; date: string; onDone: () => void }) {
  const [name, setName] = useState(initial.name);
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(NUM_FIELDS.map(([k]) => [k, initial[k] == null || (missing.includes(k) && !initial[k]) ? "" : String(initial[k])]))
  );
  const [grams, setGrams] = useState(String(initial.serving_g ?? 100));
  const [keep, setKeep] = useState(true);
  const [sweet, setSweet] = useState<boolean | null>(initial.barcode ? initial.is_sweet : null);
  const [planned, setPlanned] = useState(false);
  const saveFood = useSaveFood();
  const add = useAddEntry();
  const per100 = Object.fromEntries(NUM_FIELDS.map(([k]) => [k, numOrNull(vals[k])]));
  const g = numOrNull(grams) ?? 0;
  const ok = name.trim() && per100.kcal_100g !== null && g > 0;
  const error = saveFood.error ?? add.error;

  const entrySource = initial.source === "label" ? { source: "label" } : initial.barcode ? { source: "barcode" } : {};

  async function submit(e: FormEvent) {
    e.preventDefault();
    const base = { ...per100, protein_100g: per100.protein_100g ?? 0, carbs_100g: per100.carbs_100g ?? 0, fat_100g: per100.fat_100g ?? 0, ...(sweet === null ? {} : { is_sweet: sweet }) };
    if (keep || initial.barcode) {
      const food = (await saveFood.mutateAsync({ ...base, name: name.trim(), barcode: initial.barcode, serving_g: initial.serving_g, source: initial.source })) as Food;
      await add.mutateAsync({ date, food_id: food.id, grams: g, is_planned: planned, ...entrySource });
    } else {
      await add.mutateAsync({ ...base, date, name: name.trim(), grams: g, is_planned: planned, ...entrySource });
    }
    onDone();
  }

  return (
    <form className="mi-form" onSubmit={(e) => submit(e).catch(() => {})}>
      {missing.length > 0 && <p className="mi-fuel__warn">Open Food Facts has no value for {missing.map((m) => m.replace("_100g", "")).join(", ")}. Check the label and fill them in.</p>}
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus={!initial.name} />
      </label>
      <p className="mi-label">Per 100 g</p>
      <div className="mi-fuel__grid">
        {NUM_FIELDS.map(([k, label]) => (
          <label key={k} className="field">
            <span>{label}</span>
            <input value={vals[k]} inputMode="decimal" aria-invalid={missing.includes(k) && !vals[k]} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} />
          </label>
        ))}
      </div>
      <label className="field">
        <span>Amount eaten (g)</span>
        <input value={grams} onChange={(e) => setGrams(e.target.value)} inputMode="decimal" />
      </label>
      <div className="mi-filters">
        <button type="button" className={`mi-chip-btn${sweet ? " mi-chip-btn--on" : ""}`} aria-pressed={!!sweet} onClick={() => setSweet(!sweet)}>Sweet</button>
        <button type="button" className={`mi-chip-btn${planned ? " mi-chip-btn--on" : ""}`} aria-pressed={planned} onClick={() => setPlanned(!planned)}>Planned</button>
        {!initial.barcode && (
          <button type="button" className={`mi-chip-btn${keep ? " mi-chip-btn--on" : ""}`} aria-pressed={keep} onClick={() => setKeep(!keep)}>Save as food</button>
        )}
      </div>
      {sweet === null && <p className="mi-muted">Sweet is suggested from sugar and the name if you leave it.</p>}
      {error && <p className="field-error">{(error as Error).message}</p>}
      <button type="submit" className="btn btn--primary" disabled={!ok || saveFood.isPending || add.isPending}>Add</button>
    </form>
  );
}
