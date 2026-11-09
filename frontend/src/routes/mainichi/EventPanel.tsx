import { useLayoutEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Link } from "react-router-dom";
import {
  fromKey, goalLabel, intensityLabel, newItemId, newStep, runSegments, runTotals, setStats, stepIntensity, RUN_PRESETS, STEP_LABEL, TYPE_LABEL,
  useCreateEvents, useDeleteEvent, useEditEvent,
  type EventType, type Intensity, type PlannerEvent, type Routine, type RunStep, type Segment, type StepKind, type StepUnit,
} from "../../lib/planner";
import { Icon } from "./parts";
import { EventArt, RunArt, WorkoutArt } from "./art";
import { useEnter } from "../../lib/motion";
import { confirmDialog } from "../../components/ConfirmDialog";

const fmtMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);

function totalsLabel(segments: Segment[] = []) {
  const t = runTotals(segments);
  return [t.km ? `${t.km} km` : "", t.minutes ? fmtMinutes(t.minutes) : ""].filter(Boolean).join(", ");
}

// ---------- running course (movements and rounds) ----------

const moveIn = <T,>(arr: T[], from: number, to: number) => {
  const a = [...arr];
  const [x] = a.splice(from, 1);
  a.splice(to, 0, x);
  return a;
};

/** Pointer-based drag to reorder (mouse and touch). Reorders live as the pointer crosses item midpoints. */
function useDragSort(ids: string[], onMove: (from: number, to: number) => void) {
  const els = useRef(new Map<string, HTMLElement>());
  const latest = useRef({ ids, onMove });
  useLayoutEffect(() => {
    latest.current = { ids, onMove };
  });
  const [dragging, setDragging] = useState<string | null>(null);
  const itemRef = (id: string) => (el: HTMLElement | null) => {
    if (el) els.current.set(id, el);
    else els.current.delete(id);
  };
  const handleProps = (id: string) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(id);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      if (dragging !== id) return;
      const { ids: order, onMove: move } = latest.current;
      const from = order.indexOf(id);
      const to = order.filter((o) => o !== id).filter((o) => {
        const r = els.current.get(o)?.getBoundingClientRect();
        return r && r.top + r.height / 2 < e.clientY;
      }).length;
      if (from !== -1 && to !== from) move(from, to);
    },
    onPointerUp: () => setDragging(null),
    onPointerCancel: () => setDragging(null),
  });
  return { itemRef, handleProps, dragging };
}

type HandleProps = ReturnType<ReturnType<typeof useDragSort>["handleProps"]>;

