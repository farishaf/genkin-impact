export type NetSign = "gain" | "loss" | "neutral";
export type NetBucket = "none" | "low" | "medium" | "high";

/** Eastern convention: net income > expenditure = gain, net expenditure > income = loss. */
export function signForNet(netMinor: bigint): NetSign {
  if (netMinor > 0n) return "gain";
  if (netMinor < 0n) return "loss";
  return "neutral";
}

/** Magnitude bucket of |netMinor| relative to the largest |net| in the same window. */
export function bucketForNet(netMinor: bigint, maxAbsNetMinor: bigint): NetBucket {
  if (netMinor === 0n || maxAbsNetMinor === 0n) return "none";
  const abs = netMinor < 0n ? -netMinor : netMinor;
  const ratio = Number(abs) / Number(maxAbsNetMinor);
  if (ratio <= 1 / 3) return "low";
  if (ratio <= 2 / 3) return "medium";
  return "high";
}

export interface MonthRange {
  start: Date;
  end: Date;
}

/** [start, end) UTC range for a "YYYY-MM" month string. */
export function monthRange(month: string): MonthRange {
  const [year, mon] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, mon - 1, 1));
  const end = new Date(Date.UTC(year, mon, 1));
  return { start, end };
}

/** All YYYY-MM-DD dates in [start, end), inclusive of start, exclusive of end. */
export function datesInRange(start: Date, end: Date): string[] {
  const dates: string[] = [];
  const cursor = new Date(start.getTime());
  while (cursor.getTime() < end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}
