import { formatAmount } from "../lib/formatAmount";

export interface SummaryFigures {
  income_minor: string;
  expenditure_minor: string;
  balance_minor: string;
  count?: number;
  main_currency_code: string;
}

interface SummaryHeroProps {
  summary: SummaryFigures;
  /** Eyebrow context, e.g. "All time" or "September 2026". */
  rangeLabel: string;
}

/** Share of income that was kept, as a whole percent; null when nothing came in. */
function keptPercent(income: bigint, balance: bigint): number | null {
  if (income <= 0n) return null;
  return Number((balance * 100n) / income);
}

function keptMessage(kept: number | null, expenditure: bigint): string {
  if (kept === null) return expenditure > 0n ? "No money in yet for this range." : "Nothing logged for this range yet.";
  if (kept >= 0) return `You kept ${kept}% of what came in.`;
  return `You spent ${Math.abs(kept)}% more than came in.`;
}

/**
 * Wallet-style balance card: one big number, money in vs out as a single flow bar, and a
 * plain-language savings rate — the thing a spending-aware user actually wants to know.
 */
export function SummaryHero({ summary, rangeLabel }: SummaryHeroProps) {
  const code = summary.main_currency_code;
  const income = BigInt(summary.income_minor);
  const expenditure = BigInt(summary.expenditure_minor);
  const balance = BigInt(summary.balance_minor);
  const flowTotal = income + expenditure;
  const inShare = flowTotal > 0n ? Number((income * 1000n) / flowTotal) / 10 : 50;
  const kept = keptPercent(income, balance);

  return (
    <section className="hero-card" aria-label="Summary">
      <div className="hero-card__top">
        <span className="eyebrow eyebrow--accent">Net · {rangeLabel}</span>
        {summary.count !== undefined && <span className="eyebrow">{summary.count} entries</span>}
      </div>

      <div className="hero-card__figure num" data-negative={balance < 0n}>
        <span className="hero-card__cur">{code}</span>
        {formatAmount(summary.balance_minor, code)}
      </div>
      <p className="hero-card__note">{keptMessage(kept, expenditure)}</p>

      <div className="flow-bar" aria-hidden="true">
        <i data-tone="income" style={{ flexBasis: `${inShare}%` }} />
        <i data-tone="expense" style={{ flexBasis: `${100 - inShare}%` }} />
      </div>

      <div className="hero-card__split">
        <div className="split-stat">
          <span className="split-stat__label">
            <span className="dot" data-tone="income" aria-hidden="true" /> Money in
          </span>
          <span className="split-stat__value num">{formatAmount(summary.income_minor, code)}</span>
        </div>
        <div className="split-stat">
          <span className="split-stat__label">
            <span className="dot" data-tone="expense" aria-hidden="true" /> Money out
          </span>
          <span className="split-stat__value num">{formatAmount(summary.expenditure_minor, code)}</span>
        </div>
      </div>
    </section>
  );
}
