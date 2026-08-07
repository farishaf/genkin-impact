import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { formatAmount, formatMoney } from "../lib/formatAmount";

gsap.registerPlugin(useGSAP);

const TICKS = [1, 0.75, 0.5, 0.25, 0];

export interface ReportChartGroup {
  id: string;
  label: string;
  total_minor: string;
  count: number;
}

// Vertical bar chart for report group totals — bars + a y-axis value scale,
// in place of a per-bar amount label (kept in the title attribute instead,
// mirrors Genkin-Impact.dc.html's report chart language).
export function ReportBarChart({
  groups,
  maxMinor,
  currencyCode,
  clickable,
  onSelect,
}: {
  groups: ReportChartGroup[];
  maxMinor: number;
  currencyCode: string;
  clickable: boolean;
  onSelect: (id: string) => void;
}) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (groups.length === 0) return;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      gsap.from(".chart-bar", {
        scaleY: 0,
        transformOrigin: "bottom",
        duration: reduced ? 0 : 0.5,
        stagger: reduced ? 0 : 0.04,
        ease: "power2.out",
      });
    },
    { dependencies: [groups.map((g) => g.id).join(","), currencyCode], scope }
  );

  if (groups.length === 0) return null;

  return (
    <div className="chart-wrap" ref={scope}>
      <div className="chart-axis">
        {TICKS.map((t) => (
          <span key={t}>{formatAmount(Math.round(maxMinor * t).toString(), currencyCode)}</span>
        ))}
      </div>
      <div className="chart-bars">
        {groups.map((g) => {
          const pct = maxMinor > 0 ? (Number(g.total_minor) / maxMinor) * 100 : 0;
          const title = `${g.label}: ${formatMoney(g.total_minor, currencyCode)}`;
          const bar = <span className="chart-bar" style={{ height: `${pct}%` }} />;
          return clickable ? (
            <button key={g.id} type="button" className="chart-col" title={title} onClick={() => onSelect(g.id)}>
              {bar}
              <span className="chart-col__label">{g.label}</span>
            </button>
          ) : (
            <div key={g.id} className="chart-col chart-col--static" title={title}>
              {bar}
              <span className="chart-col__label">{g.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
