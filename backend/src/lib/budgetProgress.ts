export type BudgetPeriod = "weekly" | "monthly" | "quarterly" | "yearly";

export interface PeriodWindow {
  start: Date;
  end: Date;
}

function addPeriod(date: Date, period: BudgetPeriod, count: number): Date {
  const next = new Date(date.getTime());
  switch (period) {
    case "weekly":
      next.setUTCDate(next.getUTCDate() + 7 * count);
      break;
    case "monthly":
      next.setUTCMonth(next.getUTCMonth() + count);
      break;
    case "quarterly":
      next.setUTCMonth(next.getUTCMonth() + 3 * count);
      break;
    case "yearly":
      next.setUTCFullYear(next.getUTCFullYear() + count);
      break;
  }
  return next;
}

/**
 * Returns the [start, end) window for `period` anchored at `startDate` that contains `asOf`.
 * Month/quarter/year overflow follows native Date rollover (e.g. Jan 31 + 1mo -> Mar 3 in a
 * non-leap Feb) — a known ceiling, acceptable for slice scope; day-of-month clamping can be
 * added later if budgets need exact calendar-month anchors.
 */
export function getPeriodWindow(period: BudgetPeriod, startDate: string, asOf: Date): PeriodWindow {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  let windowStart = start;
  let windowEnd = addPeriod(windowStart, period, 1);

  while (windowEnd.getTime() <= asOf.getTime()) {
    windowStart = windowEnd;
    windowEnd = addPeriod(windowStart, period, 1);
  }

  return { start: windowStart, end: windowEnd };
}

/** The window immediately preceding the current one, or null if the budget hasn't completed a first period yet. */
export function getPreviousPeriodWindow(period: BudgetPeriod, startDate: string, asOf: Date): PeriodWindow | null {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const current = getPeriodWindow(period, startDate, asOf);
  if (current.start.getTime() <= start.getTime()) return null;

  const prevStart = addPeriod(current.start, period, -1);
  return { start: prevStart, end: current.start };
}

export interface BudgetProgress {
  limitMinor: bigint;
  spentMinor: bigint;
  remainingMinor: bigint;
  pct: number;
}

export function computeBudgetProgress(limitMinor: bigint, spentMinor: bigint): BudgetProgress {
  const pct = limitMinor === 0n ? 0 : Number((spentMinor * 10000n) / limitMinor) / 100;
  return {
    limitMinor,
    spentMinor,
    remainingMinor: limitMinor - spentMinor,
    pct,
  };
}
