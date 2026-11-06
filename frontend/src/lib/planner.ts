import { useRef, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { api } from "./api";
import { queryClient } from "./queryClient";

// ---------- types (mirror backend/src/routes/planner.ts) ----------

export type EventType = "workout" | "run" | "event";
export interface WorkoutSet { id: string; reps: string; kg: string; done: boolean }
export interface Exercise { id: string; name: string; note: string; sets: WorkoutSet[] }
export interface CheckItem { id: string; text: string; done: boolean }
export interface Todo extends CheckItem { page_id: string | null }

export type StepKind = "warmup" | "run" | "recovery" | "cooldown";
export type StepUnit = "km" | "m" | "min" | "s";
export type Intensity = "none" | "pace" | "hr";
export interface RunStep {
  id: string;
  kind: StepKind;
  amount: string;
  unit: StepUnit;
  intensity?: Intensity;
  pace: string;
  paceTo?: string;
  hrLow?: string;
  hrHigh?: string;
  note: string;
}
/** Steps saved before intensity existed: a pace means pace focus. */
export const stepIntensity = (s: RunStep): Intensity => s.intensity ?? (s.pace ? "pace" : "none");
/** rounds = 1 is a single step; rounds > 1 repeats the steps (e.g. 6 × [400 m run, 90 s recovery]). */
export interface Segment { id: string; rounds: number; steps: RunStep[] }

export interface EventDetails {
  segments?: Segment[];
  km?: string;
  pace?: string;
  detail?: string;
  routine_id?: string | null;
  focus?: string;
  exercises?: Exercise[];
}
export interface PlannerEvent {
  id: string;
  date: string;
  type: EventType;
  title: string;
  time: string | null;
  notes: string;
  done: boolean;
  details: EventDetails;
}
export interface Routine { id: string; title: string; focus: string; exercises: Exercise[] }
export interface Day { date: string; todos: Todo[]; notes: string }
export interface Page { id: string; icon: string; title: string; description: string; checklist: CheckItem[]; notes: string; updated_at: string }

export const TYPE_LABEL: Record<EventType, string> = { workout: "Workout", run: "Run", event: "Event" };

// ---------- dates (local calendar days as YYYY-MM-DD) ----------

const pad = (n: number) => String(n).padStart(2, "0");
export const toKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromKey = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const todayKey = () => toKey(new Date());
/** Monday of the week containing d. */
export const weekStart = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));
export const isValidKey = (k: string | null): k is string => !!k && /^\d{4}-\d{2}-\d{2}$/.test(k) && !Number.isNaN(fromKey(k).getTime());

export const newItemId = () => crypto.randomUUID();
export const setStats = (exercises: Exercise[] = []) => {
  const sets = exercises.flatMap((x) => x.sets);
  return { done: sets.filter((s) => s.done).length, total: sets.length };
};

export const STEP_LABEL: Record<StepKind, string> = { warmup: "Warm-up", run: "Run", recovery: "Rest", cooldown: "Cool-down" };

/** "5:30" (min/km) → 5.5; anything else → null. */
const paceMinutes = (pace = "") => {
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(pace.trim());
  return m ? Number(m[1]) + Number(m[2]) / 60 : null;
};

/** Pace used for estimates: the middle of a pace range, or the single pace. Null without a pace focus. */
function stepPace(s: RunStep) {
  if (stepIntensity(s) !== "pace") return null;
  const lo = paceMinutes(s.pace);
  const hi = paceMinutes(s.paceTo);
  return lo && hi ? (lo + hi) / 2 : lo ?? hi;
}

/** Distance and duration of a structured run. Time-based steps count toward km only when they have a pace. */
export function runTotals(segments: Segment[] = []) {
  let km = 0;
  let minutes = 0;
  let timed = true;
  for (const seg of segments) {
    for (const s of seg.steps) {
      const amount = parseFloat(s.amount.replace(",", ".")) || 0;
      const pace = stepPace(s);
      const stepKm = s.unit === "km" ? amount : s.unit === "m" ? amount / 1000 : pace ? (s.unit === "min" ? amount : amount / 60) / pace : 0;
      const stepMin = s.unit === "min" ? amount : s.unit === "s" ? amount / 60 : pace ? stepKm * pace : NaN;
      km += stepKm * seg.rounds;
      if (Number.isNaN(stepMin)) timed = false;
      else minutes += stepMin * seg.rounds;
    }
  }
  return { km: Math.round(km * 100) / 100, minutes: timed ? Math.round(minutes) : null };
}

