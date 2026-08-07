import { useCallback, useSyncExternalStore } from "react";

// Display preferences that live only in the browser: no server round-trip, no user row.
// The matching pre-paint script is inlined in index.html — keep the two in sync.

export type Theme = "light" | "dark" | "system";
export type Convention = "eastern" | "western";

const THEME_KEY = "gi.theme";
const CONVENTION_KEY = "gi.convention";

const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit() {
  for (const fn of listeners) fn();
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private-mode or storage disabled: the dataset attribute below still applies for this session.
  }
}

function readTheme(): Theme {
  const v = read(THEME_KEY);
  return v === "light" || v === "dark" ? v : "system";
}

function readConvention(): Convention {
  return read(CONVENTION_KEY) === "western" ? "western" : "eastern";
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "system" as Theme);

  const setTheme = useCallback((next: Theme) => {
    write(THEME_KEY, next);
    if (next === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    emit();
  }, []);

  return { theme, setTheme };
}

export function useConvention() {
  const convention = useSyncExternalStore(subscribe, readConvention, () => "eastern" as Convention);

  const setConvention = useCallback((next: Convention) => {
    write(CONVENTION_KEY, next);
    document.documentElement.dataset.convention = next;
    emit();
  }, []);

  return { convention, setConvention };
}
