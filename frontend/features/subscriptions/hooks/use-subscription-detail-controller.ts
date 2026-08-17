"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  getLinkedTransactions,
  getSubscriptionCostAggregations,
  matchTransactionsToSubscription,
} from "../client/actions";
import type {
  LinkedSubscriptionTransaction,
  SubscriptionViewModel,
} from "../public";

export function useSubscriptionDetailController(
  subscription: SubscriptionViewModel | null,
  open: boolean,
  onRefresh: () => void,
) {
  const [isLoading, setIsLoading] = useState(true);
  const [isMatching, setIsMatching] = useState(false);
  const [costAggregations, setCostAggregations] = useState({
    thisYear: 0,
    allTime: 0,
  });
  const [linkedTransactions, setLinkedTransactions] = useState<
    LinkedSubscriptionTransaction[]
  >([]);

  const load = useCallback(async () => {
    if (!subscription) return;
    setIsLoading(true);
    try {
      const [aggregations, transactions] = await Promise.all([
        getSubscriptionCostAggregations(subscription.id),
        getLinkedTransactions(subscription.id),
      ]);
      setCostAggregations(aggregations);
      setLinkedTransactions(transactions);
    } catch {
      toast.error("Failed to load subscription details");
    } finally {
      setIsLoading(false);
    }
  }, [subscription]);

  useEffect(() => {
    if (open) void load();
  }, [load, open]);

  async function matchTransactions() {
    if (!subscription) return;
    setIsMatching(true);
    try {
      const result = await matchTransactionsToSubscription(subscription.id);
      if (!result.success) {
        toast.error(result.error || "Failed to match transactions");
        return;
      }
      const count = result.matchedCount ?? 0;
      if (count > 0)
        toast.success(
          `Matched ${count} new transaction(s) to "${subscription.name}"`,
        );
      else if (linkedTransactions.length > 0) {
        toast.info(
          `All ${linkedTransactions.length} transaction(s) are already linked to "${subscription.name}"`,
        );
      } else toast.info("No matching transactions found");
      await load();
      onRefresh();
    } catch {
      toast.error("Failed to match transactions");
    } finally {
      setIsMatching(false);
    }
  }

  return {
    costAggregations,
    isLoading,
    isMatching,
    linkedTransactions,
    matchTransactions,
  };
}
