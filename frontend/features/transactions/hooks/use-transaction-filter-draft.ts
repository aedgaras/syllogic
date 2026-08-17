"use client";

import * as React from "react";
import {
  normalizeTransactionFilterDraft,
  transactionFilterDraftReducer,
  type TransactionFilterDraft,
} from "../domain/transaction-filter-draft";

export function useTransactionFilterDraft(
  filters: { search?: string; minAmount?: string; maxAmount?: string },
  onCommit: (patch: {
    search?: string;
    minAmount?: string;
    maxAmount?: string;
  }) => void,
) {
  const authoritativeDraft = React.useMemo<TransactionFilterDraft>(
    () => ({
      search: filters.search ?? "",
      minAmount: filters.minAmount ?? "",
      maxAmount: filters.maxAmount ?? "",
    }),
    [filters.maxAmount, filters.minAmount, filters.search],
  );
  const [draft, dispatch] = React.useReducer(
    transactionFilterDraftReducer,
    authoritativeDraft,
  );

  React.useEffect(() => {
    dispatch({ type: "sync", draft: authoritativeDraft });
  }, [authoritativeDraft]);

  React.useEffect(() => {
    const normalized = normalizeTransactionFilterDraft(draft);
    if (
      normalized.search === filters.search &&
      normalized.minAmount === filters.minAmount &&
      normalized.maxAmount === filters.maxAmount
    )
      return;
    const timeout = window.setTimeout(() => onCommit(normalized), 250);
    return () => window.clearTimeout(timeout);
  }, [draft, filters.maxAmount, filters.minAmount, filters.search, onCommit]);

  return {
    draft,
    setField: (field: keyof TransactionFilterDraft, value: string) =>
      dispatch({ type: "edit", field, value }),
  };
}
