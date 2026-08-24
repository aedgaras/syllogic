import { resolveMissingAccountLogos } from "@/lib/actions/account-logos";
import { resolveMissingMerchantLogos } from "@/lib/actions/transaction-logos";
import { hasActiveTransactionFilters } from "../query-state";
import type { TransactionsQueryState } from "../domain/contracts";
import type { TransactionListRepository } from "../application/get-transaction-page";
import {
  mapTransactionListRows,
  type TransactionListRow,
} from "./transaction-list.mapper";
import { fetchTransactionPageViaBackend } from "./transaction-list.gateway";
import { logger } from "@/lib/logger";

export async function hydrateResolvedAccountLogos(rows: TransactionListRow[]) {
  const uniqueAccounts = Array.from(
    new Map(
      rows
        .filter((row) => row.account)
        .map((row) => [
          row.account!.id,
          {
            id: row.account!.id,
            institution: row.account!.institution,
            logoId: row.account!.logoId,
            logo: row.account!.logo,
          },
        ]),
    ).values(),
  );
  const resolvedAccounts = await resolveMissingAccountLogos(uniqueAccounts);
  const resolvedById = new Map(
    resolvedAccounts.map((account) => [account.id, account]),
  );

  return rows.map((row) => {
    if (!row.account) return row;
    const resolved = resolvedById.get(row.account.id);
    if (!resolved) return row;
    return {
      ...row,
      account: {
        ...row.account,
        logoId: resolved.logoId,
        logo: resolved.logo
          ? {
              id: resolved.logo.id,
              logoUrl: resolved.logo.logoUrl,
              updatedAt: resolved.logo.updatedAt ?? null,
            }
          : null,
      },
    };
  });
}

export async function hydrateResolvedMerchantLogos(rows: TransactionListRow[]) {
  const candidates = rows
    .filter((row) => row.merchant)
    .map((row) => ({
      id: row.id,
      merchant: row.merchant,
      logoId: row.logoId,
      logo: row.logo,
    }));

  if (candidates.length === 0) return rows;

  const resolved = await resolveMissingMerchantLogos(candidates);
  const resolvedById = new Map(resolved.map((item) => [item.id, item]));

  return rows.map((row) => {
    const match = resolvedById.get(row.id);
    if (!match) return row;
    return {
      ...row,
      logoId: match.logoId,
      logo: match.logo
        ? {
            id: match.logo.id,
            logoUrl: match.logo.logoUrl,
            updatedAt: match.logo.updatedAt ?? null,
          }
        : null,
    };
  });
}

/**
 * Totals for the current filter/date-range, computed unconditionally (unlike
 * getPage's filteredTotals, which is gated behind hasActiveTransactionFilters
 * to skip the extra query on the common unfiltered list render). Used by the
 * AI transactions summary, which needs a total even when no filters are
 * active. pageSize is minimized since only the totals/resolved-dates are used.
 */
export async function getFilteredTotals(
  userId: string,
  input: TransactionsQueryState,
): Promise<{
  totalIn: number;
  totalOut: number;
  resolvedFrom?: string;
  resolvedTo?: string;
}> {
  const result = await fetchTransactionPageViaBackend(
    userId,
    { ...input, page: 1, pageSize: 1 },
    { includeFilteredTotals: true },
  );
  return {
    totalIn: result.filteredTotals?.totalIn ?? 0,
    totalOut: result.filteredTotals?.totalOut ?? 0,
    resolvedFrom: result.resolvedFrom,
    resolvedTo: result.resolvedTo,
  };
}

export const transactionListRepository: TransactionListRepository = {
  async getPage(userId, input) {
    const shouldComputeFilteredTotals = hasActiveTransactionFilters(input);
    const result = await fetchTransactionPageViaBackend(userId, input, {
      includeFilteredTotals: shouldComputeFilteredTotals,
    });
    const rowsWithAccountLogos = await hydrateResolvedAccountLogos(result.rows);
    const rows = await hydrateResolvedMerchantLogos(rowsWithAccountLogos);
    return {
      rows: mapTransactionListRows(rows, (row) =>
        logger.warn(
          "[getTransactionPage] Transaction missing account relation",
          { transactionId: row.id, accountId: row.accountId },
        ),
      ),
      totalCount: result.totalCount,
      filteredTotals: shouldComputeFilteredTotals ? result.filteredTotals : null,
      page: input.page,
      pageSize: input.pageSize,
      resolvedFrom: result.resolvedFrom,
      resolvedTo: result.resolvedTo,
      effectiveHorizon: result.effectiveHorizon,
    };
  },
};