function MovementCard({
  step,
  open,
  nested,
  dragging,
  handle,
  onToggle,
  onChange,
  onRemove,
}: {
  step: RunStep;
  open: boolean;
  nested?: boolean;
  dragging: boolean;
  handle: HandleProps;
  onToggle: () => void;
  onChange: (patch: Partial<RunStep>) => void;
  onRemove: () => void;
}) {
  const intensity = stepIntensity(step);
  const goal = step.unit === "km" || step.unit === "m" ? "distance" : "time";
  return (
    <div data-enter className={`mi-move mi-step--${step.kind}${nested ? " mi-move--nested" : ""}${dragging ? " mi-move--drag" : ""}`}>
      <div className="mi-move__head">
        <span className="mi-handle" role="button" aria-label={`Drag ${STEP_LABEL[step.kind]} to reorder`} {...handle}>
          <Icon name="grip" />
        </span>
        <select className="mi-stepchip" value={step.kind} aria-label="Movement" onChange={(e) => onChange({ kind: e.target.value as StepKind })}>
          {(Object.keys(STEP_LABEL) as StepKind[]).map((k) => <option key={k} value={k}>{STEP_LABEL[k]}</option>)}
        </select>
        <button type="button" className="mi-move__sum" aria-expanded={open} aria-label={open ? "Collapse" : "Expand"} onClick={onToggle}>
          <span>{[goalLabel(step), intensity === "none" ? "" : intensityLabel(step)].filter(Boolean).join(", ")}</span>
          <Icon name={open ? "up" : "down"} />
        </button>
        {open && (
          <button type="button" className="icon-btn icon-btn--danger" aria-label="Delete movement" onClick={onRemove}>
            <Icon name="trash" />
          </button>
        )}
      </div>

      {open ? (
        <div className="mi-move__body" data-enter>
          <div className="mi-move__row">
            <span className="mi-caret">
              <select
                className="mi-move__label"
                value={goal}
                aria-label="Goal"
                onChange={(e) => onChange(e.target.value === "distance" ? { unit: "km", amount: "1" } : { unit: "min", amount: "5" })}
              >
                <option value="distance">Distance</option>
                <option value="time">Time</option>
              </select>
            </span>
            <div className="mi-move__value">
              <input value={step.amount} inputMode="decimal" aria-label={goal === "distance" ? "Distance" : "Time"} onChange={(e) => onChange({ amount: e.target.value })} />
              <select value={step.unit} aria-label="Unit" onChange={(e) => onChange({ unit: e.target.value as StepUnit })}>
                {goal === "distance" ? (
                  <>
                    <option value="km">km</option>
                    <option value="m">m</option>
                  </>
                ) : (
                  <>
                    <option value="min">min</option>
                    <option value="s">sec</option>
                  </>
                )}
              </select>
            </div>
          </div>
          <div className="mi-move__row">
            <span className="mi-caret">
              <select className="mi-move__label" value={intensity} aria-label="Intensity focus" onChange={(e) => onChange({ intensity: e.target.value as Intensity })}>
                <option value="none">No focus</option>
                <option value="pace">Pace</option>
                <option value="hr">Heart rate</option>
              </select>
            </span>
            <div className="mi-move__value">
              {intensity === "pace" && (
                <>
                  <input value={step.pace} placeholder="4:30" aria-label="Fastest pace" onChange={(e) => onChange({ pace: e.target.value })} />
                  <span>to</span>
                  <input value={step.paceTo ?? ""} placeholder="4:45" aria-label="Slowest pace" onChange={(e) => onChange({ paceTo: e.target.value })} />
                  <span>/km</span>
                </>
              )}
              {intensity === "hr" && (
                <>
                  <input value={step.hrLow ?? ""} inputMode="numeric" placeholder="140" aria-label="Lowest heart rate" onChange={(e) => onChange({ hrLow: e.target.value })} />
                  <span>to</span>
                  <input value={step.hrHigh ?? ""} inputMode="numeric" placeholder="155" aria-label="Highest heart rate" onChange={(e) => onChange({ hrHigh: e.target.value })} />
                  <span>bpm</span>
                </>
              )}
              {intensity === "none" && <span className="mi-move__none">Run by feel</span>}
            </div>
          </div>
          <input className="mi-move__note" value={step.note} placeholder="Note: effort, terrain, cue…" aria-label="Note" onChange={(e) => onChange({ note: e.target.value })} />
        </div>
      ) : (
        step.note && <p className="mi-move__notesum">{step.note}</p>
      )}
    </div>
  );
}

function RoundCard({
  seg,
  dragging,
  handle,
  isOpen,
  onToggle,
  onChange,
  onRemove,
}: {
  seg: Segment;
  dragging: boolean;
  handle: HandleProps;
  isOpen: (id: string) => boolean;
  onToggle: (id: string) => void;
  onChange: (seg: Segment | null, delay?: number) => void;
  onRemove: () => void;
}) {
  const sort = useDragSort(seg.steps.map((s) => s.id), (from, to) => onChange({ ...seg, steps: moveIn(seg.steps, from, to) }, 150));
  return (
    <div className={`mi-round${dragging ? " mi-move--drag" : ""}`} data-enter>
      <div className="mi-move__head">
        <span className="mi-handle" role="button" aria-label="Drag round to reorder" {...handle}>
          <Icon name="grip" />
        </span>
        <span className="mi-round__label">Repeat</span>
        <select className="mi-stepchip mi-stepchip--plain" value={seg.rounds} aria-label="Sets" onChange={(e) => onChange({ ...seg, rounds: Number(e.target.value) }, 150)}>
          {Array.from({ length: 30 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}×</option>)}
        </select>
        <div className="mi-top__spacer" />
        <button type="button" className="icon-btn icon-btn--danger" aria-label="Delete round" onClick={onRemove}>
          <Icon name="trash" />
        </button>
      </div>
      <div className="mi-round__body">
        {seg.steps.map((st) => (
          <div key={st.id} ref={sort.itemRef(st.id)}>
            <MovementCard
              step={st}
              nested
              open={isOpen(st.id)}
              dragging={sort.dragging === st.id}
              handle={sort.handleProps(st.id)}
              onToggle={() => onToggle(st.id)}
              onChange={(patch) => onChange({ ...seg, steps: seg.steps.map((x) => (x.id === st.id ? { ...x, ...patch } : x)) })}
              onRemove={() => onChange(seg.steps.length === 1 ? null : { ...seg, steps: seg.steps.filter((x) => x.id !== st.id) }, 150)}
            />
          </div>
        ))}
        <button
          type="button"
          className="mi-textbtn mi-round__add"
          onClick={() => {
            const st = newStep(seg.steps.length % 2 ? "run" : "recovery");
            onToggle(st.id);
            onChange({ ...seg, steps: [...seg.steps, st] }, 150);
          }}
        >
          + Add movement to round
        </button>
      </div>
    </div>
  );
}

