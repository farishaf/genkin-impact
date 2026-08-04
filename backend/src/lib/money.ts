export function formatMinor(amountMinor: bigint, decimalDigits: number, symbol: string): string {
  const negative = amountMinor < 0n;
  const abs = negative ? -amountMinor : amountMinor;
  const divisor = 10n ** BigInt(decimalDigits);
  const whole = abs / divisor;
  const fraction = abs % divisor;

  const wholeStr = whole.toLocaleString("en-US");
  const fractionStr = decimalDigits > 0 ? "." + fraction.toString().padStart(decimalDigits, "0") : "";

  return (negative ? "-" : "") + symbol + wholeStr + fractionStr;
}

export function parseToMinor(input: string, decimalDigits: number): bigint {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`invalid amount: ${input}`);
  }

  const [wholePart, fracPart = ""] = trimmed.split(".");
  const fracPadded = (fracPart + "0".repeat(decimalDigits)).slice(0, decimalDigits);

  return BigInt(wholePart) * 10n ** BigInt(decimalDigits) + (fracPadded ? BigInt(fracPadded) : 0n);
}
