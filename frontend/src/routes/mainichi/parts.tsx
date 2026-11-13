import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useEnter } from "../../lib/motion";
import { eventMeta, TYPE_LABEL, type CheckItem, type PlannerEvent } from "../../lib/planner";

/** Notion-ish checklist: tick, edit inline, Enter jumps to the add row, Backspace on an empty item removes it. */
export function Checklist<T extends CheckItem>({
  items,
  onChange,
  makeItem,
  placeholder = "Add an item",
  renderExtra,
}: {
  items: T[];
  onChange: (items: T[], delay?: number) => void;
  makeItem: (text: string) => T;
  placeholder?: string;
  renderExtra?: (item: T) => ReactNode;
}) {
  const [draft, setDraft] = useState("");
  const addRef = useRef<HTMLInputElement>(null);
  const listRef = useEnter<HTMLUListElement>();
  const update = (id: string, patch: Partial<T>, delay?: number) =>
    onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)), delay);

  return (
    <ul ref={listRef} className="mi-check">
      {items.map((it) => (
        <li key={it.id} className={`mi-check__row${it.done ? " mi-check__row--done" : ""}`} data-enter>
          <input
            type="checkbox"
            className="mi-checkbox"
            checked={it.done}
            aria-label={`Mark "${it.text || "item"}" ${it.done ? "not done" : "done"}`}
            onChange={() => update(it.id, { done: !it.done } as Partial<T>, 150)}
          />
          <input
            className="mi-check__text"
            value={it.text}
            placeholder="Untitled"
            onChange={(e) => update(it.id, { text: e.target.value } as Partial<T>)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addRef.current?.focus();
              if (e.key === "Backspace" && it.text === "") {
                e.preventDefault();
                onChange(items.filter((x) => x.id !== it.id), 150);
                addRef.current?.focus();
              }
            }}
          />
          {renderExtra?.(it)}
          <button
            type="button"
            className="icon-btn icon-btn--danger mi-check__del"
            aria-label={`Delete "${it.text || "item"}"`}
            onClick={() => onChange(items.filter((x) => x.id !== it.id), 150)}
          >
            <Icon name="x" />
          </button>
        </li>
      ))}
      <li className="mi-check__row mi-check__row--add">
        <Icon name="plus" className="mi-check__plus" />
        <input
          ref={addRef}
          className="mi-check__text"
          value={draft}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !draft.trim()) return;
            onChange([...items, makeItem(draft.trim())], 150);
            setDraft("");
          }}
        />
      </li>
    </ul>
  );
}

/** One calendar item. Workouts open their checklist unless editWorkouts; everything else calls onEdit. */
export function EventRow({
  event,
  onToggle,
  onEdit,
  editWorkouts = false,
}: {
  event: PlannerEvent;
  onToggle: () => void;
  onEdit: () => void;
  editWorkouts?: boolean;
}) {
  const navigate = useNavigate();
  const open = () => (event.type === "workout" && !editWorkouts ? navigate(`/mainichi/workout/${event.id}`) : onEdit());
  const meta = eventMeta({ ...event, time: null });
  return (
    <div className={`mi-event mi-type--${event.type}${event.done ? " mi-event--done" : ""}`} data-enter>
      <button type="button" className="mi-event__body" onClick={open}>
        <span className="mi-event__kicker">
          <span>{TYPE_LABEL[event.type]}</span>
          {event.time && <span>{event.time}</span>}
          {event.done && <span>Done</span>}
        </span>
        <span className="mi-event__title">{event.title}</span>
        {meta && <span className="mi-event__meta">{meta}</span>}
      </button>
      <input
        type="checkbox"
        className="mi-checkbox"
        checked={event.done}
        aria-label={`Mark ${event.title} ${event.done ? "not done" : "done"}`}
        onChange={onToggle}
      />
      <Icon name="chevron" className="mi-event__go" />
    </div>
  );
}

const ICONS = {
  chevron: "M9 6l6 6-6 6",
  back: "M15 6l-6 6 6 6",
  check: "M5 12.5l4.5 4.5L19 7.5",
  file: "M7 3.5h6.5L18 8v12a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20V4a.5.5 0 0 1 .5-.5ZM13 3.5V8h5",
  x: "M6 6l12 12M18 6L6 18",
  plus: "M12 5v14M5 12h14",
  up: "M6 15l6-6 6 6",
  down: "M6 9l6 6 6-6",
  grip: "M4 9h16M4 15h16",
  copy: "M8.5 8.5h11v11h-11ZM15.5 8.5v-4h-11v11h4",
  trash: "M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z",
  logout: "M10 4.5H6.5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1H10M15 8l4 4-4 4M19 12H9",
  receipt: "M6 3.5h12v17l-3-2-3 2-3-2-3 2v-17ZM9 8.5h6M9 12.5h6",
  transfer: "M4 8h13l-3-3M20 16H7l3 3",
  dumbbell: "M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11",
  timer: "M12 8v4l2.5 1.5M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM9.5 2.5h5",
};