const UNIT_LABEL: Record<StepUnit, string> = { km: "km", m: "m", min: "min", s: "s" };
export const goalLabel = (s: RunStep) => `${s.amount || "–"} ${UNIT_LABEL[s.unit]}`;
/** "4:30–4:45 /km", "140–155 bpm" or "None". */
export function intensityLabel(s: RunStep) {
  const range = (a = "", b = "") => (a && b ? `${a}–${b}` : a || b);
  const i = stepIntensity(s);
  if (i === "pace") return range(s.pace, s.paceTo) ? `${range(s.pace, s.paceTo)} /km` : "Pace";
  if (i === "hr") return range(s.hrLow, s.hrHigh) ? `${range(s.hrLow, s.hrHigh)} bpm` : "Heart rate";
  return "None";
}

/** "6 × (400 m @ 4:30–4:45 /km + 90 s)" style one-liner for a segment. */
export function segmentLabel(seg: Segment) {
  const step = (s: RunStep) => `${goalLabel(s)}${stepIntensity(s) === "none" ? "" : ` @ ${intensityLabel(s)}`}`;
  const body = seg.steps.map(step).join(" + ");
  return seg.rounds > 1 ? `${seg.rounds} × (${body})` : `${STEP_LABEL[seg.steps[0].kind]} ${body}`;
}

const step = (kind: StepKind, amount: string, unit: StepUnit, pace = "", paceTo = "", note = ""): RunStep => ({
  id: newItemId(), kind, amount, unit, intensity: pace ? "pace" : "none", pace, paceTo, note,
});
const one = (s: RunStep): Segment => ({ id: newItemId(), rounds: 1, steps: [s] });

/** Starting structures for the run presets. */
export const RUN_PRESETS: { title: string; segments: () => Segment[] }[] = [
  { title: "Easy run", segments: () => [one(step("run", "5", "km", "6:45", "7:15", "Zone 2, conversational"))] },
  { title: "Long run", segments: () => [one(step("run", "14", "km", "6:30", "7:00"))] },
  {
    title: "Tempo run",
   
    segments: () => [one(step("warmup", "10", "min")), one(step("run", "4", "km", "5:40", "5:50", "Comfortably hard")), one(step("cooldown", "10", "min"))],
  },
  {
    title: "Intervals",
   
    segments: () => [
      one(step("warmup", "10", "min")),
      { id: newItemId(), rounds: 6, steps: [step("run", "400", "m", "4:50", "5:05"), step("recovery", "90", "s", "", "", "Walk or jog")] },
      one(step("cooldown", "10", "min")),
    ],
  },
];
/**
 * A run's movements. Runs saved before structured courses only had km/pace: show those as one Run
 * movement (stable id, so it can be edited) instead of an empty course.
 */
export function runSegments(e: PlannerEvent): Segment[] {
  if (e.details.segments?.length || !e.details.km) return e.details.segments ?? [];
  const pace = e.details.pace ?? "";
  return [{
    id: `legacy-${e.id}`,
    rounds: 1,
    steps: [{ id: `legacy-step-${e.id}`, kind: "run", amount: e.details.km, unit: "km", intensity: pace ? "pace" : "none", pace, note: "" }],
  }];
}

/** Sensible defaults per movement type, matching how they are usually planned. */
export const newStep = (kind: StepKind = "run"): RunStep =>
  kind === "run" ? step("run", "1", "km", "6:00", "6:30") : step(kind, kind === "recovery" ? "2" : "10", "min");

/** "07:00 · 5 km · 7:00 /km" for runs, "Push · 3/20 sets" for workouts. */
export function eventMeta(e: PlannerEvent) {
  const parts: string[] = [];
  if (e.time) parts.push(e.time);
  if (e.type === "run") {
    if (e.details.km) parts.push(`${e.details.km} km`);
    const block = e.details.segments?.find((s) => s.rounds > 1);
    if (block) parts.push(segmentLabel(block));
    else if (e.details.pace) parts.push(`${e.details.pace}/km`);
  }
  if (e.type === "workout") {
    const { done, total } = setStats(e.details.exercises);
    if (e.details.focus) parts.push(e.details.focus);
    parts.push(`${done}/${total} sets`);
  }
  return parts.join(" · ");
}

