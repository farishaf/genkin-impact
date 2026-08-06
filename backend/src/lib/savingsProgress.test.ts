import { describe, it, expect } from "vitest";
import { computeSavingsProgress } from "./savingsProgress.js";

describe("computeSavingsProgress", () => {
  it("uses contributed_amount for manual (unlinked) goals", () => {
    const p = computeSavingsProgress({ targetMinor: 100000n, linkedToAccount: false, contributedMinor: 25000n });
    expect(p.progressMinor).toBe(25000n);
    expect(p.pct).toBe(25);
    expect(p.achieved).toBe(false);
  });

  it("derives progress from account balance minus opening balance when linked", () => {
    const p = computeSavingsProgress({
      targetMinor: 100000n,
      linkedToAccount: true,
      contributedMinor: 0n,
      accountBalanceMinor: 130000n,
      accountOpeningBalanceMinor: 100000n,
    });
    expect(p.progressMinor).toBe(30000n);
    expect(p.pct).toBe(30);
  });

  it("clamps linked progress at zero if the account balance dropped below opening", () => {
    const p = computeSavingsProgress({
      targetMinor: 100000n,
      linkedToAccount: true,
      contributedMinor: 0n,
      accountBalanceMinor: 80000n,
      accountOpeningBalanceMinor: 100000n,
    });
    expect(p.progressMinor).toBe(0n);
  });

  it("marks achieved when progress reaches target, and caps displayed pct at 100", () => {
    const p = computeSavingsProgress({ targetMinor: 100000n, linkedToAccount: false, contributedMinor: 150000n });
    expect(p.achieved).toBe(true);
    expect(p.pct).toBe(100);
  });

  it("returns pct 0 for a zero target instead of dividing by zero", () => {
    const p = computeSavingsProgress({ targetMinor: 0n, linkedToAccount: false, contributedMinor: 0n });
    expect(p.pct).toBe(0);
  });
});
