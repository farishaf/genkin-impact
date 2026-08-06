import { describe, it, expect } from "vitest";
import { signForNet, bucketForNet, monthRange, datesInRange } from "./analytics.js";

describe("signForNet", () => {
  it("gain when income exceeds expenditure", () => {
    expect(signForNet(500n)).toBe("gain");
  });

  it("loss when expenditure exceeds income", () => {
    expect(signForNet(-500n)).toBe("loss");
  });

  it("neutral when net is exactly zero", () => {
    expect(signForNet(0n)).toBe("neutral");
  });
});

describe("bucketForNet", () => {
  it("none for zero net", () => {
    expect(bucketForNet(0n, 1000n)).toBe("none");
  });

  it("none when the window max is zero", () => {
    expect(bucketForNet(0n, 0n)).toBe("none");
  });

  it("low for small magnitude relative to max", () => {
    expect(bucketForNet(100n, 1000n)).toBe("low");
  });

  it("medium for mid magnitude relative to max", () => {
    expect(bucketForNet(500n, 1000n)).toBe("medium");
  });

  it("high for large magnitude relative to max", () => {
    expect(bucketForNet(900n, 1000n)).toBe("high");
  });

  it("buckets by magnitude regardless of sign", () => {
    expect(bucketForNet(-900n, 1000n)).toBe("high");
  });
});

describe("monthRange", () => {
  it("returns the UTC [start, end) window for a month", () => {
    const r = monthRange("2026-08");
    expect(r.start.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("rolls over into the next year for December", () => {
    const r = monthRange("2026-12");
    expect(r.end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("datesInRange", () => {
  it("lists every date in a short range", () => {
    const dates = datesInRange(new Date("2026-08-01T00:00:00.000Z"), new Date("2026-08-04T00:00:00.000Z"));
    expect(dates).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
  });
});