// ---------- autosave ----------
// Edits update the react-query cache immediately; the network save is debounced per document and
// always sends the cache's latest value, so a burst of keystrokes and ticks becomes one request.
// A failed save stays queued and is retried by the "Retry" button in the shell (flushSaves).

type SaveState = "idle" | "saving" | "error";
const pending = new Map<string, { timer?: number; run: () => Promise<unknown> }>();
let inFlight = 0;
let saveState: SaveState = "idle";
const listeners = new Set<() => void>();
const setSaveState = (s: SaveState) => {
  saveState = s;
  listeners.forEach((l) => l());
};

function runSave(key: string, run: () => Promise<unknown>) {
  pending.delete(key);
  inFlight++;
  setSaveState("saving");
  run()
    .then(() => {
      inFlight--;
      if (inFlight === 0 && saveState !== "error") setSaveState("idle");
    })
    .catch(() => {
      inFlight--;
      if (!pending.has(key)) pending.set(key, { run });
      setSaveState("error");
    });
}

function scheduleSave(key: string, run: () => Promise<unknown>, delay: number) {
  clearTimeout(pending.get(key)?.timer);
  pending.set(key, { run, timer: window.setTimeout(() => runSave(key, run), delay) });
}

export function flushSaves() {
  if (saveState === "error") setSaveState("idle");
  for (const [key, p] of [...pending]) {
    clearTimeout(p.timer);
    runSave(key, p.run);
  }
}

// Don't lose the tail of a debounce when the tab is hidden or closed.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushSaves();
});

export function useSaveState() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => saveState
  );
}

/**
 * Returns `[doc, edit]`. `edit(fn, delay?)` applies fn to the document now and persists it shortly after.
 * The rendered doc is held in React state, not read back from the query cache: cache subscribers are
 * notified on a later tick, which makes controlled inputs drop keystrokes when typing fast.
 */
function useDocEditor<T>(queryKey: QueryKey, serverDoc: T | undefined, save: (doc: T) => Promise<unknown>) {
  const qc = useQueryClient();
  const key = JSON.stringify(queryKey);
  const [local, setLocal] = useState<{ key: string; doc: T } | null>(null);
  const latest = useRef(local);
  const doc = local?.key === key ? local.doc : serverDoc;

  const edit = (fn: (doc: T) => T, delay = 600) => {
    const base = latest.current?.key === key ? latest.current.doc : (qc.getQueryData<T>(queryKey) ?? serverDoc);
    if (!base) return;
    const next = { key, doc: fn(base) };
    latest.current = next;
    setLocal(next);
    qc.setQueryData<T>(queryKey, next.doc);
    scheduleSave(key, () => save(qc.getQueryData<T>(queryKey)!), delay);
  };
  return [doc, edit] as const;
}

const invalidate = (...keys: QueryKey[]) => Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));

// ---------- events ----------

export function useEvents(from: string, to: string) {
  return useQuery({
    queryKey: ["planner", "events", from, to],
    queryFn: () => api.get<{ events: PlannerEvent[] }>(`/planner/events?from=${from}&to=${to}`).then((r) => r.events),
  });
}

export function useEvent(id: string) {
  return useQuery({
    queryKey: ["planner", "event", id],
    queryFn: () => api.get<{ event: PlannerEvent }>(`/planner/events/${id}`).then((r) => r.event),
  });
}

export function useEditEvent(id: string, event: PlannerEvent | undefined) {
  return useDocEditor<PlannerEvent>(["planner", "event", id], event, (e) =>
    api
      .patch(`/planner/events/${id}`, { date: e.date, time: e.time, title: e.title || "Untitled", notes: e.notes, done: e.done, details: e.details })
      .then(() => invalidate(["planner", "events"]))
  );
}

export type EventInput = {
  date: string;
  type: EventType;
  title: string;
  time?: string | null;
  notes?: string;
  details?: EventDetails;
  routine_id?: string;
  repeat_weeks?: number;
};

export function useCreateEvents() {
  return useMutation({
    mutationFn: (input: EventInput) => api.post<{ events: PlannerEvent[] }>("/planner/events", input).then((r) => r.events),
    onSuccess: () => invalidate(["planner", "events"]),
  });
}

