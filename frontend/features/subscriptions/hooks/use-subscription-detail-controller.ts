"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  generateRecurringTransactionNow,
  getLinkedTransactions,
  getSubscriptionCostAggregations,
  matchTransactionsToSubscription,
  skipRecurringTransactionOccurrence,
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
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSkipping, setIsSkipping] = useState(false);
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

  async function generateNow() {
    if (!subscription) return;
    setIsGenerating(true);
    try {
      const result = await generateRecurringTransactionNow(subscription.id);
      if (!result.success) {
        toast.error(result.error || "Failed to generate transaction");
        return;
      }
      if (result.createdCount) {
        toast.success(
          `Booked the next "${subscription.name}" transaction${
            result.nextDueDate ? `; next one due ${result.nextDueDate}` : ""
          }`,
        );
      } else {
        toast.info("That occurrence already has a transaction");
      }
      await load();
      onRefresh();
    } catch {
      toast.error("Failed to generate transaction");
    } finally {
      setIsGenerating(false);
    }
  }

  async function skipNext() {
    if (!subscription) return;
    setIsSkipping(true);
    try {
      const result = await skipRecurringTransactionOccurrence(subscription.id);
      if (!result.success) {
        toast.error(result.error || "Failed to skip occurrence");
        return;
      }
      toast.success(
        result.nextDueDate
          ? `Skipped ${result.skippedDate}; next one due ${result.nextDueDate}`
          : `Skipped ${result.skippedDate}`,
      );
      onRefresh();
    } catch {
      toast.error("Failed to skip occurrence");
    } finally {
      setIsSkipping(false);
    }
  }

  return {
    costAggregations,
    generateNow,
    isGenerating,
    isLoading,
    isMatching,
    isSkipping,
    linkedTransactions,
    matchTransactions,
    skipNext,
  };
}
