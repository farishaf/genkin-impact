import { describe, it, expect } from "vitest";
import { advanceNextRun, isPastEnd } from "./recurring.js";

describe("advanceNextRun", () => {
  it("advances daily by intervalCount days", () => {
    const next = advanceNextRun(new Date("2026-08-06T00:00:00.000Z"), { frequency: "daily", intervalCount: 2 });
    expect(next.toISOString()).toBe("2026-08-08T00:00:00.000Z");
  });

  it("advances weekly by 7 * intervalCount days", () => {
    const next = advanceNextRun(new Date("2026-08-06T00:00:00.000Z"), { frequency: "weekly", intervalCount: 1 });
    expect(next.toISOString()).toBe("2026-08-13T00:00:00.000Z");
  });

  it("advances monthly and clamps day_of_month to a shorter month (Jan 31 -> Feb 28)", () => {
    const next = advanceNextRun(new Date("2026-01-31T00:00:00.000Z"), { frequency: "monthly", intervalCount: 1, dayOfMonth: 31 });
    expect(next.toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });

  it("clamps to Feb 29 on a leap year", () => {
    const next = advanceNextRun(new Date("2028-01-31T00:00:00.000Z"), { frequency: "monthly", intervalCount: 1, dayOfMonth: 31 });
    expect(next.toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });

  it("advances yearly by intervalCount years", () => {
    const next = advanceNextRun(new Date("2026-08-06T00:00:00.000Z"), { frequency: "yearly", intervalCount: 1 });
    expect(next.toISOString()).toBe("2027-08-06T00:00:00.000Z");
  });
});

describe("isPastEnd", () => {
  it("is false when there is no ends_on", () => {
    expect(isPastEnd(new Date("2026-08-06T00:00:00.000Z"), null)).toBe(false);
  });

  it("is false on the ends_on day itself", () => {
    expect(isPastEnd(new Date("2026-08-06T00:00:00.000Z"), "2026-08-06")).toBe(false);
  });

  it("is true the day after ends_on", () => {
    expect(isPastEnd(new Date("2026-08-07T00:00:00.000Z"), "2026-08-06")).toBe(true);
  });
});
