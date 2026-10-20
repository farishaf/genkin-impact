import { useSyncExternalStore } from "react";

/** Phone-sized screens; matches the breakpoint where Modal turns into a bottom sheet. */
export const MOBILE_QUERY = "(max-width: 60rem)";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}
