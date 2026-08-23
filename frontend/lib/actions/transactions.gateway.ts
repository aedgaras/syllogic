import { getBackendBaseUrl } from "@/lib/backend-url";
import { createInternalAuthHeaders } from "@/lib/internal-auth";

async function extractErrorDetail(
  response: Response,
  fallback: string,
): Promise<string> {
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
  });
}

export interface TransferTransactionResult {
  sourceTransactionId: string;
  destinationTransactionId: string;
}

export async function createTransferTransactionViaBackend(
  userId: string,
  input: {
    sourceAccountId: string;
    destinationAccountId: string;
    amount: number;
    description: string;
    bookedAt: Date;
  },
): Promise<TransferTransactionResult> {
  const response = await backendFetch("POST", "/api/transactions/transfer", userId, {
    source_account_id: input.sourceAccountId,
    destination_account_id: input.destinationAccountId,
    amount: input.amount,
    description: input.description,
    booked_at: input.bookedAt.toISOString(),
  });
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to create transfer"));
  }
  const data = await response.json();
  return {
    sourceTransactionId: data.source_transaction_id,
    destinationTransactionId: data.destination_transaction_id,
  };
}

export async function repayCreditCardViaBackend(
  userId: string,
  input: {
    creditCardAccountId: string;
    sources: { sourceAccountId: string; amount: number }[];
    description: string;
    bookedAt: Date;
  },
): Promise<{ transfers: TransferTransactionResult[] }> {
  const response = await backendFetch("POST", "/api/transactions/repay-credit-card", userId, {
    credit_card_account_id: input.creditCardAccountId,
    sources: input.sources.map((source) => ({
      source_account_id: source.sourceAccountId,
      amount: source.amount,
    })),
    description: input.description,
    booked_at: input.bookedAt.toISOString(),
  });
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to repay credit card"));
  }
  const data = await response.json();
  return {
    transfers: data.transfers.map(
      (transfer: { source_transaction_id: string; destination_transaction_id: string }) => ({
        sourceTransactionId: transfer.source_transaction_id,
        destinationTransactionId: transfer.destination_transaction_id,
      }),
    ),
  };
}

export async function convertTransactionToTransferViaBackend(
  userId: string,
  transactionId: string,
  input: {
    sourceAccountId: string;
    destinationAccountId: string;
    amount: number;
    description: string;
    bookedAt: Date;
  },
): Promise<TransferTransactionResult> {
  const response = await backendFetch(
    "POST",
    `/api/transactions/${transactionId}/convert-to-transfer`,
    userId,
    {
      source_account_id: input.sourceAccountId,
      destination_account_id: input.destinationAccountId,
      amount: input.amount,
      description: input.description,
      booked_at: input.bookedAt.toISOString(),
    },
  );
  if (!response.ok) {
    throw new Error(
      await extractErrorDetail(response, "Failed to convert transaction to transfer"),
    );
  }
  const data = await response.json();
  return {
    sourceTransactionId: data.source_transaction_id,
    destinationTransactionId: data.destination_transaction_id,
  };
}

export async function addInterestTransactionViaBackend(
  userId: string,
  input: { accountId: string; amount: number; bookedAt: Date; description?: string },
): Promise<{ transactionId: string }> {
  const response = await backendFetch("POST", "/api/transactions/interest", userId, {
    account_id: input.accountId,
    amount: input.amount,
    booked_at: input.bookedAt.toISOString(),
    description: input.description ?? null,
  });
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to add interest"));
  }
  const data = await response.json();
  return { transactionId: data.transaction_id };
}

export async function getAccruedInterestForAccountViaBackend(
  userId: string,
  accountId: string,
): Promise<number> {
  const response = await backendFetch(
    "GET",
    `/api/transactions/accounts/${accountId}/accrued-interest`,
    userId,
  );
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to get accrued interest"));
  }
  const data = await response.json();
  return Number.parseFloat(data.total ?? "0");
}

export interface UpdateTransactionBackendInput {
  description: string | null;
  merchant: string | null;
  accountId: string;
  categoryId: string | null;
  amount: number;
  transactionType: "debit" | "credit";
  bookedAt: Date;
}

export async function updateTransactionViaBackend(
  userId: string,
  transactionId: string,
  input: UpdateTransactionBackendInput,
): Promise<void> {
  const signedAmount =
    input.transactionType === "debit" ? -Math.abs(input.amount) : Math.abs(input.amount);
  const response = await backendFetch(
    "PATCH",
    `/api/transactions/${transactionId}`,
    userId,
    {
      description: input.description,
      merchant: input.merchant,
      category_id: input.categoryId,
      account_id: input.accountId,
      amount: signedAmount,
      transaction_type: input.transactionType,
      booked_at: input.bookedAt.toISOString(),
    },
  );
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to update transaction"));
  }
}