export function useUpdateEvent() {
  return useMutation({
    mutationFn: ({ id, ...patch }: Partial<PlannerEvent> & { id: string }) =>
      api.patch<{ event: PlannerEvent }>(`/planner/events/${id}`, patch).then((r) => r.event),
    onSuccess: (event) => {
      queryClient.setQueryData(["planner", "event", event.id], event);
      return invalidate(["planner", "events"]);
    },
  });
}

export function useDeleteEvent() {
  return useMutation({
    mutationFn: (id: string) => api.del(`/planner/events/${id}`),
    onSuccess: () => invalidate(["planner", "events"]),
  });
}

// ---------- routines ----------

export function useRoutines() {
  return useQuery({
    queryKey: ["planner", "routines"],
    queryFn: () => api.get<{ routines: Routine[] }>("/planner/routines").then((r) => r.routines),
  });
}

export function useRoutine(id: string) {
  return useQuery({
    queryKey: ["planner", "routine", id],
    queryFn: () => api.get<{ routine: Routine }>(`/planner/routines/${id}`).then((r) => r.routine),
  });
}

export function useEditRoutine(id: string, routine: Routine | undefined) {
  return useDocEditor<Routine>(["planner", "routine", id], routine, (r) =>
    api
      .patch(`/planner/routines/${id}`, { title: r.title || "Untitled routine", focus: r.focus, exercises: r.exercises })
      .then(() => invalidate(["planner", "routines"]))
  );
}

export function useCreateRoutine() {
  return useMutation({
    mutationFn: (input: { title: string; focus?: string; exercises?: Exercise[] }) =>
      api.post<{ routine: Routine }>("/planner/routines", input).then((r) => r.routine),
    onSuccess: () => invalidate(["planner", "routines"]),
  });
}

export function useDeleteRoutine() {
  return useMutation({
    mutationFn: (id: string) => api.del(`/planner/routines/${id}`),
    onSuccess: () => invalidate(["planner", "routines"]),
  });
}

// ---------- days ----------

export function useDay(date: string) {
  return useQuery({
    queryKey: ["planner", "day", date],
    queryFn: () => api.get<{ day: Day }>(`/planner/days/${date}`).then((r) => r.day),
  });
}

export function useEditDay(date: string, day: Day | undefined) {
  return useDocEditor<Day>(["planner", "day", date], day, (d) => api.put(`/planner/days/${date}`, { todos: d.todos, notes: d.notes }));
}

// ---------- pages ----------

export function usePages() {
  return useQuery({
    queryKey: ["planner", "pages"],
    queryFn: () => api.get<{ pages: Page[] }>("/planner/pages").then((r) => r.pages),
  });
}

export function usePage(id: string) {
  return useQuery({
    queryKey: ["planner", "page", id],
    queryFn: () => api.get<{ page: Page }>(`/planner/pages/${id}`).then((r) => r.page),
  });
}

export function useEditPage(id: string, page: Page | undefined) {
  return useDocEditor<Page>(["planner", "page", id], page, (p) =>
    api
      .patch(`/planner/pages/${id}`, { icon: p.icon, title: p.title, description: p.description, checklist: p.checklist, notes: p.notes })
      .then(() => invalidate(["planner", "pages"]))
  );
}

export function useCreatePage() {
  return useMutation({
    mutationFn: (input: { title?: string; icon?: string }) => api.post<{ page: Page }>("/planner/pages", input).then((r) => r.page),
    onSuccess: (page) => {
      queryClient.setQueryData(["planner", "page", page.id], page);
      return invalidate(["planner", "pages"]);
    },
  });
}

export function useDeletePage() {
  return useMutation({
    mutationFn: async (id: string) => {
      // A queued autosave landing after the delete would 404 and leave the shell stuck on "Retry".
      const key = JSON.stringify(["planner", "page", id]);
      const queued = pending.get(key);
      clearTimeout(queued?.timer);
      pending.delete(key);
      try {
        await api.del(`/planner/pages/${id}`);
      } catch (err) {
        if (queued) scheduleSave(key, queued.run, 0);
        throw err;
      }
    },
    // The server also unlinks to-dos pointing at the page.
    onSuccess: (_, id) => {
      // Inactive only: an open PageView would refetch and 404 before it navigates away.
      queryClient.removeQueries({ queryKey: ["planner", "page", id], type: "inactive" });
      return invalidate(["planner", "pages"], ["planner", "day"]);
    },
  });
}
