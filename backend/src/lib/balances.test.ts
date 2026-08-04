import { describe, it, expect } from "vitest";
import { computeBalance } from "./balances.js";

describe("computeBalance", () => {
  it("adds opening balance plus income minus expense plus transfers in minus transfers out", () => {
    const result = computeBalance({
      openingBalance: 10000n,
      incomeSum: 5000n,
      expenseSum: 2000n,
      transfersInSum: 1000n,
      transfersOutSum: 500n,
    });
    // 10000 + 5000 - 2000 + 1000 - 500 = 13500
    expect(result).toBe(13500n);
  });

  it("handles an account with no activity", () => {
    const result = computeBalance({
      openingBalance: 10000n,
      incomeSum: 0n,
      expenseSum: 0n,
      transfersInSum: 0n,
      transfersOutSum: 0n,
    });
    expect(result).toBe(10000n);
  });

  it("can go negative (e.g. a liability or overspent credit card)", () => {
    const result = computeBalance({
      openingBalance: 0n,
      incomeSum: 0n,
      expenseSum: 500n,
      transfersInSum: 0n,
      transfersOutSum: 0n,
    });
    expect(result).toBe(-500n);
  });
});
