import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { API_URL, ApiError } from "../../lib/api";
import { addDays, fromKey, toKey, todayKey } from "../../lib/planner";
import {
  numOrNull, useAddReading, useAddTape, useDeleteData, useProfile, useReadings, useSaveProfile, useSetDay, useSummary,
  type GoalProfile, type Profile, type Summary,
} from "../../lib/fuel";
import { reducedMotion } from "../../lib/motion";
import { confirmDialog } from "../../components/ConfirmDialog";
import { Skeleton } from "./parts";
import { PhotoPick } from "./FuelAi";
import { getAiUsage, readScaleScreenshot, takeSharedImage } from "../../lib/fuelAi";

gsap.registerPlugin(useGSAP);

const W = 600;
const H = 140;

/** Raw weigh-ins as dots, the 7-day average as a line drawn in once. Priority order on this page follows the spec: trend first, then body fat. */
function WeightChart({ points, trend }: Summary["weight"]) {
  const lineRef = useRef<SVGPathElement>(null);
  const { dots, line } = useMemo(() => {
    const all = [...points, ...trend];
    if (!all.length) return { dots: [], line: "" };
    const t0 = fromKey(all[0].date).getTime();
    const span = Math.max(1, fromKey(points.at(-1)!.date).getTime() - t0);
    const lo = Math.min(...all.map((p) => p.value)) - 0.3;
    const hi = Math.max(...all.map((p) => p.value)) + 0.3;
    const xy = (p: { date: string; value: number }) => [((fromKey(p.date).getTime() - t0) / span) * W, H - ((p.value - lo) / (hi - lo)) * H] as const;
    return {
      dots: points.map((p) => ({ key: p.date, xy: xy(p) })),
      line: trend.map((p, i) => `${i ? "L" : "M"}${xy(p).map((v) => v.toFixed(1)).join(",")}`).join(" "),
    };
  }, [points, trend]);

  useGSAP(
    () => {
      const path = lineRef.current;
      if (!path || reducedMotion()) return;
      const len = path.getTotalLength();
      gsap.fromTo(path, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, duration: 0.6, ease: "expo.out", clearProps: "strokeDasharray,strokeDashoffset" });
    },
    { dependencies: [line] },
  );

  if (points.length < 2) return <p className="mi-muted">Two or more weigh-ins draw the trend.</p>;
  return (
    <svg className="mi-fuel__chart" viewBox={`-6 -6 ${W + 12} ${H + 12}`} preserveAspectRatio="none" role="img" aria-label={`Weight, ${points.length} weigh-ins, latest 7-day average ${trend.at(-1)?.value} kg`}>
      {dots.map((d) => <circle key={d.key} cx={d.xy[0]} cy={d.xy[1]} r="4" className="mi-fuel__dot" />)}
      <path ref={lineRef} d={line} className="mi-fuel__line" />
    </svg>
  );
}

const FIELDS = [
  ["weight_kg", "Weight (kg)"],
  ["body_fat_pct", "Body fat (%)"],
  ["skeletal_muscle_mass_kg", "Skeletal muscle (kg)"],
  ["body_water_pct", "Body water (%)"],
  ["bone_mass_kg", "Bone mass (kg)"],
  ["protein_pct", "Protein (%)"],
  ["bmi", "BMI"],
  ["muscle_rate_pct", "Muscle rate (%)"],
] as const;

const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
const nowLocal = () => toLocalInput(new Date());