export function Icon({ name, className }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg className={`mi-icon ${className ?? ""}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

export function BackButton({ label = "Back" }: { label?: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" className="mi-back" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/mainichi"))}>
      <Icon name="back" /> {label}
    </button>
  );
}

/** Modal sheet docked to the right edge. Native <dialog>: Esc, focus trap and backdrop for free. */
export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const downOnBackdrop = useRef(false);
  // Play the exit animation, then unmount. ponytail: only the drawer's own close paths (X, Esc, backdrop) animate;
  // children calling onClose directly (delete, cancel) still close instantly.
  const [closing, setClosing] = useState(false);
  const close = () => setClosing(true);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`mi-drawer${closing ? " is-closing" : ""}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onAnimationEnd={(e) => closing && e.target === ref.current && onClose()}
      // Close only on a press that starts and ends on the backdrop, so drags out of the sheet don't dismiss it.
      onPointerDown={(e) => (downOnBackdrop.current = e.target === ref.current)}
      onClick={(e) => downOnBackdrop.current && e.target === ref.current && close()}
    >
      <div className="mi-drawer__head">
        <h2 className="mi-h2">{title}</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={close}>
          <Icon name="x" />
        </button>
      </div>
      <div className="mi-drawer__body">{children}</div>
    </dialog>
  );
}

/** Placeholder rows while a list loads, so an empty state doesn't flash before the data lands. */
export function Skeleton({ rows = 2, height = "3.5rem", className = "mi-list" }: { rows?: number; height?: string; className?: string }) {
  return (
    <div className={className} role="status" aria-live="polite">
      <span className="visually-hidden">Loading…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="mi-skel" style={{ height }} aria-hidden="true" />
      ))}
    </div>
  );
}

export function Progress({ done, total }: { done: number; total: number }) {
  return (
    <div className="mi-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
      <div className="mi-progress__fill" style={{ transform: `scaleX(${total ? done / total : 0})` }} />
    </div>
  );
}

/** Empty state with a small drawing in the sign-in art's style: a calendar sheet for free days, a receipt for no money moves. */
export function Empty({ art, children }: { art: "calendar" | "receipt"; children: ReactNode }) {
  return (
    <div className="mi-emptyart">
      <svg className="mi-spot" viewBox="0 0 120 92" aria-hidden="true">
        <path className="mi-spot__accent" d="M102 6l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />
        <path className="mi-spot__mint" d="M18 68l1.5 4.5 4.5 1.5-4.5 1.5-1.5 4.5-1.5-4.5-4.5-1.5 4.5-1.5z" />
        {art === "calendar" ? (
          <>
            <g className="mi-art__pop">
              <g transform="translate(28 14) rotate(-6)">
                <rect className="mi-spot__card" width="60" height="64" rx="12" />
                <path className="mi-spot__head" d="M0 12Q0 0 12 0H48Q60 0 60 12V18H0Z" />
                <rect className="mi-spot__ink" x="14" y="-4" width="6" height="10" rx="3" />
                <rect className="mi-spot__ink" x="40" y="-4" width="6" height="10" rx="3" />
                {[0, 1, 2].flatMap((r) =>
                  [0, 1, 2, 3].map((c) => (
                    <circle key={`${r}${c}`} className={r === 1 && c === 2 ? "mi-spot__accent" : "mi-spot__muted"} cx={12 + c * 12} cy={30 + r * 11} r={r === 1 && c === 2 ? 3.6 : 2.6} />
                  )),
                )}
              </g>
            </g>
            <g className="mi-art__pop" style={{ "--d": "180ms" } as CSSProperties}>
              <circle className="mi-spot__accent" cx="90" cy="64" r="13" />
              <circle className="mi-spot__ring" cx="90" cy="64" r="9" />
            </g>
          </>
        ) : (
          <>
            <g className="mi-art__pop">
              <g transform="translate(36 8) rotate(5)">
                <path className="mi-spot__card" d="M0 10Q0 0 10 0H36Q46 0 46 10V68l-5.75-5-5.75 5-5.75-5-5.75 5-5.75-5-5.75 5-5.75-5L0 68Z" />
                <rect className="mi-spot__ink" x="8" y="10" width="20" height="4" rx="2" />
                {[22, 30, 38].map((y, i) => (
                  <g key={y}>
                    <rect className="mi-spot__muted" x="8" y={y} width={[18, 14, 20][i]} height="3" rx="1.5" />
                    <rect className="mi-spot__muted" x="31" y={y} width="7" height="3" rx="1.5" />
                  </g>
                ))}
                <line className="mi-spot__rule" x1="8" y1="47" x2="38" y2="47" />
                <rect className="mi-spot__total" x="24" y="52" width="14" height="4" rx="2" />
              </g>
            </g>
            <g className="mi-art__pop" style={{ "--d": "180ms" } as CSSProperties}>
              <circle className="mi-spot__accent" cx="84" cy="70" r="13" />
              <circle className="mi-spot__ring" cx="84" cy="70" r="9" />
              <text className="mi-spot__coin" x="84" y="73" textAnchor="middle">Rp</text>
            </g>
          </>
        )}
      </svg>
      <p className="mi-empty">{children}</p>
    </div>
  );
}
