import {
  addMonths,
  addWeeks,
  addYears,
  differenceInCalendarDays,
  getDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from "date-fns";
import type { BudgetPeriod } from "./contracts";

export interface PeriodRange {
  start: Date;
  end: Date;
}

/** Half-open range: [start, end). `end` is the start of the next period. */
export function getCurrentPeriodRange(
  period: BudgetPeriod,
  startDate: Date | null,
  now: Date,
): PeriodRange {
  switch (period) {
    case "weekly": {
      const weekStartsOn = startDate
        ? (getDay(startDate) as 0 | 1 | 2 | 3 | 4 | 5 | 6)
        : 1;
      const start = startOfWeek(now, { weekStartsOn });
      return { start, end: addWeeks(start, 1) };
    }
    case "yearly": {
      const start = startOfYear(now);
      return { start, end: addYears(start, 1) };
    }
    case "monthly":
    default: {
      const start = startOfMonth(now);
      return { start, end: addMonths(start, 1) };
    }
  }
}

/** Total number of days in a half-open [start, end) period range. */
export function daysInRange(range: PeriodRange): number {
  return differenceInCalendarDays(range.end, range.start);
}

/** Days elapsed so far, inclusive of today, clamped to the period's length. */
export function daysElapsedInRange(range: PeriodRange, now: Date): number {
  return Math.min(
    differenceInCalendarDays(now, range.start) + 1,
    daysInRange(range),
  );
}
