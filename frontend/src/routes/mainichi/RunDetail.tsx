import { useState, type FormEvent } from "react";
import {
  eventMeta, formatDuration, formatPace, fromKey, runSegments, runTotals, segmentLabel, useUpdateEvent, weekRunStats,
  type PlannerEvent,
} from "../../lib/planner";
import { Drawer, Icon } from "./parts";

const longDate = (key: string) => fromKey(key).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });

/**
 * One run, read-only: the estimate worked out from the planned paces, the plan, and the result log.
 * Marking a run done happens here, so elevation and heart rate are asked for at that moment.
 */
export function RunDetail({ event, onClose, onEdit }: { event: PlannerEvent; onClose: () => void; onEdit: () => void }) {
  const segments = runSegments(event);
  const t = runTotals(segments);
  const updateEvent = useUpdateEvent();
  const [elevation, setElevation] = useState(event.details.elevation ?? "");
  const [avgHr, setAvgHr] = useState(event.details.avgHr ?? "");
  const [duration, setDuration] = useState(event.details.duration_min ?? "");
  const [rpe, setRpe] = useState(event.details.rpe ?? "");

  function save(done: boolean) {
    updateEvent.mutate(
      { id: event.id, done, details: { ...event.details, elevation: elevation.trim(), avgHr: avgHr.trim(), duration_min: duration.trim(), rpe: rpe.trim() } },
      { onSuccess: onClose },
    );
  }

  return (
    <Drawer title={longDate(event.date)} onClose={onClose}>
      <div className="mi-rundetail">
        <div className="mi-rundetail__head">
          <h3 className="mi-h2 mi-h2--lg">{event.title}</h3>
          {event.done && <span className="mi-chip mi-chip--done">Done</span>}
        </div>

        <dl className="mi-figs">
          <div>
            <dt>Distance</dt>
            <dd>{t.km ? `${t.km} km` : "—"}</dd>
          </div>
          <div>
            <dt>Est. time</dt>
            <dd>{t.minutes !== null && t.minutes > 0 ? formatDuration(t.minutes) : "—"}</dd>
          </div>
          <div>
            <dt>Avg pace</dt>
            <dd>{t.pace ? formatPace(t.pace) : "—"}</dd>
          </div>
        </dl>
        {(t.minutes === null || !t.pace) && segments.length > 0 && (
          <p className="mi-muted mi-rundetail__hint">Give each distance step a pace to get the full time and pace.</p>
        )}

        {segments.length > 0 && (
          <section className="mi-rundetail__plan" aria-label="Plan">
            <h3 className="mi-label">Plan</h3>
            <ol>
              {segments.map((seg) => <li key={seg.id}>{segmentLabel(seg)}</li>)}
            </ol>
          </section>
        )}

        <form
          className="mi-rundetail__log"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            save(true);
          }}
        >
          <h3 className="mi-label">{event.done ? "Result" : "Log it when you're back"}</h3>
          <div className="mi-rundetail__fields">
            <label className="field">
              <span>Elevation gain (m)</span>
              <input value={elevation} inputMode="numeric" placeholder="e.g. 120" onChange={(e) => setElevation(e.target.value)} />
            </label>
            <label className="field">
              <span>Avg heart rate (bpm)</span>
              <input value={avgHr} inputMode="numeric" placeholder="e.g. 150" onChange={(e) => setAvgHr(e.target.value)} />
            </label>
            <label className="field">
              <span>Time (min)</span>
              <input value={duration} inputMode="numeric" placeholder="e.g. 52" onChange={(e) => setDuration(e.target.value)} />
            </label>
            <label className="field">
              <span>Effort (RPE 1–10)</span>
              <input value={rpe} inputMode="numeric" placeholder="e.g. 4" onChange={(e) => setRpe(e.target.value)} />
            </label>
          </div>
          {updateEvent.isError && <p className="field-error">Couldn't save. Try again.</p>}
          <div className="mi-rundetail__actions">
            {event.done ? (
              <button type="button" className="btn btn--ghost" onClick={() => save(false)} disabled={updateEvent.isPending}>Mark not done</button>
            ) : (
              <button type="button" className="btn btn--ghost" onClick={onEdit}>Edit plan</button>
            )}
            <div className="mi-top__spacer" />
            {event.done && <button type="button" className="btn btn--outline" onClick={onEdit}>Edit plan</button>}
            <button type="submit" className="btn btn--primary" disabled={updateEvent.isPending}>
              {event.done ? "Save" : "Mark done"}
            </button>
          </div>
        </form>
      </div>
    </Drawer>
  );
}

/** One week's runs, opened from the Run km column: totals of the done runs, then each run (press one for its detail). */
export function RunWeek({ start, events, onClose, onOpenRun }: { start: string; events: PlannerEvent[]; onClose: () => void; onOpenRun: (id: string) => void }) {
  const runs = events.filter((e) => e.type === "run").sort((a, b) => a.date.localeCompare(b.date));
  const w = weekRunStats(runs);
  const title = `Week of ${fromKey(start).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
  return (
    <Drawer title={title} onClose={onClose}>
      <div className="mi-rundetail">
        <p className="mi-count">{w.done} of {w.planned} runs done{w.done ? ". Figures cover the done runs." : "."}</p>
        <dl className="mi-figs mi-figs--2x2">
          <div><dt>Distance</dt><dd>{w.km} km</dd></div>
          <div><dt>Avg pace</dt><dd>{w.pace ? formatPace(w.pace) : "—"}</dd></div>
          <div><dt>Elevation</dt><dd>{w.elevation} m</dd></div>
          <div><dt>Avg HR</dt><dd>{w.avgHr ? `${w.avgHr} bpm` : "—"}</dd></div>
        </dl>
        {runs.length === 0 ? (
          <p className="mi-empty">No runs planned this week.</p>
        ) : (
          <section className="mi-rundetail__plan" aria-label="Runs">
            <h3 className="mi-label">Runs</h3>
            <div className="mi-list">
              {runs.map((e) => (
                <button key={e.id} type="button" className="mi-pagerow" onClick={() => onOpenRun(e.id)}>
                  <span className="mi-tile"><Icon name={e.done ? "check" : "timer"} /></span>
                  <span className="mi-pagerow__text">
                    <span className="mi-pagerow__title">{e.title}</span>
                    <span className="mi-pagerow__sub">
                      {[fromKey(e.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric" }), eventMeta(e), e.done ? "done" : ""].filter(Boolean).join(", ")}
                    </span>
                  </span>
                  <Icon name="chevron" className="mi-event__go" />
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </Drawer>
  );
}