function RunCourse({ segments, onChange }: { segments: Segment[]; onChange: (segments: Segment[], delay?: number) => void }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const sort = useDragSort(segments.map((s) => s.id), (from, to) => onChange(moveIn(segments, from, to), 150));
  const setSeg = (id: string, seg: Segment | null, delay?: number) =>
    onChange(seg ? segments.map((s) => (s.id === id ? seg : s)) : segments.filter((s) => s.id !== id), delay);
  const totals = totalsLabel(segments);
  const courseRef = useEnter<HTMLDivElement>();

  return (
    <div ref={courseRef} className="mi-course">
      <div className="mi-sechead">
        <h3 className="mi-h2">Exercise</h3>
        {totals && <span className="mi-count">≈ {totals}</span>}
      </div>
      {segments.length === 0 && <p className="mi-muted">Add a movement (warm-up, run, rest…) or a round of repeats.</p>}
      {segments.map((seg) => {
        const round = seg.rounds > 1 || seg.steps.length > 1;
        return (
          <div key={seg.id} ref={sort.itemRef(seg.id)}>
            {round ? (
              <RoundCard
                seg={seg}
                dragging={sort.dragging === seg.id}
                handle={sort.handleProps(seg.id)}
                isOpen={(id) => open.has(id)}
                onToggle={toggle}
                onChange={(next, delay) => setSeg(seg.id, next, delay)}
                onRemove={() => setSeg(seg.id, null, 150)}
              />
            ) : (
              <MovementCard
                step={seg.steps[0]}
                open={open.has(seg.steps[0].id)}
                dragging={sort.dragging === seg.id}
                handle={sort.handleProps(seg.id)}
                onToggle={() => toggle(seg.steps[0].id)}
                onChange={(patch) => setSeg(seg.id, { ...seg, steps: [{ ...seg.steps[0], ...patch }] })}
                onRemove={() => setSeg(seg.id, null, 150)}
              />
            )}
          </div>
        );
      })}
      <div className="mi-course__actions">
        <button
          type="button"
          className="mi-pill"
          onClick={() => {
            const steps = [newStep("run"), newStep("recovery")];
            steps.forEach((s) => toggle(s.id));
            onChange([...segments, { id: newItemId(), rounds: 2, steps }], 150);
          }}
        >
          <Icon name="plus" /> Round
        </button>
        <button
          type="button"
          className="mi-pill"
          onClick={() => {
            const st = newStep("run");
            toggle(st.id);
            onChange([...segments, { id: newItemId(), rounds: 1, steps: [st] }], 150);
          }}
        >
          <Icon name="plus" /> Movement
        </button>
      </div>
    </div>
  );
}

// ---------- inline editor for an existing item (autosaves) ----------

