import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { formatAmount, formatMoney } from "../lib/formatAmount";
import { hueStyle } from "../lib/categoryHue";

gsap.registerPlugin(useGSAP);

export interface ReportChartGroup {
  id: string;
  label: string;
  total_minor: string;
  count: number;
}

interface ReportBarChartProps {
  groups: ReportChartGroup[];
  maxMinor: number;
  currencyCode: string;
  clickable: boolean;
  onSelect: (id: string) => void;
}

// Ranked horizontal bars: full labels stay readable in a narrow side panel (vertical bars truncated
// every category to two letters), and the share of total answers "how much of my spending is this?".
export function ReportBarChart({ groups, maxMinor, currencyCode, clickable, onSelect }: ReportBarChartProps) {
  const scope = useRef<HTMLOListElement>(null);
  const ranked = [...groups].sort((a, b) => Number(b.total_minor) - Number(a.total_minor));
  const grandTotal = ranked.reduce((sum, g) => sum + Number(g.total_minor), 0);

  useGSAP(
    () => {
      if (ranked.length === 0) return;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      gsap.from(".rank-row__bar i", {
        scaleX: 0,
        transformOrigin: "left center",
        duration: reduced ? 0 : 0.7,
        stagger: reduced ? 0 : 0.04,
        ease: "expo.out",
      });
    },
    { dependencies: [ranked.map((g) => g.id).join(","), currencyCode], scope }
  );

  if (ranked.length === 0) return null;

  return (
    <ol className="rank-list" ref={scope}>
      {ranked.map((g) => {
        const pct = maxMinor > 0 ? (Number(g.total_minor) / maxMinor) * 100 : 0;
        const share = grandTotal > 0 ? Math.round((Number(g.total_minor) / grandTotal) * 100) : 0;
        const title = `${g.label}: ${formatMoney(g.total_minor, currencyCode)} · ${g.count} entries`;
        const body = (
          <>
            <span className="rank-row__label">
              {g.label}
              <span className="rank-row__share mono">{share}%</span>
            </span>
            <span className="rank-row__value num">{formatAmount(g.total_minor, currencyCode)}</span>
            <span className="rank-row__bar" aria-hidden="true">
              <i style={{ width: `${Math.max(pct, 1.5)}%`, ...hueStyle(g.label) }} />
            </span>
          </>
        );
        return (
          <li key={g.id}>
            {clickable ? (
              <button type="button" className="rank-row" title={`${title} — tap to filter`} onClick={() => onSelect(g.id)}>
                {body}
              </button>
            ) : (
              <div className="rank-row rank-row--static" title={title}>
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
