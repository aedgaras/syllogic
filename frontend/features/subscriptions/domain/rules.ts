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