export function EventEditor({
  event: listEvent,
  onClose,
  onMoved,
}: {
  event: PlannerEvent;
  onClose: () => void;
  onMoved: (date: string) => void;
}) {
  const [event, edit] = useEditEvent(listEvent.id, listEvent);
  const deleteEvent = useDeleteEvent();
  if (!event) return null;

  const set = (patch: Partial<PlannerEvent>, delay?: number) => edit((e) => ({ ...e, ...patch }), delay);
  const setSegments = (segments: Segment[], delay?: number) =>
    edit((e) => {
      // Total km always comes from the movements; the old free-form pace goes once there is a course.
      const km = runTotals(segments).km;
      return { ...e, details: { ...e.details, segments, km: km ? String(km) : "", pace: undefined } };
    }, delay);
  const segments = runSegments(event);
  const stats = setStats(event.details.exercises);

  async function remove() {
    if (!(await confirmDialog({ title: `Delete "${event!.title}"?`, confirmLabel: "Delete", danger: true }))) return;
    await deleteEvent.mutateAsync(event!.id);
    onClose();
  }

  return (
    <div className={`mi-editor mi-type--${event.type}`}>
      <div className="mi-editor__top">
        <span className="mi-badge">{TYPE_LABEL[event.type]}</span>
        <div className="mi-top__spacer" />
        <label className="mi-editor__done">
          <input type="checkbox" className="mi-checkbox" checked={event.done} onChange={() => set({ done: !event.done }, 150)} />
          {event.done ? "Done" : "Mark done"}
        </label>
        <button type="button" className="icon-btn icon-btn--danger" aria-label="Delete" onClick={remove} disabled={deleteEvent.isPending}>
          <Icon name="trash" />
        </button>
      </div>

      <input className="mi-editor__title" value={event.title} aria-label="Title" onChange={(e) => set({ title: e.target.value })} />

      {event.type === "run" && (
        <>
          <p className="mi-editor__sum">{totalsLabel(segments) || "Add movements below. Distance and time add up automatically."}</p>
          <input
            className="mi-editor__plain"
            value={event.details.detail ?? ""}
            placeholder="Course description"
            aria-label="Course description"
            onChange={(e) => set({ details: { ...event.details, detail: e.target.value } })}
          />
          <RunCourse segments={segments} onChange={setSegments} />
        </>
      )}

      {event.type === "workout" && (
        <div className="mi-editor__row">
          <span className="mi-muted">{[event.details.focus, `${stats.done}/${stats.total} sets`].filter(Boolean).join(", ")}</span>
          <div className="mi-top__spacer" />
          <Link to={`/mainichi/workout/${event.id}`} className="mi-pill">Open checklist <Icon name="chevron" /></Link>
        </div>
      )}

      <textarea className="mi-editor__notes" value={event.notes} placeholder="Notes" aria-label="Notes" onChange={(e) => set({ notes: e.target.value })} />

      <div className="mi-editor__row mi-editor__foot">
        <label className="mi-editor__field">
          <span>Move to</span>
          <input
            type="date"
            value={event.date}
            onChange={(e) => {
              if (!e.target.value) return;
              set({ date: e.target.value }, 0);
              onMoved(e.target.value);
            }}
          />
        </label>
        {event.type !== "run" && (
          <label className="mi-editor__field">
            <span>Time</span>
            <input type="time" value={event.time ?? ""} onChange={(e) => set({ time: e.target.value || null })} />
          </label>
        )}
      </div>
    </div>
  );
}

// ---------- inline create form ----------

/** The drawing for what is about to be added, with its facts in one line. Keyed so a new pick pops in again. */
function Preview({ type, preset, routine, date, time }: { type: EventType; preset: number; routine?: Routine; date: string; time: string }) {
  const p = RUN_PRESETS[preset];
  const [art, title, sub] =
    type === "run"
      ? [<RunArt type={p.type} />, p.title, totalsLabel(p.segments())]
      : type === "workout"
        ? [<WorkoutArt />, routine?.title ?? "Empty workout", routine ? [routine.focus, `${routine.exercises.length} exercises`].filter(Boolean).join(", ") : "Add exercises after"]
        : [<EventArt />, fromKey(date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }), time || "All day"];
  return (
    <div className="mi-preview mi-art__pop" key={`${type}-${preset}-${routine?.id ?? ""}`}>
      {art}
      <span className="mi-preview__text">
        <span className="mi-preview__title">{title}</span>
        <span className="mi-preview__sub">{sub}</span>
      </span>
    </div>
  );
}

