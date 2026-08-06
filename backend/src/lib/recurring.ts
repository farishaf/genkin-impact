export type Frequency = "daily" | "weekly" | "monthly" | "yearly";

export interface RecurringSchedule {
  frequency: Frequency;
  intervalCount: number;
  dayOfMonth?: number | null;
  endsOn?: string | null;
}

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

/**
 * Advances `current` by one interval of `schedule.frequency` x `schedule.intervalCount`.
 * Monthly rules with `dayOfMonth` clamp to the target month's last day when it's shorter
 * (e.g. day_of_month=31 lands on Feb 28/29) rather than overflowing into the next month.
 */
export function advanceNextRun(current: Date, schedule: RecurringSchedule): Date {
  const next = new Date(current.getTime());
  const count = schedule.intervalCount;

  switch (schedule.frequency) {
    case "daily":
      next.setUTCDate(next.getUTCDate() + count);
      break;
    case "weekly":
      next.setUTCDate(next.getUTCDate() + 7 * count);
      break;
    case "monthly": {
      // setUTCDate(1) first: setUTCMonth() overflows into the *next* month when the
      // current day-of-month doesn't exist there (Jan 31 -> setUTCMonth(Feb) rolls to
      // Mar 3), which would then make the dim/day-clamp below compute against March
      // instead of February. Parking on day 1 before changing the month avoids that.
      const targetDay = schedule.dayOfMonth ?? next.getUTCDate();
      next.setUTCDate(1);
      next.setUTCMonth(next.getUTCMonth() + count);
      const dim = daysInMonth(next.getUTCFullYear(), next.getUTCMonth());
      next.setUTCDate(Math.min(targetDay, dim));
      break;
    }
    case "yearly":
      next.setUTCFullYear(next.getUTCFullYear() + count);
      break;
  }

  return next;
}

export function isPastEnd(next: Date, endsOn?: string | null): boolean {
  if (!endsOn) return false;
  const endOfDay = new Date(`${endsOn}T23:59:59.999Z`);
  return next.getTime() > endOfDay.getTime();
}