/** The 8 core fields from the scale screen. Values that fail a cross-check come back as a question, not a block. */
function ReadingForm() {
  const add = useAddReading();
  const [at, setAt] = useState(nowLocal);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [context, setContext] = useState("");
  const [warning, setWarning] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [source, setSource] = useState<"manual" | "screenshot">("manual");
  const [segmental, setSegmental] = useState<unknown>(null);
  const [reading, setReading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();

  /** Screenshot → the same form, filled in. Saving it is the confirm step; the checks run again on save. */
  async function importShot(file: Blob) {
    setReading(true);
    setImportError(null);
    setSaved(false);
    try {
      const res = await readScaleScreenshot(file);
      setAt(toLocalInput(new Date(res.reading.measured_at)));
      setVals(Object.fromEntries(FIELDS.map(([k]) => [k, res.reading[k] == null ? "" : String(res.reading[k])])));
      setContext(res.context);
      setSegmental(res.reading.segmental ?? null);
      setSource("screenshot");
      setWarning(res.issues.length ? res.issues.map((i) => i.message).join(" ") : null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Couldn't read that screenshot.");
    } finally {
      setReading(false);
    }
  }

  // Shared from AiLink or the gallery (Android Share → Hitsune): the service worker parked the image for us.
  const shared = params.get("shared") === "1";
  useEffect(() => {
    if (!shared) return;
    setParams({}, { replace: true });
    takeSharedImage().then((img) => img && importShot(img));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per share
  }, [shared]);

  function submit(e: FormEvent | null, force = false) {
    e?.preventDefault();
    setSaved(false);
    const body = Object.fromEntries(FIELDS.map(([k]) => [k, numOrNull(vals[k] ?? "")]));
    add.mutate(
      { ...body, measured_at: new Date(at).toISOString(), ...(context ? { context } : {}), force, source, ...(segmental ? { segmental } : {}) },
      {
        onSuccess: () => {
          setWarning(null);
          setVals({});
          setSource("manual");
          setSegmental(null);
          setSaved(true);
        },
        onError: (err) => setWarning(err instanceof ApiError && err.code === "needs_confirm" ? err.message : null),
      },
    );
  }

  return (
    <form className="card mi-card mi-form" onSubmit={(e) => submit(e)}>
      <div className="mi-sechead">
        <h2 className="mi-h2">New weigh-in</h2>
        <PhotoPick label="Import AiLink screenshot" busy={reading} onFile={importShot} />
      </div>
      {importError && <p className="field-error" role="alert">{importError} The form still works by hand.</p>}
      {source === "screenshot" && <p className="mi-muted">Read from the screenshot. Check each number against the app, then save.</p>}
      <div className="mi-fuel__grid">
        <label className="field">
          <span>Measured at</span>
          <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        </label>
        <label className="field">
          <span>Conditions</span>
          <select value={context} onChange={(e) => setContext(e.target.value)}>
            <option value="">From the time (04–09 is fasted)</option>
            <option value="fasted_morning">Fasted morning</option>
            <option value="post_run">After a run</option>
            <option value="other">Other</option>
          </select>
        </label>
        {FIELDS.map(([k, label]) => (
          <label key={k} className="field">
            <span>{label}</span>
            <input value={vals[k] ?? ""} inputMode="decimal" required={k === "weight_kg"} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} />
          </label>
        ))}
      </div>
      {warning && (
        <div className="mi-fuel__warn" role="alert">
          <p>{warning}</p>
          <button type="button" className="btn btn--outline" onClick={() => submit(null, true)}>Numbers are right, save</button>
        </div>
      )}
      {add.isError && !warning && <p className="field-error">{(add.error as Error).message}</p>}
      {saved && <p className="mi-muted" role="status">Saved. The trend below is updated.</p>}
      <button type="submit" className="btn btn--primary" disabled={add.isPending || !vals.weight_kg}>Save weigh-in</button>
    </form>
  );
}

function RecoveryForm({ s }: { s: Summary }) {
  const setDay = useSetDay();
  const today = s.recovery.find((r) => r.date === s.date);
  const [sleep, setSleep] = useState(today?.sleep_h?.toString() ?? "");
  const [hr, setHr] = useState(today?.resting_hr?.toString() ?? "");
  const [sore, setSore] = useState(today?.soreness?.toString() ?? "");
  return (
    <form
      className="card mi-card mi-form"
      onSubmit={(e) => {
        e.preventDefault();
        const resting = numOrNull(hr);
        const soreness = numOrNull(sore);
        setDay.mutate({ date: s.date, day_type: s.day_type_inferred ? null : s.day_type, sleep_h: numOrNull(sleep), resting_hr: resting && Math.round(resting), soreness: soreness && Math.round(soreness) });
      }}
    >
      <h2 className="mi-h2">Recovery today</h2>
      <div className="mi-fuel__grid">
        <label className="field"><span>Sleep (h)</span><input value={sleep} inputMode="decimal" onChange={(e) => setSleep(e.target.value)} /></label>
        <label className="field"><span>Resting HR</span><input value={hr} inputMode="numeric" onChange={(e) => setHr(e.target.value)} /></label>
        <label className="field">
          <span>Soreness</span>
          <select value={sore} onChange={(e) => setSore(e.target.value)}>
            <option value="">—</option>
            {[1, 2, 3, 4, 5].map((v) => <option key={v} value={v}>{v}{v === 1 ? " (none)" : v === 5 ? " (very)" : ""}</option>)}
          </select>
        </label>
      </div>
      {setDay.isError && <p className="field-error">{(setDay.error as Error).message}</p>}
      <button type="submit" className="btn btn--outline" disabled={setDay.isPending}>{setDay.isSuccess ? "Saved" : "Save"}</button>
    </form>
  );
}

function TapeForm() {
  const add = useAddTape();
  const [vals, setVals] = useState<Record<string, string>>({});
  const parts = [["waist_cm", "Waist"], ["chest_cm", "Chest"], ["arm_cm", "Arm"], ["thigh_cm", "Thigh"]] as const;
  return (
    <form
      className="mi-form"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate({ date: todayKey(), ...Object.fromEntries(parts.map(([k]) => [k, numOrNull(vals[k] ?? "")])) }, { onSuccess: () => setVals({}) });
      }}
    >
      <div className="mi-fuel__grid">
        {parts.map(([k, label]) => (
          <label key={k} className="field"><span>{label} (cm)</span><input value={vals[k] ?? ""} inputMode="decimal" onChange={(e) => setVals({ ...vals, [k]: e.target.value })} /></label>
        ))}
      </div>
      <button type="submit" className="btn btn--outline" disabled={add.isPending || !Object.values(vals).some(Boolean)}>Save tape</button>
    </form>
  );
}

