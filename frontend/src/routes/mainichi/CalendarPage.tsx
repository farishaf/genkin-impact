import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  addDays, eventMeta, fromKey, isValidKey, toKey, todayKey, weekStart, TYPE_LABEL,
  useCreateRoutine, useEvents, useRoutines, useUpdateEvent,
  type EventType, type PlannerEvent,
} from "../../lib/planner";
import { Drawer, EventRow, Icon } from "./parts";
import { EventEditor, NewEventForm } from "./EventPanel";

const FILTERS: ("all" | EventType)[] = ["all", "workout", "run", "event"];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const runKm = (events: PlannerEvent[]) =>
  events.filter((e) => e.type === "run").reduce((sum, e) => sum + (parseFloat(e.details.km ?? "") || 0), 0);
const fmtKm = (n: number) => String(Math.round(n * 10) / 10);

export function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const sel = isValidKey(params.get("date")) ? params.get("date")! : todayKey();
  const monthParam = params.get("month");
  const monthStart = monthParam && /^\d{4}-\d{2}$/.test(monthParam)
    ? fromKey(`${monthParam}-01`)
    : new Date(fromKey(sel).getFullYear(), fromKey(sel).getMonth(), 1);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  const weeks: string[][] = [];
  for (let d = weekStart(monthStart); d <= monthEnd; d = addDays(d, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => toKey(addDays(d, i))));

  const { data: events = [] } = useEvents(weeks[0][0], weeks[weeks.length - 1][6]);
  const { data: routines = [] } = useRoutines();
  const updateEvent = useUpdateEvent();
  const createRoutine = useCreateRoutine();
  const [filter, setFilter] = useState<"all" | EventType>("all");
  const [adding, setAdding] = useState(false);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };
  const shiftMonth = (n: number) => update({ month: toKey(new Date(monthStart.getFullYear(), monthStart.getMonth() + n, 1)).slice(0, 7) });

  const shown = filter === "all" ? events : events.filter((e) => e.type === filter);
  const selEvents = events.filter((e) => e.date === sel);
  const editId = params.get("edit");
  const { data: next4Weeks = [] } = useEvents(todayKey(), toKey(addDays(new Date(), 28)));
  const upcomingRuns = next4Weeks.filter((e) => e.type === "run" && !e.done).slice(0, 4);
  // Keep the open item while a refetch (new month after "Move to", or a just-created item) has no row for it yet.
  const [lastEdit, setLastEdit] = useState<PlannerEvent>();
  const found = editId ? [...events, ...next4Weeks].find((e) => e.id === editId) : undefined;
  if (found && found !== lastEdit) setLastEdit(found);
  const editing = found ?? (lastEdit?.id === editId ? lastEdit : undefined);
  const closeDrawer = () => {
    setAdding(false);
    update({ edit: null });
  };
  const shortDate = (k: string) => fromKey(k).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  async function newRoutine() {
    const routine = await createRoutine.mutateAsync({ title: "New routine" });
    navigate(`/mainichi/routines/${routine.id}?edit=1`);
  }

  const inMonth = events.filter((e) => fromKey(e.date).getMonth() === monthStart.getMonth());
  const workouts = inMonth.filter((e) => e.type === "workout");
  const summary = [
    runKm(inMonth) ? `${fmtKm(runKm(inMonth))} km planned` : "",
    workouts.length ? `${workouts.filter((e) => e.done).length}/${workouts.length} workouts done` : "",
  ].filter(Boolean).join(" · ");

  return (
    <div className="mi-calpage">
      <div className="mi-calhead">
        <h1 className="mi-h1 mi-h1--xl">{monthStart.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</h1>
        <div className="mi-calhead__nav">
          <button type="button" className="mi-iconbtn" aria-label="Previous month" onClick={() => shiftMonth(-1)}><Icon name="back" /></button>
          <button type="button" className="mi-iconbtn" aria-label="Next month" onClick={() => shiftMonth(1)}><Icon name="chevron" /></button>
          <button type="button" className="mi-pill" onClick={() => update({ month: null, date: null })}>Today</button>
        </div>
        {summary && <span className="mi-calhead__sum">{summary}</span>}
        <div className="mi-top__spacer" />
        <div className="mi-filters">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className={`mi-chip-btn${filter === f ? " mi-chip-btn--on" : ""}`}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              <span className={`mi-dot${f === "all" ? "" : ` mi-type--${f}`}`} />
              {f === "all" ? "All" : `${TYPE_LABEL[f]}s`}
            </button>
          ))}
        </div>
        <button type="button" className="mi-solid" onClick={() => setAdding(true)}>+ Add</button>
      </div>

      <div className="mi-cols">
      <section className="card mi-card mi-cal mi-cols__main">
        <div className="mi-month">
          <div className="mi-month__row mi-month__row--head">
            {DOW.map((d) => <span key={d}>{d}</span>)}
            <span className="mi-month__km">Run km</span>
          </div>
          {weeks.map((wk) => {
            const weekEvents = events.filter((e) => wk.includes(e.date));
            const km = runKm(weekEvents);
            const doneKm = runKm(weekEvents.filter((e) => e.done));
            return (
              <div key={wk[0]} className="mi-month__row">
                {wk.map((k) => {
                  const items = shown.filter((e) => e.date === k);
                  const d = fromKey(k);
                  return (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={k === sel}
                      aria-label={`${d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}, ${items.length} items`}
                      className={`mi-cell${d.getMonth() !== monthStart.getMonth() ? " mi-cell--out" : ""}${k === sel ? " mi-cell--sel" : ""}${k === todayKey() ? " mi-cell--today" : ""}`}
                      onClick={() => update({ date: k })}
                    >
                      <span className="mi-cell__num">{d.getDate()}</span>
                      <span className="mi-cell__items">
                        {items.slice(0, 3).map((e) => (
                          <span key={e.id} className={`mi-tag mi-type--${e.type}${e.done ? " mi-tag--done" : ""}`}>
                            <span className="mi-tag__text">
                              {e.time && e.type === "event" ? `${e.time} ` : ""}
                              {e.title}
                              {e.type === "run" && e.details.km ? ` · ${e.details.km}k` : ""}
                            </span>
                          </span>
                        ))}
                        {items.length > 3 && <span className="mi-cell__more">+{items.length - 3} more</span>}
                      </span>
                    </button>
                  );
                })}
                <span className="mi-month__km">
                  {km ? (
                    <>
                      <strong>{fmtKm(km)}</strong>
                      <span>{fmtKm(doneKm)} done</span>
                    </>
                  ) : (
                    <span>–</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <div className="mi-cols__side">
        <section className="card mi-card mi-daypanel">
          <div className="mi-cardhead">
            <div className="mi-dayhead__titles">
              <span className="mi-kicker">{sel === todayKey() ? "Today" : fromKey(sel).toLocaleDateString("en-GB", { weekday: "long" })}</span>
              <h2 className="mi-h2 mi-h2--lg">{fromKey(sel).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</h2>
            </div>
            <button type="button" className="mi-pill" onClick={() => setAdding(true)}>+ Add here</button>
          </div>
          {selEvents.length === 0 ? (
            <p className="mi-empty">Nothing planned. Rest day?</p>
          ) : (
            <div className="mi-list">
              {selEvents.map((e) => (
                <EventRow
                  key={e.id}
                  event={e}
                  editWorkouts
                  onToggle={() => updateEvent.mutate({ id: e.id, done: !e.done })}
                  onEdit={() => update({ edit: e.id })}
                />
              ))}
            </div>
          )}
          <Link to={sel === todayKey() ? "/mainichi" : `/mainichi?date=${sel}`} className="mi-link">To-dos for this day ›</Link>
        </section>

        <section className="card mi-card">
          <div className="mi-cardhead">
            <h2 className="mi-h2">Routines</h2>
            <button type="button" className="mi-pill" onClick={newRoutine} disabled={createRoutine.isPending}>+ New routine</button>
          </div>
          {routines.length === 0 ? (
            <p className="mi-empty">Create a routine (e.g. Upper A) to plan workouts from it.</p>
          ) : (
            <div className="mi-list">
              {routines.map((r) => (
                <Link key={r.id} to={`/mainichi/routines/${r.id}`} className="mi-pagerow">
                  <span className="mi-tile">🏋️</span>
                  <span className="mi-pagerow__text">
                    <span className="mi-pagerow__title">{r.title}</span>
                    <span className="mi-pagerow__sub">{[r.focus, `${r.exercises.length} exercises`].filter(Boolean).join(" · ")}</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>

        {upcomingRuns.length > 0 && (
          <section className="card mi-card">
            <h2 className="mi-h2">Upcoming runs</h2>
            <div className="mi-list">
              {upcomingRuns.map((e) => (
                <button key={e.id} type="button" className="mi-pagerow" onClick={() => update({ date: e.date, edit: e.id })}>
                  <span className="mi-tile">🏃</span>
                  <span className="mi-pagerow__text">
                    <span className="mi-pagerow__title">{e.title}</span>
                    <span className="mi-pagerow__sub">
                      {fromKey(e.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · {eventMeta(e)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
      </div>

      {(adding || editing) && (
        <Drawer
          title={editing ? shortDate(editing.date) : `New item · ${shortDate(sel)}`}
          onClose={closeDrawer}
        >
          {!editing ? (
            <NewEventForm
              key={sel}
              date={sel}
              routines={routines}
              onCancel={() => setAdding(false)}
              onCreated={(e) => {
                // adding stays on until the drawer closes so it never unmounts between form and editor.
                setLastEdit(e);
                update({ edit: e.id });
              }}
            />
          ) : (
            <EventEditor
              key={editing!.id}
              event={editing!}
              onClose={closeDrawer}
              onMoved={(date) => update({ date, month: null })}
            />
          )}
        </Drawer>
      )}
    </div>
  );
}