export async function assignTransactionCategoryViaBackend(
  userId: string,
  transactionId: string,
  categoryId: string,
): Promise<void> {
  const response = await backendFetch(
    "PATCH",
    `/api/transactions/${transactionId}/category`,
    userId,
    { category_id: categoryId },
  );
  if (!response.ok) {
    throw new Error(
      await extractErrorDetail(response, "Failed to update transaction category"),
    );
  }
}

export async function bulkUpdateTransactionCategoryViaBackend(
  userId: string,
  transactionIds: string[],
  categoryId: string | null,
): Promise<{ updatedCount: number }> {
  const response = await backendFetch("PATCH", "/api/transactions/bulk/category", userId, {
    transaction_ids: transactionIds,
    category_id: categoryId,
  });
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to update transactions"));
  }
  const data = await response.json();
  return { updatedCount: data.updated_count };
}

export async function updateTransactionIncludeInAnalyticsViaBackend(
  userId: string,
  transactionId: string,
  includeInAnalytics: boolean,
): Promise<void> {
  const response = await backendFetch(
    "PATCH",
    `/api/transactions/${transactionId}/include-in-analytics`,
    userId,
    { include_in_analytics: includeInAnalytics },
  );
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to update transaction"));
  }
}

export async function bulkUpdateTransactionIncludeInAnalyticsViaBackend(
  userId: string,
  transactionIds: string[],
  includeInAnalytics: boolean,
): Promise<{ updatedCount: number }> {
  const response = await backendFetch(
    "PATCH",
    "/api/transactions/bulk/include-in-analytics",
    userId,
    { transaction_ids: transactionIds, include_in_analytics: includeInAnalytics },
  );
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to update transactions"));
  }
  const data = await response.json();
  return { updatedCount: data.updated_count };
}

export async function deleteBalancingTransactionViaBackend(
  userId: string,
  transactionId: string,
): Promise<void> {
  const response = await backendFetch(
    "DELETE",
    `/api/transactions/${transactionId}/balancing`,
    userId,
  );
  if (!response.ok) {
    throw new Error(
      await extractErrorDetail(response, "Failed to revert balancing transfer"),
    );
  }
}

export async function createOrUpdateBalancingTransactionViaBackend(
  userId: string,
  input: {
    accountId: string;
    targetBalance: number;
    adjustmentDate: Date;
    balancingCategoryId: string;
  },
): Promise<{ transactionId: string | null; isUpdate: boolean }> {
  const response = await backendFetch("PUT", "/api/transactions/balancing", userId, {
    account_id: input.accountId,
    target_balance: input.targetBalance,
    adjustment_date: input.adjustmentDate.toISOString(),
    balancing_category_id: input.balancingCategoryId,
  });
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to update balance"));
  }
  const data = await response.json();
  return { transactionId: data.transaction_id ?? null, isUpdate: Boolean(data.is_update) };
}

export interface AccountDeleteImpactBackend {
  accountId: string;
  accountName: string;
  currency: string;
  amountChange: number;
  currentBalance: number;
  projectedBalance: number;
  balanceIsAnchored: boolean;
}

export interface DeleteImpactBackend {
  accountImpacts: AccountDeleteImpactBackend[];
  totalTransactions: number;
  earliestDate: Date;
}

export async function getDeleteImpactViaBackend(
  userId: string,
  transactionIds: string[],
): Promise<DeleteImpactBackend> {
  const response = await backendFetch("POST", "/api/transactions/delete-impact", userId, {
    transaction_ids: transactionIds,
  });
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to compute impact"));
  }
  const data = await response.json();
  return {
    accountImpacts: (data.account_impacts ?? []).map(
      (impact: {
        account_id: string;
        account_name: string;
        currency: string;
        amount_change: string;
        current_balance: string;
        projected_balance: string;
        balance_is_anchored: boolean;
      }) => ({
        accountId: impact.account_id,
        accountName: impact.account_name,
        currency: impact.currency,
        amountChange: Number.parseFloat(impact.amount_change),
        currentBalance: Number.parseFloat(impact.current_balance),
        projectedBalance: Number.parseFloat(impact.projected_balance),
        balanceIsAnchored: impact.balance_is_anchored,
      }),
    ),
    totalTransactions: data.total_transactions,
    earliestDate: new Date(data.earliest_date),
  };
}

export async function deleteTransactionsViaBackend(
  userId: string,
  transactionIds: string[],
): Promise<{ affectedAccountIds: string[]; deletedCount: number }> {
  const response = await backendFetch("POST", "/api/transactions/bulk-delete", userId, {
    transaction_ids: transactionIds,
  });
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to delete transactions"));
  }
  const data = await response.json();
  return {
    affectedAccountIds: data.affected_account_ids ?? [],
    deletedCount: data.deleted_count,
  };
}
