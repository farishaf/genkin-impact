// Mirrors backend/migrations/0001_currencies_users_sessions.sql's seeded decimal_digits.
// A later slice can fetch this from GET /currencies instead of hardcoding it here.
const DECIMAL_DIGITS: Record<string, number> = { CNY: 2, USD: 2, EUR: 2, JPY: 0, GBP: 2, HKD: 2, IDR: 0 };

export function formatAmount(minorUnits: string, currencyCode: string): string {
  const digits = DECIMAL_DIGITS[currencyCode] ?? 2;
  const value = Number(minorUnits) / 10 ** digits;
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// Amount with its currency code appended, for any place a bare number would
// be ambiguous across a user's multiple account currencies.
export function formatMoney(minorUnits: string, currencyCode: string): string {
  return `${formatAmount(minorUnits, currencyCode)} ${currencyCode}`;
}

// Plain decimal string (no thousands separators) for prefilling an editable amount input.
export function minorToInputValue(minorUnits: string, currencyCode: string): string {
  const digits = DECIMAL_DIGITS[currencyCode] ?? 2;
  return (Number(minorUnits) / 10 ** digits).toFixed(digits);
}
