import type { SubscriptionFrequency, SubscriptionListRow } from "./contracts";

const monthlyMultipliers: Record<SubscriptionFrequency, number> = {
  weekly: 4,
  biweekly: 2,
  monthly: 1,
  quarterly: 1 / 3,
  yearly: 1 / 12,
};

export function monthlyEquivalent(
  amount: string | number,
  frequency: string,
): number {
  const parsedAmount = Math.abs(Number(amount));
  if (!Number.isFinite(parsedAmount)) return 0;
  return (
    parsedAmount * (monthlyMultipliers[frequency as SubscriptionFrequency] ?? 1)
  );
}

export function getCurrencyFallback(
  items: SubscriptionListRow[],
  fallback = "EUR",
): string {
  return items.find((item) => item.currency)?.currency || fallback;
}

export function validateSubscriptionInput(input: {
  name?: string;
  accountId?: string;
  amount?: number;
  importance?: number;
}): string | null {
  if (!input.name?.trim()) return "Name is required";
  if (!input.accountId) return "Account is required";
  if (
    input.amount === undefined ||
    !Number.isFinite(input.amount) ||
    input.amount <= 0
  ) {
    return "Amount must be greater than 0";
  }
  if (
    input.importance === undefined ||
    input.importance < 1 ||
    input.importance > 3
  ) {
    return "Importance must be between 1 and 3";
  }
  return null;
}

const stepDays: Partial<Record<SubscriptionFrequency, number>> = {
  weekly: 7,
  biweekly: 14,
};

const stepMonths: Partial<Record<SubscriptionFrequency, number>> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

/**
 * Next occurrence strictly after `from`, as a `YYYY-MM-DD` string.
 *
 * Mirrors the backend's `compute_next_due_date`
 * (backend/app/services/recurring_transaction_schedule_service.py), including
 * its month-end clamping: Jan 31 + 1 month is Feb 28/29, not Mar 3. Used to
 * pre-fill a schedule from a transaction the user is turning into a recurring
 * entry; the backend stays the authority once the entry exists.
 */
export function nextDueDateAfter(
  from: Date,
  frequency: string,
): string | null {
  const days = stepDays[frequency as SubscriptionFrequency];
  const months = stepMonths[frequency as SubscriptionFrequency];
  if (days === undefined && months === undefined) return null;

  const next = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  if (days !== undefined) {
    next.setUTCDate(next.getUTCDate() + days);
  } else {
    const targetDay = next.getUTCDate();
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + (months as number));
    const daysInMonth = new Date(
      Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
    ).getUTCDate();
    next.setUTCDate(Math.min(targetDay, daysInMonth));
  }
  return next.toISOString().slice(0, 10);
}
