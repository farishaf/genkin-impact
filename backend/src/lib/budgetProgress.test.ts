import { describe, it, expect } from "vitest";
import { getPeriodWindow, getPreviousPeriodWindow, computeBudgetProgress } from "./budgetProgress.js";

describe("getPeriodWindow", () => {
  it("returns the first weekly window when asOf is within it", () => {
    const w = getPeriodWindow("weekly", "2026-08-03", new Date("2026-08-05T00:00:00.000Z"));
    expect(w.start.toISOString()).toBe("2026-08-03T00:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-08-10T00:00:00.000Z");
  });

  it("advances weekly windows until one contains asOf", () => {
    const w = getPeriodWindow("weekly", "2026-08-03", new Date("2026-08-25T00:00:00.000Z"));
    expect(w.start.toISOString()).toBe("2026-08-24T00:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-08-31T00:00:00.000Z");
  });

  it("advances monthly windows correctly", () => {
    const w = getPeriodWindow("monthly", "2026-01-15", new Date("2026-03-20T00:00:00.000Z"));
    expect(w.start.toISOString()).toBe("2026-03-15T00:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-04-15T00:00:00.000Z");
  });

  it("handles quarterly windows", () => {
    const w = getPeriodWindow("quarterly", "2026-01-01", new Date("2026-08-01T00:00:00.000Z"));
    expect(w.start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("handles yearly windows", () => {
    const w = getPeriodWindow("yearly", "2024-08-06", new Date("2026-08-06T00:00:00.000Z"));
    expect(w.start.toISOString()).toBe("2026-08-06T00:00:00.000Z");
    expect(w.end.toISOString()).toBe("2027-08-06T00:00:00.000Z");
  });

  it("is exclusive of the window end (boundary belongs to the next window)", () => {
    const w = getPeriodWindow("weekly", "2026-08-03", new Date("2026-08-10T00:00:00.000Z"));
    expect(w.start.toISOString()).toBe("2026-08-10T00:00:00.000Z");
  });
});

describe("getPreviousPeriodWindow", () => {
  it("returns null for the very first period", () => {
    const w = getPreviousPeriodWindow("weekly", "2026-08-03", new Date("2026-08-05T00:00:00.000Z"));
    expect(w).toBeNull();
  });

  it("returns the window immediately before the current one", () => {
    const w = getPreviousPeriodWindow("weekly", "2026-08-03", new Date("2026-08-12T00:00:00.000Z"));
    expect(w?.start.toISOString()).toBe("2026-08-03T00:00:00.000Z");
    expect(w?.end.toISOString()).toBe("2026-08-10T00:00:00.000Z");
  });
});

describe("computeBudgetProgress", () => {
  it("computes remaining and pct under budget", () => {
    const p = computeBudgetProgress(10000n, 2500n);
    expect(p.remainingMinor).toBe(7500n);
    expect(p.pct).toBe(25);
  });

  it("allows pct over 100 when overspent", () => {
    const p = computeBudgetProgress(10000n, 15000n);
    expect(p.remainingMinor).toBe(-5000n);
    expect(p.pct).toBe(150);
  });

  it("returns pct 0 for a zero limit instead of dividing by zero", () => {
    const p = computeBudgetProgress(0n, 0n);
    expect(p.pct).toBe(0);
  });
});
