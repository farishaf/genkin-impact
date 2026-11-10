import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { addDays, fromKey, isValidKey, toKey, todayKey, weekStart } from "../lib/planner";

const DOW = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const label = (k: string) => fromKey(k).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * Date field with a month-grid popover. Values are local "YYYY-MM-DD" strings, "" for no date, like <input type="date">.
 * Controlled with `value`, or uncontrolled with `defaultValue` + `name` (a hidden input carries it into FormData).
 */
export function DatePicker({
  value,
  defaultValue = "",
  onChange,
  name,
  min,
  max,
  required,
  placeholder = "Pick a date",
  className,
  "aria-label": ariaLabel,
}: {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  name?: string;
  min?: string;
  max?: string;
  required?: boolean;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const [inner, setInner] = useState(defaultValue);
  const current = value ?? inner;
  const [open, setOpen] = useState(false);
  // The day the arrow keys move between; its month is the one shown.
  const [cursor, setCursor] = useState(isValidKey(current) ? current : todayKey());
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !rootRef.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  // Keep keyboard focus on the cursor day while the grid is open.
  useEffect(() => {
    if (open) gridRef.current?.querySelector<HTMLButtonElement>(`[data-key="${cursor}"]`)?.focus();
  }, [open, cursor]);

  const outOfRange = (k: string) => (!!min && k < min) || (!!max && k > max);
  const focusButton = () => rootRef.current?.querySelector<HTMLButtonElement>(".dp__btn")?.focus();
  const pick = (k: string) => {
    if (k && outOfRange(k)) return;
    setInner(k);
    onChange?.(k);
    setOpen(false);
    focusButton();
  };
  const toggle = () => {
    if (!open) setCursor(isValidKey(current) ? current : todayKey());
    setOpen(!open);
  };

  const c = fromKey(cursor);
  const monthStart = new Date(c.getFullYear(), c.getMonth(), 1);
  const days = Array.from({ length: 42 }, (_, i) => toKey(addDays(weekStart(monthStart), i)));
  const shiftMonth = (n: number) => {
    const first = new Date(c.getFullYear(), c.getMonth() + n, 1);
    const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    // Keep the day of month where the target month has it (31 Jan → 28 Feb).
    setCursor(toKey(new Date(first.getFullYear(), first.getMonth(), Math.min(c.getDate(), lastDay))));
  };

  function onGridKey(e: KeyboardEvent) {
    const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[e.key];
    if (step) {
      e.preventDefault();
      setCursor(toKey(addDays(c, step)));
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      shiftMonth(e.key === "PageUp" ? -1 : 1);
    }
  }

  return (
    <div
      ref={rootRef}
      className={`dp ${className ?? ""}`}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          // Stop here so an enclosing <dialog> doesn't close too.
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          focusButton();
        }
      }}
    >
      {name && <input type="hidden" name={name} value={current} />}
      <button
        type="button"
        className={`dp__btn${current ? "" : " dp__btn--empty"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel ? `${ariaLabel}: ${current ? label(current) : "none"}` : undefined}
        onClick={toggle}
      >
        <svg className="dp__icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 6.5h14v13H5zM5 10.5h14M9 4v4M15 4v4" />
        </svg>
        <span>{current ? label(current) : placeholder}</span>
      </button>
      {open && (
        // preventDefault keeps a click on the popover's blank space from re-activating an enclosing <label>.
        <div className="dp__pop" role="dialog" aria-label="Choose a date" onClick={(e) => e.preventDefault()}>
          <div className="dp__head">
            <button type="button" className="dp__nav" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
            </button>
            <span className="dp__month" aria-live="polite">{monthStart.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</span>
            <button type="button" className="dp__nav" aria-label="Next month" onClick={() => shiftMonth(1)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
            </button>
          </div>
          <div ref={gridRef} className="dp__grid" onKeyDown={onGridKey}>
            {DOW.map((d) => <span key={d} className="dp__dow" aria-hidden="true">{d}</span>)}
            {days.map((k) => {
              const d = fromKey(k);
              return (
                <button
                  key={k}
                  type="button"
                  data-key={k}
                  tabIndex={k === cursor ? 0 : -1}
                  disabled={outOfRange(k)}
                  aria-pressed={k === current}
                  aria-label={d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                  className={`dp__day${d.getMonth() !== monthStart.getMonth() ? " dp__day--out" : ""}${k === todayKey() ? " dp__day--today" : ""}`}
                  onClick={() => pick(k)}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
          <div className="dp__foot">
            <button type="button" className="dp__text" disabled={outOfRange(todayKey())} onClick={() => pick(todayKey())}>Today</button>
            {!required && current && <button type="button" className="dp__text" onClick={() => pick("")}>Clear</button>}
          </div>
        </div>
      )}
    </div>
  );
}
