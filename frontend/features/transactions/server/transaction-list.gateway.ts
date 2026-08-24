import { getBackendBaseUrl } from "@/lib/backend-url";
import { createInternalAuthHeaders } from "@/lib/internal-auth";
import type { TransactionsQueryState } from "../domain/contracts";
import type { TransactionListRow } from "./transaction-list.mapper";

interface BackendAccountSummary {
  id: string;
  name: string;
  institution: string | null;
  account_type: string;
  logo_id: string | null;
  logo: { id: string; logo_url: string | null; updated_at: string | null } | null;
}

interface BackendCategorySummary {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
}

interface BackendLogoSummary {
  id: string;
  logo_url: string | null;
  updated_at: string | null;
}

interface BackendRecurringTransactionSummary {
  id: string;
  name: string;
  merchant: string | null;
  frequency: string;
  logo_id: string | null;
  logo: BackendLogoSummary | null;
}

interface BackendTransactionLinkSummary {
  id: string;
  group_id: string;
  link_role: string;
}

interface BackendTransferAccountSummary {
  id: string;
  name: string;
}

interface BackendInternalTransferSummary {
  id: string;
  source_txn_id: string;
  mirror_txn_id: string | null;
  source_account: BackendTransferAccountSummary | null;
  pocket_account: BackendTransferAccountSummary | null;
}

export interface BackendTransactionWithDetails {
  id: string;
  account_id: string;
  description: string | null;
  merchant: string | null;
  creditor: string | null;
  debtor: string | null;
  amount: string;
  currency: string | null;
  category_id: string | null;
  category_system_id: string | null;
  recurring_transaction_id: string | null;
  booked_at: string;
  pending: boolean | null;
  transaction_type: string | null;
  include_in_analytics: boolean;
  logo_id: string | null;
  logo: BackendLogoSummary | null;
  account: BackendAccountSummary | null;
  category: BackendCategorySummary | null;
  category_system: BackendCategorySummary | null;
  recurring_transaction: BackendRecurringTransactionSummary | null;
  transaction_link: BackendTransactionLinkSummary | null;
  internal_transfer_id: string | null;
  internal_transfer: BackendInternalTransferSummary | null;
}

export function mapBackendTransaction(row: BackendTransactionWithDetails): TransactionListRow {
  return {
    id: row.id,
    accountId: row.account_id,
    description: row.description,
    merchant: row.merchant,
    creditor: row.creditor,
    debtor: row.debtor,
    amount: row.amount,
    currency: row.currency,
    categoryId: row.category_id,
    categorySystemId: row.category_system_id,
    recurringTransactionId: row.recurring_transaction_id,
    bookedAt: new Date(row.booked_at),
    pending: row.pending,
    transactionType: row.transaction_type,
    includeInAnalytics: row.include_in_analytics,
    logoId: row.logo_id,
    logo: row.logo
      ? {
          id: row.logo.id,
          logoUrl: row.logo.logo_url,
          updatedAt: row.logo.updated_at ? new Date(row.logo.updated_at) : null,
        }
      : null,
    account: row.account
      ? {
          id: row.account.id,
          name: row.account.name,
          institution: row.account.institution,
          accountType: row.account.account_type,
          logoId: row.account.logo_id,
          logo: row.account.logo
            ? {
                id: row.account.logo.id,
                logoUrl: row.account.logo.logo_url,
                updatedAt: row.account.logo.updated_at
                  ? new Date(row.account.logo.updated_at)
                  : null,
              }
            : null,
        }
      : null,
    category: row.category,
    categorySystem: row.category_system,
    recurringTransaction: row.recurring_transaction,
    transactionLink: row.transaction_link
      ? { groupId: row.transaction_link.group_id, linkRole: row.transaction_link.link_role }
      : null,
    internalTransferId: row.internal_transfer_id,
    internalTransfer: row.internal_transfer
      ? {
          id: row.internal_transfer.id,
          sourceTxnId: row.internal_transfer.source_txn_id,
          mirrorTxnId: row.internal_transfer.mirror_txn_id,
          sourceAccount: row.internal_transfer.source_account,
          pocketAccount: row.internal_transfer.pocket_account,
        }
      : null,
  };
}

