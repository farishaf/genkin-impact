import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { formatAmount } from "../lib/formatAmount";

gsap.registerPlugin(useGSAP);

export interface AnalyticsDay {
  date: string;
  income_minor: string;
  expenditure_minor: string;
  net_minor: string;
  sign: "gain" | "loss" | "neutral";
  bucket: "none" | "low" | "medium" | "high";
}

export function HeatmapCalendar({
  days,
  selectedDate,
  onSelectDay,
  currencyCode,
}: {
  days: AnalyticsDay[];
  selectedDate: string | null;
  onSelectDay: (date: string) => void;
  currencyCode: string;
}) {
  const gridRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      gsap.from(".heat-cell", {
        opacity: 0,
        scale: 0.6,
        duration: reduced ? 0 : 0.35,
        stagger: reduced ? 0 : 0.008,
        ease: "power2.out",
      });
    },
    { dependencies: [days], scope: gridRef }
  );

  const leadingBlanks = days.length > 0 ? new Date(`${days[0].date}T00:00:00.000Z`).getUTCDay() : 0;

  return (
    <div ref={gridRef} className="heat-grid">
      {Array.from({ length: leadingBlanks }).map((_, i) => (
        <span key={`blank-${i}`} aria-hidden="true" />
      ))}
      {days.map((day) => (
        <button
          key={day.date}
          type="button"
          className={`heat-cell${selectedDate === day.date ? " heat-cell--selected" : ""}`}
          data-sign={day.sign}
          data-bucket={day.bucket}
          title={`${day.date}: ${day.sign === "neutral" ? "no activity" : `${day.sign === "gain" ? "+" : ""}${formatAmount(day.net_minor, currencyCode)}`}`}
          onClick={() => onSelectDay(day.date)}
        >
          {Number(day.date.slice(-2))}
        </button>
      ))}
    </div>
  );
}
