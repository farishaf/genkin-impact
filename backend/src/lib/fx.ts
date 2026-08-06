export interface Queryable {
  query: (sql: string, params: unknown[]) => Promise<{ rows: any[] }>;
}

export async function getRateToUSD(
  db: Queryable,
  currency: string,
  onDate: string
): Promise<{ rate: number; approximate: boolean }> {
  if (currency === "USD") return { rate: 1, approximate: false };

  const exact = await db.query(
    `SELECT rate FROM exchange_rates WHERE base_code = 'USD' AND quote_code = $1 AND rate_date = $2`,
    [currency, onDate]
  );
  if (exact.rows.length > 0) {
    return { rate: Number(exact.rows[0].rate), approximate: false };
  }

  const prior = await db.query(
    `SELECT rate FROM exchange_rates WHERE base_code = 'USD' AND quote_code = $1 AND rate_date <= $2 ORDER BY rate_date DESC LIMIT 1`,
    [currency, onDate]
  );
  if (prior.rows.length > 0) {
    return { rate: Number(prior.rows[0].rate), approximate: true };
  }

  throw new Error(`no exchange rate available for ${currency} on or before ${onDate}`);
}

/**
 * Converts a minor-units amount between currencies via USD as pivot, per §8 FX rules.
 * decimalsByCode must include entries for both fromCurrency and toCurrency.
 */
export async function convert(
  db: Queryable,
  amountMinor: bigint,
  fromCurrency: string,
  toCurrency: string,
  onDate: string,
  decimalsByCode: Record<string, number>
): Promise<{ amountMinor: bigint; approximate: boolean }> {
  if (fromCurrency === toCurrency) return { amountMinor, approximate: false };

  const [fromRate, toRate] = await Promise.all([
    getRateToUSD(db, fromCurrency, onDate),
    getRateToUSD(db, toCurrency, onDate),
  ]);

  const fromMajor = Number(amountMinor) / 10 ** decimalsByCode[fromCurrency];
  const usdMajor = fromMajor / fromRate.rate;
  const toMajor = usdMajor * toRate.rate;
  const toMinor = BigInt(Math.round(toMajor * 10 ** decimalsByCode[toCurrency]));

  return { amountMinor: toMinor, approximate: fromRate.approximate || toRate.approximate };
}