export function NewEventForm({
  date,
  routines,
  onCancel,
  onCreated,
}: {
  date: string;
  routines: Routine[];
  onCancel: () => void;
  onCreated: (event: PlannerEvent) => void;
}) {
  const [type, setType] = useState<EventType>("run");
  const [title, setTitle] = useState(RUN_PRESETS[0].title);
  const [preset, setPreset] = useState(0);
  const [routineId, setRoutineId] = useState(routines[0]?.id ?? "");
  const [time, setTime] = useState("");
  const [repeat, setRepeat] = useState(1);
  const createEvents = useCreateEvents();

  function pickType(t: EventType) {
    setType(t);
    if (t === "run") setTitle(RUN_PRESETS[preset].title);
    if (t === "workout") setTitle(routines.find((r) => r.id === routineId)?.title ?? "Workout");
    if (t === "event") setTitle("");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const p = RUN_PRESETS[preset];
    const segments = type === "run" ? p.segments() : undefined;
    try {
      const created = await createEvents.mutateAsync({
        date,
        type,
        title,
        time: type === "run" ? null : time || null,
        details: segments ? { segments, km: String(runTotals(segments).km), runType: p.type } : undefined,
        routine_id: type === "workout" && routineId ? routineId : undefined,
        repeat_weeks: repeat,
      });
      onCreated(created[0]);
    } catch {
      // shown below via the mutation's error
    }
  }

  return (
    <form className="mi-editor mi-editor--new" onSubmit={submit}>
      <div className="mi-seg" role="radiogroup" aria-label="Type">
        {(["run", "workout", "event"] as EventType[]).map((t) => (
          <button key={t} type="button" role="radio" aria-checked={type === t} className={`mi-seg__btn${type === t ? " mi-seg__btn--on" : ""}`} onClick={() => pickType(t)}>
            <span className={`mi-dot mi-type--${t}`} /> {TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      <Preview type={type} preset={preset} routine={routines.find((r) => r.id === routineId)} date={date} time={time} />

      {type === "run" && (
        <>
          <div className="mi-filters">
            {RUN_PRESETS.map((p, i) => (
              <button
                key={p.title}
                type="button"
                className={`mi-chip-btn${preset === i ? " mi-chip-btn--on" : ""}`}
                aria-pressed={preset === i}
                onClick={() => {
                  setPreset(i);
                  setTitle(p.title);
                }}
              >
                {p.title}
              </button>
            ))}
          </div>
        </>
      )}

      {type === "workout" && (
        <select
          className="mi-editor__select"
          value={routineId}
          aria-label="Routine"
          onChange={(e) => {
            setRoutineId(e.target.value);
            setTitle(routines.find((r) => r.id === e.target.value)?.title ?? "Workout");
          }}
        >
          <option value="">Empty workout</option>
          {routines.map((r) => <option key={r.id} value={r.id}>{r.title}{r.focus ? `, ${r.focus}` : ""}</option>)}
        </select>
      )}

      <input
        className="mi-editor__title"
        value={title}
        required
        maxLength={200}
        placeholder={type === "event" ? "e.g. JLPT exam" : "Title"}
        aria-label="Title"
        onChange={(e) => setTitle(e.target.value)}
      />

      <div className="mi-editor__row">
        {type !== "run" && (
          <label className="mi-editor__field">
            <span>Time</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        )}
        <label className="mi-editor__field">
          <span>Repeat</span>
          <select value={repeat} onChange={(e) => setRepeat(Number(e.target.value))}>
            {[1, 2, 4, 6, 8, 12, 16].map((n) => <option key={n} value={n}>{n === 1 ? "Once" : `Weekly × ${n}`}</option>)}
          </select>
        </label>
      </div>

      {createEvents.error && <p className="field-error">{createEvents.error.message}</p>}

      <div className="mi-form__actions">
        <div className="mi-top__spacer" />
        <button type="button" className="mi-pill" onClick={onCancel}>Cancel</button>
        <button type="submit" className="mi-solid" disabled={createEvents.isPending}>Add</button>
      </div>
    </form>
  );
}
