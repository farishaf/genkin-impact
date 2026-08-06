import { useRef, useMemo } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import type { AnalyticsDay } from "./HeatmapCalendar";

gsap.registerPlugin(useGSAP);

const W = 600;
const H = 120;

/** Diverging area chart: gain (red) fills above the zero line, loss (green) fills below it. */
export function TrendChart({ days }: { days: AnalyticsDay[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const lineRef = useRef<SVGPathElement>(null);
  const uid = useRef(`trend-${Math.random().toString(36).slice(2)}`).current;

  const { linePath, areaPath, midY } = useMemo(() => {
    const nets = days.map((d) => Number(d.net_minor));
    const maxAbs = Math.max(1, ...nets.map((n) => Math.abs(n)));
    const mid = H / 2;
    const usable = mid - 8;

    const points = days.map((_, i) => {
      const x = days.length > 1 ? (i / (days.length - 1)) * W : 0;
      const y = mid - (nets[i] / maxAbs) * usable;
      return [x, y] as const;
    });

    const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const area = points.length > 0 ? `${line} L${W},${mid} L0,${mid} Z` : "";

    return { linePath: line, areaPath: area, midY: mid };
  }, [days]);

  useGSAP(
    () => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const path = lineRef.current;
      if (!path) return;
      const length = path.getTotalLength();
      gsap.fromTo(
        path,
        { strokeDasharray: length, strokeDashoffset: length },
        { strokeDashoffset: 0, duration: reduced ? 0 : 0.9, ease: "power2.out" }
      );
      gsap.from(".trend-fill", { opacity: 0, duration: reduced ? 0 : 0.6, delay: reduced ? 0 : 0.2 });
    },
    { dependencies: [linePath], scope: svgRef }
  );

  return (
    <svg ref={svgRef} className="trend-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <clipPath id={`${uid}-gain`}>
          <rect x="0" y="0" width={W} height={midY} />
        </clipPath>
        <clipPath id={`${uid}-loss`}>
          <rect x="0" y={midY} width={W} height={H - midY} />
        </clipPath>
      </defs>
      <line x1="0" y1={midY} x2={W} y2={midY} stroke="var(--color-rule)" strokeWidth="1" />
      {areaPath && (
        <>
          <path className="trend-fill" d={areaPath} fill="var(--color-gain)" fillOpacity="0.18" clipPath={`url(#${uid}-gain)`} />
          <path className="trend-fill" d={areaPath} fill="var(--color-loss)" fillOpacity="0.18" clipPath={`url(#${uid}-loss)`} />
          <path ref={lineRef} d={linePath} fill="none" stroke="var(--color-ink-2)" strokeWidth="2" />
        </>
      )}
    </svg>
  );
}
