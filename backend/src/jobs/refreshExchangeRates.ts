import { pool } from "../db/pool.js";
import { newId } from "../lib/ids.js";
import type { Queryable } from "../lib/fx.js";

const FX_API_URL = "https://open.er-api.com/v6/latest/USD";

interface FxApiResponse {
  result: string;
  rates: Record<string, number>;
}

/**
 * Fetches today's USD-base rates and upserts them into exchange_rates, per data model §8:
 * "Fetch daily via a scheduled job; backfill on miss." The read-time fallback to the most
 * recent prior rate (fx.ts's getRateToUSD) already covers the "backfill on miss" half —
 * this job only needs to keep "today" fresh.
 */
export async function refreshExchangeRatesTick(
  db: Queryable = pool,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date()
): Promise<number> {
  const currenciesRes = await db.query("SELECT code FROM currencies WHERE is_active = true AND code != 'USD'", []);
  const trackedCodes: string[] = currenciesRes.rows.map((r) => r.code);
  if (trackedCodes.length === 0) return 0;

  const res = await fetchImpl(FX_API_URL);
  if (!res.ok) throw new Error(`exchange rate fetch failed: ${res.status}`);
  const body = (await res.json()) as FxApiResponse;
  if (body.result !== "success") throw new Error("exchange rate provider returned a non-success result");

  const today = now.toISOString().slice(0, 10);
  let updated = 0;
  for (const code of trackedCodes) {
    const rate = body.rates[code];
    if (typeof rate !== "number") continue;
    await db.query(
      `INSERT INTO exchange_rates (id, base_code, quote_code, rate_date, rate, source)
       VALUES ($1, 'USD', $2, $3, $4, 'open.er-api.com')
       ON CONFLICT (base_code, quote_code, rate_date) DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source`,
      [newId(), code, today, rate]
    );
    updated++;
  }
  return updated;
}
