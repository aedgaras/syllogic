"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { OnChangeFn, PaginationState, SortingState } from "@tanstack/react-table";
import {
  parseTransactionsSearchParamsFromUrlSearchParams,
  toTransactionsSearchParams,
  type TransactionSortField,
  type TransactionsQueryState,
} from "../public";

const MANAGED_QUERY_KEYS = [
  "page", "pageSize", "search", "category", "account", "status",
  "subscription", "analytics", "minAmount", "maxAmount", "from", "to",
  "horizon", "sort", "order",
] as const;

export function mergeTransactionQueryParams(
  currentSearchParams: URLSearchParams,
  nextState: TransactionsQueryState
): URLSearchParams {
  const nextParams = new URLSearchParams(currentSearchParams.toString());
  MANAGED_QUERY_KEYS.forEach((key) => nextParams.delete(key));
  toTransactionsSearchParams(nextState).forEach((value, key) => {
    nextParams.append(key, value);
  });
  return nextParams;
}

function mapSortColumnId(id: string): TransactionSortField {
  return id === "amount" || id === "description" || id === "merchant"
    ? id
    : "bookedAt";
}

export function useTransactionQueryState(
  queryState: TransactionsQueryState,
  basePath = "/transactions"
) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateQueryState = React.useCallback(
    (patch: Partial<TransactionsQueryState>, options?: { resetPage?: boolean }) => {
      const currentParams = new URLSearchParams(searchParams.toString());
      const nextState = {
        ...parseTransactionsSearchParamsFromUrlSearchParams(currentParams),
        ...patch,
      };
      if (options?.resetPage ?? true) nextState.page = 1;

      const queryString = mergeTransactionQueryParams(currentParams, nextState).toString();
      router.replace(queryString ? `${basePath}?${queryString}` : basePath, { scroll: false });
    },
    [basePath, router, searchParams]
  );

  const sortingState = React.useMemo<SortingState>(
    () => [{ id: queryState.sort, desc: queryState.order === "desc" }],
    [queryState.order, queryState.sort]
  );
  const paginationState = React.useMemo<PaginationState>(
    () => ({ pageIndex: Math.max(0, queryState.page - 1), pageSize: queryState.pageSize }),
    [queryState.page, queryState.pageSize]
  );

  const onSortingStateChange = React.useCallback<OnChangeFn<SortingState>>(
    (updater) => {
      const next = typeof updater === "function" ? updater(sortingState) : updater;
      const sort = next[0];
      updateQueryState(
        sort
          ? { sort: mapSortColumnId(sort.id), order: sort.desc ? "desc" : "asc" }
          : { sort: "bookedAt", order: "desc" },
        { resetPage: false }
      );
    },
    [sortingState, updateQueryState]
  );

  const onPaginationStateChange = React.useCallback<OnChangeFn<PaginationState>>(
    (updater) => {
      const next = typeof updater === "function" ? updater(paginationState) : updater;
      updateQueryState(
        { page: next.pageIndex + 1, pageSize: next.pageSize },
        { resetPage: false }
      );
    },
    [paginationState, updateQueryState]
  );

  const consumeTransactionDeepLink = React.useCallback(
    (transactionId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (params.get("tx") !== transactionId) return;
      params.delete("tx");
      const queryString = params.toString();
      router.replace(queryString ? `${basePath}?${queryString}` : basePath, { scroll: false });
    },
    [basePath, router, searchParams]
  );

  return {
    searchParams,
    updateQueryState,
    sortingState,
    paginationState,
    onSortingStateChange,
    onPaginationStateChange,
    consumeTransactionDeepLink,
  };
}
