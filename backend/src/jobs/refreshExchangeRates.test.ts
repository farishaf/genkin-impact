import { describe, it, expect, vi } from "vitest";
import { refreshExchangeRatesTick } from "./refreshExchangeRates.js";

function stubDb(currencyRows: { code: string }[]) {
  return { query: vi.fn().mockResolvedValue({ rows: currencyRows }) };
}

function stubFetch(body: unknown, ok = true) {
  return vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => body });
}

describe("refreshExchangeRatesTick", () => {
  it("upserts a rate for every tracked non-USD currency the provider returns", async () => {
    const db = stubDb([{ code: "CNY" }, { code: "EUR" }]);
    const fetchImpl = stubFetch({ result: "success", rates: { CNY: 7.2, EUR: 0.91, GBP: 0.79 } });

    const updated = await refreshExchangeRatesTick(db, fetchImpl, new Date("2026-08-09T00:00:00Z"));

    expect(updated).toBe(2);
    // First call is the currency lookup; the two upserts follow.
    expect(db.query).toHaveBeenCalledTimes(3);
    const [, cnyCall, eurCall] = db.query.mock.calls;
    expect(cnyCall[0]).toMatch(/INSERT INTO exchange_rates/);
    expect(cnyCall[1]).toEqual(expect.arrayContaining(["CNY", "2026-08-09", 7.2]));
    expect(eurCall[1]).toEqual(expect.arrayContaining(["EUR", "2026-08-09", 0.91]));
  });

  it("skips a tracked currency the provider didn't return", async () => {
    const db = stubDb([{ code: "CNY" }, { code: "IDR" }]);
    const fetchImpl = stubFetch({ result: "success", rates: { CNY: 7.2 } });

    const updated = await refreshExchangeRatesTick(db, fetchImpl, new Date("2026-08-09T00:00:00Z"));

    expect(updated).toBe(1);
  });

  it("returns 0 without calling fetch when there are no tracked currencies", async () => {
    const db = stubDb([]);
    const fetchImpl = stubFetch({ result: "success", rates: {} });

    const updated = await refreshExchangeRatesTick(db, fetchImpl);

    expect(updated).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws when the HTTP response is not ok", async () => {
    const db = stubDb([{ code: "CNY" }]);
    const fetchImpl = stubFetch({}, false);

    await expect(refreshExchangeRatesTick(db, fetchImpl)).rejects.toThrow(/exchange rate fetch failed/);
  });

  it("throws when the provider reports a non-success result", async () => {
    const db = stubDb([{ code: "CNY" }]);
    const fetchImpl = stubFetch({ result: "error", rates: {} });

    await expect(refreshExchangeRatesTick(db, fetchImpl)).rejects.toThrow(/non-success result/);
  });
});
