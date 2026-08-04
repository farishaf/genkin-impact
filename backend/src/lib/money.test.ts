import { describe, it, expect } from "vitest";
import { formatMinor, parseToMinor } from "./money.js";

describe("formatMinor", () => {
  it("formats 2-decimal currencies", () => {
    expect(formatMinor(6800n, 2, "¥")).toBe("¥68.00");
    expect(formatMinor(123456n, 2, "$")).toBe("$1,234.56");
  });

  it("formats 0-decimal currencies (JPY)", () => {
    expect(formatMinor(15000n, 0, "¥")).toBe("¥15,000");
  });

  it("formats negative amounts with a leading minus before the symbol", () => {
    expect(formatMinor(-6800n, 2, "¥")).toBe("-¥68.00");
  });
});

describe("parseToMinor", () => {
  it("parses whole numbers", () => {
    expect(parseToMinor("68", 2)).toBe(6800n);
  });

  it("parses decimals and pads short fractions", () => {
    expect(parseToMinor("68.5", 2)).toBe(6850n);
    expect(parseToMinor("68.50", 2)).toBe(6850n);
  });

  it("parses 0-decimal currencies", () => {
    expect(parseToMinor("15000", 0)).toBe(15000n);
  });

  it("rejects non-numeric input", () => {
    expect(() => parseToMinor("abc", 2)).toThrow();
    expect(() => parseToMinor("-5", 2)).toThrow();
  });
});
