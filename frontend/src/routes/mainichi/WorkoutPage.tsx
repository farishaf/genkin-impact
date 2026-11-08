import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  fromKey, newItemId, setStats,
  useDeleteRoutine, useEditEvent, useEditRoutine, useEvent, useRoutine, useRoutines,
  type Exercise,
} from "../../lib/planner";
import { BackButton, Icon, Progress } from "./parts";

// ponytail: fixed default rest; "+10s" covers longer rests. Make it a setting if it keeps getting bumped.
const REST_SECONDS = 30;

type ChangeExercises = (fn: (xs: Exercise[]) => Exercise[], delay?: number) => void;

function ExerciseList({
  exercises,
  onChange,
  checkable,
  editing,
  library,
  onSetDone,
}: {
  exercises: Exercise[];
  onChange: ChangeExercises;
  checkable: boolean;
  editing: boolean;
  library: Exercise[];
  onSetDone?: () => void;
}) {
  const [newName, setNewName] = useState("");
  const updEx = (id: string, patch: Partial<Exercise>, delay?: number) =>
    onChange((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)), delay);
  const updSets = (id: string, fn: (sets: Exercise["sets"]) => Exercise["sets"], delay?: number) =>
    onChange((xs) => xs.map((x) => (x.id === id ? { ...x, sets: fn(x.sets) } : x)), delay);
  const move = (i: number, dir: number) =>
    onChange((xs) => {
      const a = [...xs];
      const j = i + dir;
      if (j < 0 || j >= a.length) return a;
      [a[i], a[j]] = [a[j], a[i]];
      return a;
    }, 150);

  function addExercise() {
    const name = newName.trim();
    if (!name) return;
    // Known exercise: start from its sets in the library (routines); otherwise 3 × 10.
    const src = library.find((x) => x.name.toLowerCase() === name.toLowerCase());
    const sets = src?.sets.length ? src.sets : [0, 1, 2].map(() => ({ id: "", reps: "10", kg: "", done: false }));
    onChange((xs) => [...xs, { id: newItemId(), name: src?.name ?? name, note: src?.note ?? "", sets: sets.map((s) => ({ ...s, id: newItemId(), done: false })) }], 150);
    setNewName("");
  }

  return (
    <>
      {exercises.length === 0 && <p className="muted mi-pad">No exercises yet. Add one below.</p>}
      {exercises.map((x, i) => (
        <section key={x.id} className="card mi-card mi-ex">
          <div className="mi-ex__head">
            <span className={`mi-ex__num${checkable && x.sets.length > 0 && x.sets.every((s) => s.done) ? " mi-ex__num--done" : ""}`}>{i + 1}</span>
            {editing ? (
              <input className="mi-input mi-ex__name" value={x.name} placeholder="Exercise" aria-label="Exercise name" onChange={(e) => updEx(x.id, { name: e.target.value })} />
            ) : (
              <h2 className="mi-ex__name">{x.name || "Untitled"}</h2>
            )}
            {checkable && <span className="mi-ex__count">{x.sets.filter((s) => s.done).length}/{x.sets.length}</span>}
            {editing && (
              <>
                <button type="button" className="mi-iconbtn" aria-label={`Move ${x.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button type="button" className="mi-iconbtn" aria-label={`Move ${x.name} down`} disabled={i === exercises.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button type="button" className="icon-btn icon-btn--danger" aria-label={`Remove ${x.name}`} onClick={() => onChange((xs) => xs.filter((e) => e.id !== x.id), 150)}><Icon name="x" /></button>
              </>
            )}
          </div>
          {editing ? (
            <input className="mi-input mi-ex__note" value={x.note} placeholder="Cue or note (optional)" aria-label={`${x.name} note`} onChange={(e) => updEx(x.id, { note: e.target.value })} />
          ) : (
            x.note && <p className="mi-ex__note">{x.note}</p>
          )}

          <div className={`mi-sets${checkable ? " mi-sets--check" : ""}${editing ? " mi-sets--edit" : ""}`}>
            <div className="mi-sets__row mi-sets__row--head">
              <span>Set</span>
              <span>Reps</span>
              <span>Kg</span>
              {checkable && <span>Done</span>}
              {editing && <span />}
            </div>
            {x.sets.map((s, si) => (
              <div key={s.id} className={`mi-sets__row${s.done ? " mi-sets__row--done" : ""}`}>
                <span className="mi-sets__n">{si + 1}</span>
                <input
                  className="mi-input mi-sets__in"
                  value={s.reps}
                  aria-label={`${x.name} set ${si + 1} reps`}
                  onChange={(e) => updSets(x.id, (ss) => ss.map((y) => (y.id === s.id ? { ...y, reps: e.target.value } : y)))}
                />
                <input
                  className="mi-input mi-sets__in"
                  value={s.kg}
                  inputMode="decimal"
                  placeholder="0"
                  aria-label={`${x.name} set ${si + 1} kg`}
                  onChange={(e) => updSets(x.id, (ss) => ss.map((y) => (y.id === s.id ? { ...y, kg: e.target.value } : y)))}
                />
                {checkable && (
                  <button
                    type="button"
                    className={`mi-tick${s.done ? " mi-tick--on" : ""}`}
                    aria-pressed={s.done}
                    aria-label={`${x.name} set ${si + 1} done`}
                    onClick={() => {
                      updSets(x.id, (ss) => ss.map((y) => (y.id === s.id ? { ...y, done: !y.done } : y)), 150);
                      if (!s.done) onSetDone?.();
                    }}
                  >
                    <Icon name="check" />
                  </button>
                )}
                {editing && (
                  <button type="button" className="icon-btn icon-btn--danger" aria-label={`Remove set ${si + 1}`} onClick={() => updSets(x.id, (ss) => ss.filter((y) => y.id !== s.id), 150)}>
                    <Icon name="x" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            className="mi-link"
            onClick={() => updSets(x.id, (ss) => [...ss, { reps: ss.at(-1)?.reps ?? "10", kg: ss.at(-1)?.kg ?? "", id: newItemId(), done: false }], 150)}
          >
            + Add set
          </button>
        </section>
      ))}

      <div className="card mi-card mi-addex">
        <input
          className="mi-input"
          list="mi-exercise-library"
          value={newName}
          placeholder="Add exercise"
          aria-label="Add exercise"
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addExercise()}
        />
        <datalist id="mi-exercise-library">
          {[...new Set(library.map((x) => x.name))].map((n) => <option key={n} value={n} />)}
        </datalist>
        <button type="button" className="btn btn--outline btn--sm" onClick={addExercise} disabled={!newName.trim()}>Add</button>
      </div>
    </>
  );
}

function RestTimer({ end, onChange }: { end: number; onChange: (end: number | null) => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((end - now) / 1000));
  const finished = left === 0;
  useEffect(() => {
    if (!finished) return;
    navigator.vibrate?.([200, 100, 200]);
    const t = window.setTimeout(() => onChange(null), 2000);
    return () => window.clearTimeout(t);
  }, [finished, onChange]);

  return (
    <div className={`mi-rest${finished ? " mi-rest--done" : ""}`} role="timer" aria-live="polite">
      <span className="mi-rest__label">{finished ? "Go!" : "Rest"}</span>
      <span className="mi-rest__time">{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span>
      <div className="mi-top__spacer" />
      <button type="button" className="mi-pill" onClick={() => onChange(Math.max(end, Date.now()) + 10_000)}>+10s</button>
      <button type="button" className="mi-pill" onClick={() => onChange(null)}>Skip</button>
    </div>
  );
}

const libraryFrom = (routines: { exercises: Exercise[] }[]) => routines.flatMap((r) => r.exercises).filter((x) => x.name.trim());

export function WorkoutEventPage() {
  const { id = "" } = useParams();
  const { data: serverEvent, isLoading } = useEvent(id);
  const [event, edit] = useEditEvent(id, serverEvent);
  const { data: routines = [] } = useRoutines();
  const [editing, setEditing] = useState(false);
  const [restEnd, setRestEnd] = useState<number | null>(null);

  if (isLoading) return <p className="page-loading">Loading…</p>;
  if (!event) return <div className="mi-narrow"><BackButton /><p className="muted">Workout not found.</p></div>;

  const exercises = event.details.exercises ?? [];
  const { done, total } = setStats(exercises);
  // Ticking the last set marks the whole workout done.
  const setExercises: ChangeExercises = (fn, delay) =>
    edit((e) => {
      const xs = fn(e.details.exercises ?? []);
      const st = setStats(xs);
      return { ...e, done: st.total > 0 && st.done === st.total ? true : e.done, details: { ...e.details, exercises: xs } };
    }, delay);

  return (
    <div className="mi-narrow">
      <BackButton />
      <header className="card mi-card mi-whead">
        <div className="mi-whead__top">
          <div className="mi-dayhead__titles">
            <input
              className="mi-title"
              value={event.title}
              aria-label="Workout title"
              onChange={(e) => {
                const title = e.target.value;
                edit((ev) => ({ ...ev, title }));
              }}
            />
            <span className="mi-muted">
              {[`Workout on ${fromKey(event.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}`, event.details.focus, `${exercises.length} movement${exercises.length === 1 ? "" : "s"}`].filter(Boolean).join(", ")}
            </span>
          </div>
          <div className="mi-dochead__actions">
            <button type="button" className={`mi-pill${editing ? " mi-pill--on" : ""}`} onClick={() => setEditing((v) => !v)}>
              {editing ? "Done editing" : "Edit"}
            </button>
            <button
              type="button"
              className={`mi-pill${event.done ? " mi-pill--logged" : ""}`}
              aria-pressed={event.done}
              onClick={() => edit((ev) => ({ ...ev, done: !ev.done }), 150)}
            >
              {event.done ? <>Logged <Icon name="check" /></> : "Mark done"}
            </button>
          </div>
        </div>
        <div className="mi-dochead__bar">
          <Progress done={done} total={total} />
          <span className="mi-whead__sets">{done} of {total} sets</span>
        </div>
        {editing && done > 0 && (
          <button
            type="button"
            className="mi-textbtn"
            onClick={() => setExercises((xs) => xs.map((x) => ({ ...x, sets: x.sets.map((s) => ({ ...s, done: false })) })), 150)}
          >
            Uncheck all sets
          </button>
        )}
      </header>

      <ExerciseList
        exercises={exercises}
        onChange={setExercises}
        checkable
        editing={editing}
        library={[...libraryFrom(routines), ...exercises]}
        onSetDone={() => setRestEnd(Date.now() + REST_SECONDS * 1000)}
      />

      <section className="card mi-card">
        <h2 className="mi-h2">Session notes</h2>
        <textarea
          className="mi-notes"
          placeholder="How did it feel? PRs, pain, tweaks for next time…"
          value={event.notes}
          onChange={(e) => {
            const notes = e.target.value;
            edit((ev) => ({ ...ev, notes }));
          }}
        />
      </section>

      {restEnd && <RestTimer end={restEnd} onChange={setRestEnd} />}
    </div>
  );
}

export function RoutinePage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { data: serverRoutine, isLoading } = useRoutine(id);
  const { data: routines = [] } = useRoutines();
  const [routine, edit] = useEditRoutine(id, serverRoutine);
  const deleteRoutine = useDeleteRoutine();
  const [editing, setEditing] = useState(params.get("edit") === "1");

  if (isLoading) return <p className="page-loading">Loading…</p>;
  if (!routine) return <div className="mi-narrow"><BackButton /><p className="muted">Routine not found.</p></div>;

  async function remove() {
    if (!routine || !window.confirm(`Delete routine "${routine.title}"? Planned workouts keep their exercises.`)) return;
    await deleteRoutine.mutateAsync(routine.id);
    navigate("/mainichi/calendar");
  }

  return (
    <div className="mi-narrow">
      <BackButton />
      <header className="card mi-card mi-whead">
        <input
          className="mi-title"
          value={routine.title}
          aria-label="Routine name"
          onChange={(e) => {
            const title = e.target.value;
            edit((r) => ({ ...r, title }));
          }}
        />
        <span className="mi-muted">Routine template</span>
        <input
          className="mi-input mi-subtitle"
          value={routine.focus}
          placeholder="Focus, e.g. Push"
          aria-label="Focus"
          onChange={(e) => {
            const focus = e.target.value;
            edit((r) => ({ ...r, focus }));
          }}
        />
        <p className="mi-muted">Changes apply to workouts you add from now on. Already-planned sessions keep their own copy.</p>
        <div className="mi-dochead__actions">
          <button type="button" className={`mi-pill${editing ? " mi-pill--on" : ""}`} onClick={() => setEditing((v) => !v)}>
            {editing ? "Done editing" : "Edit"}
          </button>
          <button type="button" className="mi-pill mi-pill--danger" onClick={remove} disabled={deleteRoutine.isPending}>Delete</button>
        </div>
      </header>

      <ExerciseList
        exercises={routine.exercises}
        onChange={(fn, delay) => edit((r) => ({ ...r, exercises: fn(r.exercises) }), delay)}
        checkable={false}
        editing={editing}
        library={libraryFrom(routines)}
      />
    </div>
  );
}
