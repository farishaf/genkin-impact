// Mirrors backend/migrations/0001_currencies_users_sessions.sql + 0008_idr_currency.sql's
// seeded decimal_digits and symbol columns. A later slice can fetch this from GET /currencies
// instead of hardcoding it here.
const DECIMAL_DIGITS: Record<string, number> = { CNY: 2, USD: 2, EUR: 2, JPY: 0, GBP: 2, HKD: 2, IDR: 0 };
const CURRENCY_SYMBOLS: Record<string, string> = { CNY: "¥", USD: "$", EUR: "€", JPY: "¥", GBP: "£", HKD: "HK$", IDR: "Rp" };

export function formatAmount(minorUnits: string, currencyCode: string): string {
  const digits = DECIMAL_DIGITS[currencyCode] ?? 2;
  const value = Number(minorUnits) / 10 ** digits;
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function decimalDigits(currencyCode: string): number {
  return DECIMAL_DIGITS[currencyCode] ?? 2;
}

export function currencySymbol(currencyCode: string): string {
  return CURRENCY_SYMBOLS[currencyCode] ?? currencyCode;
}

// Amount prefixed with its currency's real symbol (e.g. "$25.00", "-¥68") — mirrors
// backend/src/lib/money.ts's formatMinor, so server- and client-formatted amounts read the same.
export function formatMoney(minorUnits: string, currencyCode: string): string {
  const negative = minorUnits.trim().startsWith("-");
  const abs = negative ? minorUnits.trim().slice(1) : minorUnits;
  return `${negative ? "-" : ""}${currencySymbol(currencyCode)}${formatAmount(abs, currencyCode)}`;
}

// Plain decimal string (no thousands separators) for prefilling an editable amount input.
export function minorToInputValue(minorUnits: string, currencyCode: string): string {
  const digits = DECIMAL_DIGITS[currencyCode] ?? 2;
  return (Number(minorUnits) / 10 ** digits).toFixed(digits);
}
