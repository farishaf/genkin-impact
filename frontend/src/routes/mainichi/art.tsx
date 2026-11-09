import type { ReactNode } from "react";
import type { RunType } from "../../lib/planner";

// Tile drawings in the sign-in art's style: a tinted tile, flat shapes in the type's colour, a pear sparkle.
// Each run type draws its own effort profile, so a list of runs reads at a glance. Colours live in mainichi.css (.mi-kart--*).

function Tile({ kind, children }: { kind: string; children: ReactNode }) {
  return (
    <svg className={`mi-kart mi-kart--${kind}`} viewBox="0 0 64 64" aria-hidden="true">
      <rect className="mi-kart__bg" width="64" height="64" rx="18" />
      {children}
      <path className="mi-kart__spark" d="M53 7l1.6 4.4 4.4 1.6-4.4 1.6L53 19l-1.6-4.4L47 13l4.4-1.6z" />
    </svg>
  );
}

const RUN_SHAPES: Record<RunType, ReactNode> = {
  // Easy: a soft rolling line under a low sun.
  easy: (
    <>
      <circle className="mi-kart__sun" cx="22" cy="24" r="7" />
      <path className="mi-kart__line" d="M9 42c7-6 12-6 18 0s11 6 18 0 7-4 10-2" />
    </>
  ),
  // Long: a winding road to a far flag.
  long: (
    <>
      <path className="mi-kart__line mi-kart__line--wide" d="M54 54c-14 0-6-16-20-16s-8-14-18-14" />
      <path className="mi-kart__ink-line" d="M14 24V10" />
      <path className="mi-kart__sun" d="M14 10l10 3.5-10 3.5z" />
    </>
  ),
  // Tempo: warm up, hold one long plateau, cool down.
  tempo: (
    <>
      <path className="mi-kart__fill" d="M8 50v-6h5c2-18 4-22 8-22h22c4 0 6 4 8 22h5v6z" />
      <path className="mi-kart__base" d="M8 50h48" />
    </>
  ),
  // Intervals: hard spikes with short rests between.
  intervals: (
    <>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect key={i} className={i % 2 ? "mi-kart__soft" : "mi-kart__fill"} x={9 + i * 8} y={i % 2 ? 42 : 22} width="6" height={i % 2 ? 8 : 28} rx="3" />
      ))}
      <path className="mi-kart__base" d="M8 50h48" />
    </>
  ),
  // Hills: two slopes, an arrow up the big one.
  hills: (
    <>
      <path className="mi-kart__soft" d="M30 50l12-16 14 16z" />
      <path className="mi-kart__fill" d="M6 50l18-26 16 26z" />
      <path className="mi-kart__ink-line" d="M15 42l7-9m0 0h-5m5 0v5" />
    </>
  ),
  // Threshold: three steady blocks right on the dashed line.
  threshold: (
    <>
      {[0, 1, 2].map((i) => <rect key={i} className="mi-kart__fill" x={9 + i * 16} y="28" width="12" height="22" rx="4" />)}
      <path className="mi-kart__dash" d="M6 28h52" />
      <path className="mi-kart__base" d="M8 50h48" />
    </>
  ),
};

export const RunArt = ({ type }: { type: RunType }) => <Tile kind={type}>{RUN_SHAPES[type]}</Tile>;

/** A dumbbell. */
export const WorkoutArt = () => (
  <Tile kind="workout">
    <rect className="mi-kart__ink" x="14" y="30" width="36" height="5" rx="2.5" />
    <rect className="mi-kart__fill" x="9" y="20" width="8" height="25" rx="4" />
    <rect className="mi-kart__fill" x="47" y="20" width="8" height="25" rx="4" />
    <rect className="mi-kart__soft" x="17" y="25" width="5" height="15" rx="2.5" />
    <rect className="mi-kart__soft" x="42" y="25" width="5" height="15" rx="2.5" />
  </Tile>
);

/** A calendar sheet with one day marked. */
export const EventArt = () => (
  <Tile kind="event">
    <rect className="mi-kart__card" x="13" y="16" width="38" height="36" rx="8" />
    <path className="mi-kart__fill" d="M13 24a8 8 0 0 1 8-8h22a8 8 0 0 1 8 8v4H13z" />
    <rect className="mi-kart__ink" x="21" y="12" width="4" height="8" rx="2" />
    <rect className="mi-kart__ink" x="39" y="12" width="4" height="8" rx="2" />
    {[0, 1, 2, 3].map((c) => <circle key={c} className="mi-kart__dot" cx={20 + c * 8} cy="36" r="2" />)}
    {[0, 1, 2, 3].map((c) => <circle key={c} className={c === 2 ? "mi-kart__sun" : "mi-kart__dot"} cx={20 + c * 8} cy="44" r={c === 2 ? 3.4 : 2} />)}
  </Tile>
);
