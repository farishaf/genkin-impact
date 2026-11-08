import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Mirrors --ease-out / --dur-short in tokens.css.
export const ENTER = { duration: 0.22, ease: "expo.out" } as const;

/**
 * Rises in `[data-enter]` elements that mount inside the returned ref after its first render:
 * a new exercise, set, to-do or movement, or a panel that expands. Removals stay instant.
 */
export function useEnter<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const seen = useRef<WeakSet<Element>>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const first = !seen.current;
    const known = (seen.current ??= new WeakSet());
    const fresh = [...root.querySelectorAll("[data-enter]")].filter((el) => !known.has(el));
    fresh.forEach((el) => known.add(el));
    // A new round brings its own new movements: animate the outermost only.
    const tops = fresh.filter((el) => !fresh.some((p) => p !== el && p.contains(el)));
    // ponytail: more than 3 at once reads as a data load, not a user add, so it lands without a reveal.
    if (first || tops.length === 0 || tops.length > 3 || reducedMotion()) return;
    gsap.from(tops, { autoAlpha: 0, y: 8, ...ENTER, clearProps: "opacity,visibility,transform" });
  });
  return ref;
}
