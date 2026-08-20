import { getBackendBaseUrl } from "@/lib/backend-url";
import { createInternalAuthHeaders } from "@/lib/internal-auth";
import type {
  AccountOption,
  LinkedTransaction,
  LinkRole,
  LinkSearchFilters,
  LinkSearchResult,
  SuggestedLink,
  TransactionLinkGroup,
  TransactionLinkInfo,
} from "./transaction-links";

async function extractErrorDetail(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => ({ detail: fallback }));
  const detail = Array.isArray(data.detail) ? data.detail[0]?.msg : data.detail;
  return typeof detail === "string" ? detail : fallback;
}

function backendFetch(method: string, path: string, userId: string, body?: unknown) {
  const serializedBody = body !== undefined ? JSON.stringify(body) : undefined;
  return fetch(`${getBackendBaseUrl().replace(/\/+$/, "")}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...createInternalAuthHeaders({
        method,
        pathWithQuery: path,
        userId,
        body: serializedBody ?? "",
      }),
    },
    body: serializedBody,
    ...(method === "GET" ? { cache: "no-store" as const } : {}),
  });
}

interface BackendLinkedTransaction {
  id: string;
  amount: string;
  description: string | null;
  merchant: string | null;
  booked_at: string;
  transaction_type: string | null;
  link_role: LinkRole;
}

function mapLinkedTransaction(item: BackendLinkedTransaction): LinkedTransaction {
  return {
    id: item.id,
    amount: Number.parseFloat(item.amount),
    description: item.description,
    merchant: item.merchant,
    bookedAt: new Date(item.booked_at),
    transactionType: item.transaction_type,
    linkRole: item.link_role,
  };
}

interface BackendTransactionLinkGroup {
  group_id: string;
  primary: BackendLinkedTransaction | null;
  linked: BackendLinkedTransaction[];
  net_amount: string;
  currency: string | null;
}

function mapLinkGroup(data: BackendTransactionLinkGroup): TransactionLinkGroup {
  return {
    groupId: data.group_id,
    primary: data.primary ? mapLinkedTransaction(data.primary) : null,
    linked: data.linked.map(mapLinkedTransaction),
    netAmount: Number.parseFloat(data.net_amount),
    currency: data.currency,
  };
}

export async function getAccountsForLinkingViaBackend(
  userId: string,
): Promise<AccountOption[]> {
  const response = await backendFetch("GET", "/api/transaction-links/accounts-for-linking", userId);
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to get accounts"));
  }
  const data: { id: string; name: string }[] = await response.json();
  return data.map((item) => ({ id: item.id, name: item.name }));
}

export async function createLinkGroupViaBackend(
  userId: string,
  primaryId: string,
  linkedIds: string[],
  linkType: "reimbursement" | "expense",
): Promise<{ groupId: string }> {
  const response = await backendFetch("POST", "/api/transaction-links/groups", userId, {
    primary_id: primaryId,
    linked_ids: linkedIds,
    link_type: linkType,
  });
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to create link group"));
  }
  const data: { group_id: string } = await response.json();
  return { groupId: data.group_id };
}

export async function addTransactionToLinkGroupViaBackend(
  userId: string,
  groupId: string,
  transactionId: string,
  role: LinkRole,
): Promise<void> {
  const response = await backendFetch(
    "POST",
    `/api/transaction-links/groups/${groupId}/transactions`,
    userId,
    { transaction_id: transactionId, role },
  );
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to add transaction to group"));
  }
}

export async function removeTransactionFromLinkGroupViaBackend(
  userId: string,
  transactionId: string,
): Promise<{ groupDeleted: boolean }> {
  const response = await backendFetch(
    "DELETE",
    `/api/transaction-links/transactions/${transactionId}`,
    userId,
  );
  if (!response.ok) {
    throw new Error(
      await extractErrorDetail(response, "Failed to remove transaction from group"),
    );
  }
  const data: { group_deleted: boolean } = await response.json();
  return { groupDeleted: data.group_deleted };
}

export async function deleteLinkGroupViaBackend(
  userId: string,
  groupId: string,
): Promise<void> {
  const response = await backendFetch("DELETE", `/api/transaction-links/groups/${groupId}`, userId);
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to delete link group"));
  }
}

export async function getTransactionLinkGroupViaBackend(
  userId: string,
  transactionId: string,
): Promise<TransactionLinkGroup | null> {
  const response = await backendFetch(
    "GET",
    `/api/transaction-links/transactions/${transactionId}/group`,
    userId,
  );
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to get transaction link group"));
  }
  const data: BackendTransactionLinkGroup | null = await response.json();
  return data ? mapLinkGroup(data) : null;
}

export async function getUserLinkGroupsViaBackend(
  userId: string,
): Promise<TransactionLinkGroup[]> {
  const response = await backendFetch("GET", "/api/transaction-links/groups", userId);
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to get user link groups"));
  }
  const data: BackendTransactionLinkGroup[] = await response.json();
  return data.map(mapLinkGroup);
}

function buildSearchParams(filters: LinkSearchFilters): string {
  const params = new URLSearchParams();
  if (filters.searchQuery) params.set("search", filters.searchQuery);
  if (filters.accountId) params.set("account_id", filters.accountId);
  if (filters.dateFrom) params.set("date_from", filters.dateFrom.toISOString());
  if (filters.dateTo) params.set("date_to", filters.dateTo.toISOString());
  if (filters.minAmount !== undefined) params.set("min_amount", String(filters.minAmount));
  if (filters.maxAmount !== undefined) params.set("max_amount", String(filters.maxAmount));
  params.set("page", String(filters.page ?? 1));
  params.set("page_size", String(filters.pageSize ?? 50));
  return params.toString();
}

interface BackendSuggestedLink {
  id: string;
  amount: string;
  description: string | null;
  merchant: string | null;
  booked_at: string;
  transaction_type: string | null;
  account_id: string;
  account_name: string | null;
  score: number;
}

interface BackendLinkSearchResult {
  transactions: BackendSuggestedLink[];
  total_count: number;
  has_more: boolean;
}

function mapSearchResult(data: BackendLinkSearchResult): LinkSearchResult {
  const suggestions: SuggestedLink[] = data.transactions.map((item) => ({
    id: item.id,
    amount: Number.parseFloat(item.amount),
    description: item.description,
    merchant: item.merchant,
    bookedAt: new Date(item.booked_at),
    transactionType: item.transaction_type,
    accountId: item.account_id,
    accountName: item.account_name,
    score: item.score,
  }));
  return {
    transactions: suggestions,
    totalCount: data.total_count,
    hasMore: data.has_more,
  };
}

export async function findPotentialReimbursementsViaBackend(
  userId: string,
  transactionId: string,
  filters: LinkSearchFilters,
): Promise<LinkSearchResult> {
  const query = buildSearchParams(filters);
  const response = await backendFetch(
    "GET",
    `/api/transaction-links/transactions/${transactionId}/reimbursements?${query}`,
    userId,
  );
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to find potential reimbursements"));
  }
  return mapSearchResult(await response.json());
}

export async function findPotentialExpensesViaBackend(
  userId: string,
  transactionId: string,
  filters: LinkSearchFilters,
): Promise<LinkSearchResult> {
  const query = buildSearchParams(filters);
  const response = await backendFetch(
    "GET",
    `/api/transaction-links/transactions/${transactionId}/expenses?${query}`,
    userId,
  );
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to find potential expenses"));
  }
  return mapSearchResult(await response.json());
}

export async function getTransactionLinkInfoViaBackend(
  userId: string,
  transactionId: string,
): Promise<TransactionLinkInfo | null> {
  const response = await backendFetch(
    "GET",
    `/api/transaction-links/transactions/${transactionId}/link-info`,
    userId,
  );
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to get transaction link info"));
  }
  const data: {
    id: string;
    group_id: string;
    transaction_id: string;
    link_role: LinkRole;
    created_at: string | null;
  } | null = await response.json();
  if (!data) return null;
  return {
    id: data.id,
    groupId: data.group_id,
    transactionId: data.transaction_id,
    linkRole: data.link_role,
    createdAt: data.created_at ? new Date(data.created_at) : null,
  };
}

export async function createLinkGroupFromSelectionViaBackend(
  userId: string,
  transactionIds: string[],
): Promise<{ groupId: string }> {
  const response = await backendFetch("POST", "/api/transaction-links/groups/from-selection", userId, {
    transaction_ids: transactionIds,
  });
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to create link group"));
  }
  const data: { group_id: string } = await response.json();
  return { groupId: data.group_id };
}
