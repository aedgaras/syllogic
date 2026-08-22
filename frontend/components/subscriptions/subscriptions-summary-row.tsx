"use client";
import { t as translate } from "@/i18n/translate";

import type { SubscriptionListRow as SubscriptionOrSuggestion } from "@/features/subscriptions/public";
import {
  getCurrencyFallback,
  monthlyEquivalent,
} from "@/features/subscriptions/public";

interface SubscriptionsSummaryRowProps {
  data: SubscriptionOrSuggestion[];
}

export function SubscriptionsSummaryRow({
  data,
}: SubscriptionsSummaryRowProps) {
  // Only sum active subscriptions (exclude suggestions)
  const activeSubscriptions = data.filter((s) => !s.isSuggestion && s.isActive);

  const monthlyTotal = activeSubscriptions.reduce((sum, subscription) => {
    return sum + monthlyEquivalent(subscription.amount, subscription.frequency);
  }, 0);

  // Get currency from first subscription (assuming all use same currency)
  const currency = getCurrencyFallback(data);

  return (
    <div className="flex flex-col gap-2 border-t bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-sm font-medium text-muted-foreground">
        {translate("monthlyTotal")}
      </span>
      <span className="text-sm font-mono font-semibold">
        {monthlyTotal.toFixed(2)} {currency}
      </span>
    </div>
  );
}
