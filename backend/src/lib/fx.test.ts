import { describe, it, expect, vi } from "vitest";
import { getRateToUSD, convert } from "./fx.js";

function stubPool(rows: Record<string, unknown>[]) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

describe("getRateToUSD", () => {
  it("returns rate 1 for USD without querying", async () => {
    const pool = stubPool([]);
    const result = await getRateToUSD(pool, "USD", "2026-08-04");
    expect(result).toEqual({ rate: 1, approximate: false });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("returns the exact rate when one exists for the date", async () => {
    const pool = stubPool([{ rate: "7.15" }]);
    const result = await getRateToUSD(pool, "CNY", "2026-08-04");
    expect(result).toEqual({ rate: 7.15, approximate: false });
  });

  it("falls back to the most recent prior rate and flags it approximate", async () => {
    const pool = { query: vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ rate: "7.10" }] }) };
    const result = await getRateToUSD(pool, "CNY", "2026-08-05");
    expect(result).toEqual({ rate: 7.1, approximate: true });
  });

  it("throws when no rate exists at all", async () => {
    const pool = stubPool([]);
    await expect(getRateToUSD(pool, "CNY", "2020-01-01")).rejects.toThrow();
  });
});

describe("convert", () => {
  const decimalsByCode = { USD: 2, CNY: 2, JPY: 0 };

  it("returns the same amount when currencies match", async () => {
    const pool = stubPool([]);
    const result = await convert(pool, 6800n, "USD", "USD", "2026-08-04", decimalsByCode);
    expect(result).toEqual({ amountMinor: 6800n, approximate: false });
  });

  it("converts between two 2-decimal currencies via USD", async () => {
    // $10.00 -> CNY at 7.15 -> ¥71.50 -> 7150 minor units
    const pool = { query: vi.fn().mockResolvedValueOnce({ rows: [{ rate: "7.15" }] }) };
    const result = await convert(pool, 1000n, "USD", "CNY", "2026-08-04", decimalsByCode);
    expect(result.amountMinor).toBe(7150n);
    expect(result.approximate).toBe(false);
  });

  it("converts correctly across differing decimal digits (USD -> JPY)", async () => {
    // $10.00 -> JPY at 149.5 -> ¥1495 -> 1495 minor units (0 decimals)
    const pool = { query: vi.fn().mockResolvedValueOnce({ rows: [{ rate: "149.5" }] }) };
    const result = await convert(pool, 1000n, "USD", "JPY", "2026-08-04", decimalsByCode);
    expect(result.amountMinor).toBe(1495n);
  });
});
