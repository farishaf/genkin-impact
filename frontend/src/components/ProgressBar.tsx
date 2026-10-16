import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

/**
 * Status tones, deliberately independent of the gain/loss colour convention: a budget at 30%
 * is healthy whatever colour the user picked for a good month.
 */
export type ProgressTone = "ok" | "warn" | "danger" | "neutral";

export function ProgressBar({ pct, tone = "neutral" }: { pct: number; tone?: ProgressTone }) {
  const fillRef = useRef<HTMLDivElement>(null);
  const clamped = Math.max(0, Math.min(100, pct));

  useGSAP(
    () => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      gsap.to(fillRef.current, {
        scaleX: clamped / 100,
        duration: reduced ? 0 : 0.9,
        ease: "expo.out",
      });
    },
    { dependencies: [clamped], scope: fillRef }
  );

  return (
    <div className="progress-track" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div ref={fillRef} className={`progress-fill progress-fill--${tone}`} />
    </div>
  );
}