const CONFIDENCE = { low: "Estimated from your profile", medium: "Blending in your logs", high: "Measured from your logs", manual: "Set by you" };
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}`;

export function FuelBody() {
  const date = todayKey();
  const summary = useSummary(date);
  const readings = useReadings(toKey(addDays(fromKey(date), -30)), date);
  const s = summary.data;

  return (
    <div className="mi-narrow">
      <h1 className="mi-h1">Body &amp; trends</h1>
      <ReadingForm />

      {!s ? <Skeleton rows={3} height="6rem" /> : (
        <>
          <section className="card mi-card" aria-label="Weight trend">
            <div className="mi-sechead">
              <h2 className="mi-h2">Weight</h2>
              <span className="mi-fuel__num">{s.weight.latest_kg ?? "—"} kg <span className="mi-muted">7-day avg</span></span>
            </div>
            <WeightChart {...s.weight} />
          </section>

          <section className="card mi-card" aria-label="Energy">
            <h2 className="mi-h2">Maintenance</h2>
            {s.maintenance ? (
              <>
                <dl className="mi-figs">
                  <div><dt>Estimate</dt><dd>{s.maintenance.kcal} kcal</dd></div>
                  <div><dt>Energy balance, 7 days</dt><dd>{s.energy_balance_7d === null ? "—" : `${signed(s.energy_balance_7d)} kcal/day`}</dd></div>
                  <div><dt>Weight change</dt><dd>{s.maintenance.inputs.slope_kg_per_week === null ? "—" : `${signed(s.maintenance.inputs.slope_kg_per_week)} kg/wk`}</dd></div>
                </dl>
                <p className="mi-muted">
                  {CONFIDENCE[s.maintenance.confidence]}. Profile estimate {s.maintenance.bootstrap_kcal} kcal (BMR {s.maintenance.inputs.bmr_kcal}
                  {s.maintenance.inputs.scale_bmr_kcal ? `, scale says ${s.maintenance.inputs.scale_bmr_kcal}` : ""} × {s.maintenance.inputs.activity_factor}
                  {" "}+ {s.maintenance.inputs.exercise_kcal_per_day} exercise/day){s.maintenance.measured_kcal !== null && `, from logs ${s.maintenance.measured_kcal} kcal`}.
                  {" "}{s.maintenance.inputs.intake_days} logged days and {s.maintenance.inputs.weigh_ins} weigh-ins in the last 3 weeks.
                </p>
              </>
            ) : <p className="mi-muted">Needs one weigh-in.</p>}
          </section>

          <section className="card mi-card" aria-label="Training">
            <h2 className="mi-h2">Training this week</h2>
            <dl className="mi-figs">
              <div><dt>Run km</dt><dd>{s.training.this_week.km}{s.training.km_change_pct !== null && <span className="mi-muted"> ({signed(s.training.km_change_pct)}%)</span>}</dd></div>
              <div><dt>Long run</dt><dd>{s.training.this_week.long_run_km} km</dd></div>
              <div><dt>Logged time</dt><dd>{Math.round(s.training.this_week.minutes / 6) / 10} h</dd></div>
            </dl>
            {s.training.km_change_pct !== null && Math.abs(s.training.km_change_pct) > 10 && (
              <p className="mi-muted">Mileage moved more than 10% from last week; maintenance runs roughly 1 kcal per kg per km, and the estimate catches up over a few weeks.</p>
            )}
          </section>

          <section className="card mi-card" aria-label="Body fat">
            <h2 className="mi-h2">Body fat, weekly</h2>
            {s.body_fat_weekly.length ? (
              <dl className="mi-figs">
                {s.body_fat_weekly.slice(-4).map((w) => (
                  <div key={w.week_start}><dt>Week of {fromKey(w.week_start).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</dt><dd>{w.mean}%{w.low_confidence && <span className="mi-muted"> · low confidence</span>}</dd></div>
                ))}
              </dl>
            ) : <p className="mi-muted">No body fat readings yet.</p>}
            <p className="mi-muted">Scale body fat shifts with water and food; three fasted morning readings a week give a steadier number.</p>
          </section>

          <RecoveryForm key={s.date} s={s} />

          <section className="card mi-card" aria-label="Tape">
            <h2 className="mi-h2">Tape, every 2–4 weeks</h2>
            {s.tape[0] && <p className="mi-muted">Last waist: {s.tape[0].waist_cm ?? "—"} cm on {s.tape[0].date}.</p>}
            <TapeForm />
          </section>
        </>
      )}

      <section aria-label="Recent weigh-ins">
        <h2 className="mi-h2">Last 30 days</h2>
        <div className="mi-list mi-list--tight">
          {readings.data?.map((r) => (
            <div key={r.id} className="mi-pagerow">
              <span className="mi-pagerow__text">
                <span className="mi-pagerow__title">{r.weight_kg} kg{r.body_fat_pct !== null && ` · ${r.body_fat_pct}% fat`}</span>
                <span className="mi-pagerow__sub">{new Date(r.measured_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} · {r.context.replace("_", " ")}</span>
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const GOALS: { id: GoalProfile; label: string }[] = [
  { id: "mileage_fueling", label: "Fuel the mileage" },
  { id: "fat_loss_endurance", label: "Lose fat, keep running" },
  { id: "lean_gain", label: "Lean gain" },
];

function SettingsForm({ profile }: { profile: Profile }) {
  const save = useSaveProfile();
  const del = useDeleteData();
  const [p, setP] = useState(profile);
  const set = (patch: Partial<Profile>) => setP({ ...p, ...patch });
  const setCfg = (patch: Partial<Profile["config"]>) => setP({ ...p, config: { ...p.config, ...patch } });

  return (
    <form
      className="card mi-card mi-form"
      onSubmit={(e) => {
        e.preventDefault();
        const { race_date, sweets_kcal_cap_pct, daily_activity_kcal, allow_deficit_below_floor } = p.config;
        save.mutate({ ...p, config: { race_date, sweets_kcal_cap_pct, daily_activity_kcal, allow_deficit_below_floor } });
      }}
    >
      <label className="field">
        <span>Goal</span>
        <select value={p.goal_profile} onChange={(e) => set({ goal_profile: e.target.value as GoalProfile })}>
          {GOALS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
      </label>
      <div className="mi-fuel__grid">
        <label className="field"><span>Height (cm)</span><input value={p.height_cm} inputMode="decimal" onChange={(e) => set({ height_cm: numOrNull(e.target.value) ?? 0 })} /></label>
        <label className="field"><span>Birth year</span><input value={p.birth_year} inputMode="numeric" onChange={(e) => set({ birth_year: numOrNull(e.target.value) ?? 0 })} /></label>
        <label className="field">
          <span>Sex (for the BMR formula)</span>
          <select value={p.sex} onChange={(e) => set({ sex: e.target.value as Profile["sex"] })}>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        </label>
        <label className="field"><span>Race date</span><input type="date" value={p.config.race_date ?? ""} onChange={(e) => setCfg({ race_date: e.target.value || null })} /></label>
        <label className="field"><span>Sweets budget (% of kcal)</span><input value={p.config.sweets_kcal_cap_pct} inputMode="numeric" onChange={(e) => setCfg({ sweets_kcal_cap_pct: numOrNull(e.target.value) ?? 0 })} /></label>
        <label className="field"><span>Daily unlogged activity (kcal)</span><input value={p.config.daily_activity_kcal} inputMode="numeric" placeholder="e.g. bike commute" onChange={(e) => setCfg({ daily_activity_kcal: numOrNull(e.target.value) ?? 0 })} /></label>
        <label className="field"><span>Maintenance override (kcal)</span><input value={p.maintenance_override_kcal ?? ""} inputMode="numeric" placeholder="Leave empty to estimate" onChange={(e) => set({ maintenance_override_kcal: numOrNull(e.target.value) })} /></label>
      </div>
      {p.goal_profile === "fat_loss_endurance" && (
        <label className="field field--checkbox">
          <input type="checkbox" checked={p.config.allow_deficit_below_floor} onChange={(e) => setCfg({ allow_deficit_below_floor: e.target.checked })} />
          <span>Allow a deficit even when already lean (scale body fat can be off by several points)</span>
        </label>
      )}
      {save.isError && <p className="field-error">{(save.error as Error).message}</p>}
      <div className="mi-form__actions">
        <button type="submit" className="btn btn--primary" disabled={save.isPending}>{save.isSuccess ? "Saved" : "Save settings"}</button>
        <a className="btn btn--outline" href={`${API_URL}/fuel/export`} download>Export my data</a>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() =>
            confirmDialog({ title: "Delete all Fuel data?", body: "Food, weigh-ins, tape, recovery and settings go. Runs and workouts stay. This can't be undone.", confirmLabel: "Delete everything", danger: true }).then(
              (yes) => yes && del.mutate(undefined),
            )
          }
        >
          Delete all Fuel data
        </button>
      </div>
    </form>
  );
}

function AiUsageCard() {
  const usage = useQuery({ queryKey: ["fuel", "ai-usage"], queryFn: getAiUsage });
  const u = usage.data;
  return (
    <section className="card mi-card" aria-label="AI use this month">
      <h2 className="mi-h2">AI reads this month</h2>
      {u ? (
        <>
          <dl className="mi-figs">
            <div><dt>Spent</dt><dd>${u.month_usd.toFixed(3)} <span className="mi-muted">of ${u.cap_usd}</span></dd></div>
            {u.by_task.map((t) => (
              <div key={t.task}><dt>{t.task}</dt><dd>{t.calls} <span className="mi-muted">· {(t.avg_ms / 1000).toFixed(1)} s{t.failed ? ` · ${t.failed} failed` : ""}</span></dd></div>
            ))}
          </dl>
          <p className="mi-muted">Photos go to DeepSeek (labels, scale screens) or Anthropic (meals, text); only a hash and the numbers are kept. At the cap, AI turns off until next month and manual entry keeps working.</p>
        </>
      ) : <Skeleton rows={1} height="3rem" />}
    </section>
  );
}

export function FuelSettings() {
  const profile = useProfile();
  return (
    <div className="mi-narrow">
      <h1 className="mi-h1">Fuel settings</h1>
      {profile.data ? <SettingsForm key={JSON.stringify(profile.data)} profile={profile.data} /> : <Skeleton rows={3} height="3rem" />}
      <AiUsageCard />
    </div>
  );
}
