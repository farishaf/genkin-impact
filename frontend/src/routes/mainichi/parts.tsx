import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
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
  const update = (id: string, patch: Partial<T>, delay?: number) =>
    onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)), delay);

  return (
    <ul className="mi-check">
      {items.map((it) => (
        <li key={it.id} className={`mi-check__row${it.done ? " mi-check__row--done" : ""}`}>
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
    <div className={`mi-event mi-type--${event.type}${event.done ? " mi-event--done" : ""}`}>
      <button type="button" className="mi-event__body" onClick={open}>
        <span className="mi-event__kicker">
          {TYPE_LABEL[event.type]}
          {event.time ? ` · ${event.time}` : ""}
          {event.done ? " · Done" : ""}
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
  trash: "M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5",
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
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="mi-drawer"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // Close only on a press that starts and ends on the backdrop, so drags out of the sheet don't dismiss it.
      onPointerDown={(e) => (downOnBackdrop.current = e.target === ref.current)}
      onClick={(e) => downOnBackdrop.current && e.target === ref.current && onClose()}
    >
      <div className="mi-drawer__head">
        <h2 className="mi-h2">{title}</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <div className="mi-drawer__body">{children}</div>
    </dialog>
  );
}

export function Progress({ done, total }: { done: number; total: number }) {
  return (
    <div className="mi-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
      <div className="mi-progress__fill" style={{ width: total ? `${(done / total) * 100}%` : 0 }} />
    </div>
  );
}