/**
 * Fetches the full (unpaginated) transaction list for a user, optionally
 * scoped to one account. Backs the legacy getTransactions/
 * getTransactionsForAccount actions; the paginated/filtered list uses
 * fetchTransactionPageViaBackend (GET /api/transactions/page) instead.
 */
export async function fetchTransactionsViaBackend(
  userId: string,
  params: { accountId?: string } = {},
): Promise<TransactionListRow[]> {
  const query = params.accountId
    ? `?account_id=${encodeURIComponent(params.accountId)}&limit=10000`
    : "?limit=10000";
  const pathWithQuery = `/api/transactions/${query}`;
  const response = await fetch(`${getBackendBaseUrl()}${pathWithQuery}`, {
    headers: createInternalAuthHeaders({ method: "GET", pathWithQuery, userId }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch transactions: ${response.status}`);
  }
  const data: BackendTransactionWithDetails[] = await response.json();
  return data.map(mapBackendTransaction);
}

interface BackendFilteredTotals {
  total_in: string;
  total_out: string;
}

interface BackendTransactionPage {
  rows: BackendTransactionWithDetails[];
  total_count: number;
  filtered_totals: BackendFilteredTotals | null;
  page: number;
  page_size: number;
  resolved_from: string | null;
  resolved_to: string | null;
  effective_horizon: number | null;
}

export interface TransactionPageBackendResult {
  rows: TransactionListRow[];
  totalCount: number;
  filteredTotals: { totalIn: number; totalOut: number } | null;
  resolvedFrom?: string;
  resolvedTo?: string;
  effectiveHorizon?: number;
}

/**
 * Fetches one page of the filtered/paginated transaction list from
 * `GET /api/transactions/page`. Backs transaction-list.repository.ts's
 * getPage/getFilteredTotals — the query-param/combinator translation of
 * TransactionsQueryState (multi-value account/category/subscription
 * filters, uncategorized/no_subscription sentinels, horizon resolution)
 * lives server-side; this is just the wire format.
 */
export async function fetchTransactionPageViaBackend(
  userId: string,
  query: TransactionsQueryState,
  options: { includeFilteredTotals: boolean },
): Promise<TransactionPageBackendResult> {
  const accountIds = Array.from(
    new Set(query.accountIds.map((id) => id.trim()).filter(Boolean)),
  );
  const params = new URLSearchParams();
  for (const id of accountIds) params.append("account_ids", id);
  for (const value of query.category) params.append("category", value);
  for (const value of query.status) params.append("status", value);
  for (const value of query.subscription) params.append("subscription", value);
  for (const value of query.analytics) params.append("analytics", value);
  if (query.minAmount) params.set("min_amount", query.minAmount);
  if (query.maxAmount) params.set("max_amount", query.maxAmount);
  if (query.search) params.set("search", query.search);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.horizon !== undefined) params.set("horizon", String(query.horizon));
  params.set("sort", query.sort);
  params.set("order", query.order);
  params.set("page", String(query.page));
  params.set("page_size", String(query.pageSize));
  if (options.includeFilteredTotals) params.set("include_filtered_totals", "true");

  const pathWithQuery = `/api/transactions/page?${params.toString()}`;
  const response = await fetch(`${getBackendBaseUrl()}${pathWithQuery}`, {
    headers: createInternalAuthHeaders({ method: "GET", pathWithQuery, userId }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch transaction page: ${response.status}`);
  }
  const data: BackendTransactionPage = await response.json();
  return {
    rows: data.rows.map(mapBackendTransaction),
    totalCount: data.total_count,
    filteredTotals: data.filtered_totals
      ? {
          totalIn: Number.parseFloat(data.filtered_totals.total_in),
          totalOut: Number.parseFloat(data.filtered_totals.total_out),
        }
      : null,
    resolvedFrom: data.resolved_from ?? undefined,
    resolvedTo: data.resolved_to ?? undefined,
    effectiveHorizon: data.effective_horizon ?? undefined,
  };
}
