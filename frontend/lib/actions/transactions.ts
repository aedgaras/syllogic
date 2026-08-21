"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireAuth, getAuthenticatedSession } from "@/lib/auth-helpers";
import {
  isDemoRestrictedUserEmail,
  DEMO_RESTRICTED_ACTION_ERROR,
} from "@/lib/demo-access";
import { getBackendBaseUrl } from "@/lib/backend-url";
import { createInternalAuthHeaders } from "@/lib/internal-auth";
import { getFilteredTotals } from "@/features/transactions/server/transaction-list.repository";
import { fetchTransactionsViaBackend } from "@/features/transactions/server/transaction-list.gateway";
import type { TransactionsQueryState } from "@/features/transactions/public";
import type {
  AddInterestTransactionInput,
  ConvertTransactionToTransferInput,
  CreateTransactionInput,
  CreateTransferTransactionInput,
  RepayCreditCardInput,
  TransactionWithRelations,
  UpdateTransactionInput,
} from "@/features/transactions/public";
import {
  hydrateResolvedAccountLogos as hydrateTransactionRowsWithResolvedAccountLogos,
  mapTransactionRowsForUi,
} from "@/features/transactions/server";
import {
  createTransferTransactionViaBackend,
  repayCreditCardViaBackend,
  convertTransactionToTransferViaBackend,
  addInterestTransactionViaBackend,
  getAccruedInterestForAccountViaBackend,
  updateTransactionViaBackend,
  assignTransactionCategoryViaBackend,
  bulkUpdateTransactionCategoryViaBackend,
  updateTransactionIncludeInAnalyticsViaBackend,
  bulkUpdateTransactionIncludeInAnalyticsViaBackend,
  deleteBalancingTransactionViaBackend,
  createOrUpdateBalancingTransactionViaBackend,
  getDeleteImpactViaBackend,
  deleteTransactionsViaBackend,
} from "@/lib/actions/transactions.gateway";
import { logger } from "@/lib/logger";

export type {
  ConvertTransactionToTransferInput,
  CreateTransactionInput,
  CreateTransferTransactionInput,
  FilteredTransactionTotals,
  TransactionWithRelations,
  TransactionsPageResult,
  UpdateTransactionInput,
} from "@/features/transactions/public";

export async function createTransaction(
  input: CreateTransactionInput,
): Promise<{ success: boolean; error?: string; transactionId?: string }> {
  const userId = await requireAuth();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    // Call backend API to import the transaction
    const backendUrl = getBackendBaseUrl();
    const pathWithQuery = "/api/transactions/import";

    const requestBody = JSON.stringify({
      transactions: [
        {
          account_id: input.accountId,
          amount: input.amount,
          description: input.description,
          merchant: input.merchant || null,
          booked_at: input.bookedAt.toISOString(),
          transaction_type: input.transactionType,
          category_id: input.categoryId || null,
        },
      ],
      sync_exchange_rates: true,
      update_functional_amounts: true,
      calculate_balances: true,
    });
    const response = await fetch(`${backendUrl}${pathWithQuery}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...createInternalAuthHeaders({
          method: "POST",
          pathWithQuery,
          userId,
          body: requestBody,
        }),
      },
      body: requestBody,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error("Backend import failed", {
        status: response.status,
        body: errorText,
      });
      return {
        success: false,
        error: `Failed to create transaction: ${response.status}`,
      };
    }

    const backendResponse = await response.json();

    if (!backendResponse.success) {
      return { success: false, error: backendResponse.message };
    }

    revalidatePath("/transactions");
    revalidatePath("/");
    revalidatePath("/settings");
    revalidatePath("/assets");

    return {
      success: true,
      transactionId: backendResponse.transaction_ids?.[0] || undefined,
    };
  } catch (error) {
    logger.error("Failed to create transaction", { error });
    return { success: false, error: "Failed to create transaction" };
  }
}

/**
 * Creates both sides of an account-to-account transfer and links them so the
 * movement affects account balances without being counted as income/spending.
 */
export async function createTransferTransaction(
  input: CreateTransferTransactionInput,
): Promise<{
  success: boolean;
  error?: string;
  sourceTransactionId?: string;
  destinationTransactionId?: string;
}> {
  const session = await getAuthenticatedSession();
  const userId = session?.user?.id ?? null;

  if (!userId) return { success: false, error: "Not authenticated" };
  if (isDemoRestrictedUserEmail(session?.user?.email)) {
    return { success: false, error: DEMO_RESTRICTED_ACTION_ERROR };
  }

  const description = input.description.trim();
  if (!description) return { success: false, error: "Description is required" };
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { success: false, error: "Amount must be greater than zero" };
  }
  if (
    !(input.bookedAt instanceof Date) ||
    Number.isNaN(input.bookedAt.getTime())
  ) {
    return { success: false, error: "A valid transaction date is required" };
  }
  if (input.sourceAccountId === input.destinationAccountId) {
    return {
      success: false,
      error: "Source and destination accounts must be different",
    };
  }

  try {
    const result = await createTransferTransactionViaBackend(userId, {
      sourceAccountId: input.sourceAccountId,
      destinationAccountId: input.destinationAccountId,
      amount: input.amount,
      description,
      bookedAt: input.bookedAt,
    });

    revalidatePath("/transactions");
    revalidatePath("/");
    revalidatePath("/settings");
    revalidatePath("/assets");
    revalidatePath(`/accounts/${input.sourceAccountId}`);
    revalidatePath(`/accounts/${input.destinationAccountId}`);

    return { success: true, ...result };
  } catch (error) {
    logger.error("Failed to create transfer transaction", { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create transfer",
    };
  }
}

/**
 * Pays down a credit card balance from one or more source accounts, each
 * producing its own linked transfer pair.
 */
export async function repayCreditCard(input: RepayCreditCardInput): Promise<{
  success: boolean;
  error?: string;
  sourceTransactionIds?: string[];
  destinationTransactionIds?: string[];
}> {
  const session = await getAuthenticatedSession();
  const userId = session?.user?.id ?? null;

  if (!userId) return { success: false, error: "Not authenticated" };
  if (isDemoRestrictedUserEmail(session?.user?.email)) {
    return { success: false, error: DEMO_RESTRICTED_ACTION_ERROR };
  }

  const description = input.description.trim();
  if (!description) return { success: false, error: "Description is required" };
  if (input.sources.length === 0) {
    return { success: false, error: "At least one source account is required" };
  }
  const sourceIds = input.sources.map((source) => source.sourceAccountId);
  if (new Set(sourceIds).size !== sourceIds.length) {
    return { success: false, error: "Each source account can only be used once" };
  }
  if (sourceIds.includes(input.creditCardAccountId)) {
    return { success: false, error: "The credit card cannot pay itself" };
  }
  for (const source of input.sources) {
    if (!Number.isFinite(source.amount) || source.amount <= 0) {
      return { success: false, error: "Each source amount must be greater than zero" };
    }
  }
  if (
    !(input.bookedAt instanceof Date) ||
    Number.isNaN(input.bookedAt.getTime())
  ) {
    return { success: false, error: "A valid transaction date is required" };
  }

  try {
    const result = await repayCreditCardViaBackend(userId, input);

    revalidatePath("/transactions");
    revalidatePath("/");
    revalidatePath("/settings");
    revalidatePath("/assets");
    revalidatePath(`/accounts/${input.creditCardAccountId}`);
    for (const source of input.sources) {
      revalidatePath(`/accounts/${source.sourceAccountId}`);
    }

    return {
      success: true,
      sourceTransactionIds: result.transfers.map((t) => t.sourceTransactionId),
      destinationTransactionIds: result.transfers.map((t) => t.destinationTransactionId),
    };
  } catch (error) {
    logger.error("Failed to repay credit card", { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to repay credit card",
    };
  }
}

/**
 * Converts an existing standalone transaction into the source side of an
 * account-to-account transfer, then creates and links the destination side.
 */
export async function convertTransactionToTransfer(
  input: ConvertTransactionToTransferInput,
): Promise<{
  success: boolean;
  error?: string;
  sourceTransactionId?: string;
  destinationTransactionId?: string;
}> {
  const session = await getAuthenticatedSession();
  const userId = session?.user?.id ?? null;

  if (!userId) return { success: false, error: "Not authenticated" };
  if (isDemoRestrictedUserEmail(session?.user?.email)) {
    return { success: false, error: DEMO_RESTRICTED_ACTION_ERROR };
  }

  const description = input.description.trim();
  if (!description) return { success: false, error: "Description is required" };
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { success: false, error: "Amount must be greater than zero" };
  }
  if (
    !(input.bookedAt instanceof Date) ||
    Number.isNaN(input.bookedAt.getTime())
  ) {
    return { success: false, error: "A valid transaction date is required" };
  }
  if (input.sourceAccountId === input.destinationAccountId) {
    return {
      success: false,
      error: "Source and destination accounts must be different",
    };
  }

  try {
    const result = await convertTransactionToTransferViaBackend(
      userId,
      input.transactionId,
      {
        sourceAccountId: input.sourceAccountId,
        destinationAccountId: input.destinationAccountId,
        amount: input.amount,
        description,
        bookedAt: input.bookedAt,
      },
    );

    revalidatePath("/transactions");
    revalidatePath("/");
    revalidatePath("/settings");
    revalidatePath("/assets");
    revalidatePath("/subscriptions");
    revalidatePath(`/accounts/${input.sourceAccountId}`);
    revalidatePath(`/accounts/${input.destinationAccountId}`);

    return { success: true, ...result };
  } catch (error) {
    logger.error("Failed to convert transaction to transfer", { error });
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to convert transaction to transfer",
    };
  }
}

/**
 * Records interest earned on a savings account as a single income transaction,
 * tagged with the "Interest" system category so it can be summed separately
 * from ordinary income (see getAccruedInterestForAccount).
 */
export async function addInterestTransaction(
  input: AddInterestTransactionInput,
): Promise<{ success: boolean; error?: string; transactionId?: string }> {
  const session = await getAuthenticatedSession();
  const userId = session?.user?.id ?? null;

  if (!userId) return { success: false, error: "Not authenticated" };
  if (isDemoRestrictedUserEmail(session?.user?.email)) {
    return { success: false, error: DEMO_RESTRICTED_ACTION_ERROR };
  }

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { success: false, error: "Amount must be greater than zero" };
  }
  if (
    !(input.bookedAt instanceof Date) ||
    Number.isNaN(input.bookedAt.getTime())
  ) {
    return { success: false, error: "A valid transaction date is required" };
  }

  try {
    const { transactionId } = await addInterestTransactionViaBackend(userId, {
      accountId: input.accountId,
      amount: input.amount,
      bookedAt: input.bookedAt,
      description: input.description?.trim() || undefined,
    });

    revalidatePath("/transactions");
    revalidatePath("/");
    revalidatePath(`/accounts/${input.accountId}`);

    return { success: true, transactionId };
  } catch (error) {
    logger.error("Failed to add interest transaction", { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to add interest",
    };
  }
}

/**
 * Sums interest transactions (tagged with the "savings_interest" system
 * category) recorded for an account, for display as "accrued interest".
 */
export async function getAccruedInterestForAccount(
  accountId: string,
): Promise<number> {
  const userId = await requireAuth();
  if (!userId) return 0;

  try {
    return await getAccruedInterestForAccountViaBackend(userId, accountId);
  } catch (error) {
    logger.error("Failed to get accrued interest", { error });
    return 0;
  }
}

export async function updateTransaction(
  input: UpdateTransactionInput,
): Promise<{ success: boolean; error?: string }> {
  const session = await getAuthenticatedSession();
  const userId = session?.user?.id ?? null;

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }
  if (isDemoRestrictedUserEmail(session?.user?.email)) {
    return { success: false, error: DEMO_RESTRICTED_ACTION_ERROR };
  }

  const description = input.description.trim();
  const merchant = input.merchant?.trim() || null;
  if (!description) {
    return { success: false, error: "Description is required" };
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { success: false, error: "Amount must be greater than zero" };
  }
  if (
    !(input.bookedAt instanceof Date) ||
    Number.isNaN(input.bookedAt.getTime())
  ) {
    return { success: false, error: "A valid transaction date is required" };
  }
  if (input.transactionType !== "debit" && input.transactionType !== "credit") {
    return { success: false, error: "A valid transaction type is required" };
  }

  try {
    await updateTransactionViaBackend(userId, input.transactionId, {
      description,
      merchant,
      accountId: input.accountId,
      categoryId: input.categoryId || null,
      amount: input.amount,
      transactionType: input.transactionType,
      bookedAt: input.bookedAt,
    });

    revalidatePath("/transactions");
    revalidatePath("/");
    revalidatePath("/settings");
    revalidatePath("/assets");
    revalidatePath("/subscriptions");

    return { success: true };
  } catch (error) {
    logger.error("Failed to update transaction", { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update transaction",
    };
  }
}

export async function updateTransactionCategory(
  transactionId: string,
  categoryId: string | null,
): Promise<{ success: boolean; error?: string }> {
  const userId = await requireAuth();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    if (categoryId) {
      await assignTransactionCategoryViaBackend(userId, transactionId, categoryId);
    } else {
      await bulkUpdateTransactionCategoryViaBackend(userId, [transactionId], null);
    }

    revalidatePath("/transactions");
    return { success: true };
  } catch (error) {
    logger.error("Failed to update transaction category", { error });
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to update transaction category",
    };
  }
}

import { getUserAccounts as _dashboardGetUserAccounts } from "@/lib/actions/dashboard";

export async function getUserAccounts() {
  return _dashboardGetUserAccounts();
}

// Note: getUserCategories has been consolidated in lib/actions/categories.ts
// Use: import { getUserCategories } from "@/lib/actions/categories"

export async function getTransactions(): Promise<TransactionWithRelations[]> {
  const userId = await requireAuth();

  if (!userId) {
    return [];
  }

  try {
    const result = await fetchTransactionsViaBackend(userId);
    const hydratedRows =
      await hydrateTransactionRowsWithResolvedAccountLogos(result);
    return mapTransactionRowsForUi(hydratedRows, "getTransactions");
  } catch (error: unknown) {
    const normalizedError =
      error instanceof Error
        ? {
            message: error.message,
            cause:
              "cause" in error
                ? (error as Error & { cause?: unknown }).cause
                : undefined,
            stack: error.stack,
          }
        : { message: String(error), cause: undefined, stack: undefined };
    logger.error("[getTransactions] Query failed", {
      error: normalizedError.message,
      cause: normalizedError.cause,
      stack: normalizedError.stack,
      userId,
    });
    // Return empty array on error to prevent app crash
    return [];
  }
}

export async function getTransactionsForAccount(
  accountId: string,
): Promise<TransactionWithRelations[]> {
  const userId = await requireAuth();

  if (!userId) {
    return [];
  }

  try {
    const result = await fetchTransactionsViaBackend(userId, { accountId });
    const hydratedRows =
      await hydrateTransactionRowsWithResolvedAccountLogos(result);
    return mapTransactionRowsForUi(hydratedRows, "getTransactionsForAccount");
  } catch (error: unknown) {
    const normalizedError =
      error instanceof Error
        ? {
            message: error.message,
            cause:
              "cause" in error
                ? (error as Error & { cause?: unknown }).cause
                : undefined,
            stack: error.stack,
          }
        : { message: String(error), cause: undefined, stack: undefined };
    logger.error("[getTransactionsForAccount] Query failed", {
      error: normalizedError.message,
      cause: normalizedError.cause,
      stack: normalizedError.stack,
      userId,
      accountId,
    });
    // Return empty array on error to prevent app crash
    return [];
  }
}

export async function bulkUpdateTransactionCategory(
  transactionIds: string[],
  categoryId: string | null,
): Promise<{ success: boolean; error?: string; updatedCount?: number }> {
  const userId = await requireAuth();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  if (transactionIds.length === 0) {
    return { success: false, error: "No transactions selected" };
  }

  try {
    const { updatedCount } = await bulkUpdateTransactionCategoryViaBackend(
      userId,
      transactionIds,
      categoryId,
    );
    revalidatePath("/transactions");
    return { success: true, updatedCount };
  } catch (error) {
    logger.error("Failed to bulk update transaction categories", { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update transactions",
    };
  }
}

export async function updateTransactionIncludeInAnalytics(
  transactionId: string,
  includeInAnalytics: boolean,
): Promise<{ success: boolean; error?: string }> {
  const userId = await requireAuth();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    await updateTransactionIncludeInAnalyticsViaBackend(
      userId,
      transactionId,
      includeInAnalytics,
    );

    revalidatePath("/transactions");
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    logger.error("Failed to update transaction include_in_analytics", { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update transaction",
    };
  }
}

export async function bulkUpdateTransactionIncludeInAnalytics(
  transactionIds: string[],
  includeInAnalytics: boolean,
): Promise<{ success: boolean; error?: string; updatedCount?: number }> {
  const userId = await requireAuth();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  if (transactionIds.length === 0) {
    return { success: false, error: "No transactions selected" };
  }

  try {
    const { updatedCount } = await bulkUpdateTransactionIncludeInAnalyticsViaBackend(
      userId,
      transactionIds,
      includeInAnalytics,
    );

    revalidatePath("/transactions");
    revalidatePath("/");
    return { success: true, updatedCount };
  } catch (error) {
    logger.error("Failed to bulk update transaction include_in_analytics", {
      error,
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update transactions",
    };
  }
}

/**
 * Deletes a balancing transfer transaction and recalculates balances.
 * This reverts the balance adjustment as if the transfer never existed.
 */
export async function deleteBalancingTransaction(
  transactionId: string,
): Promise<{ success: boolean; error?: string }> {
  const userId = await requireAuth();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    await deleteBalancingTransactionViaBackend(userId, transactionId);

    revalidatePath("/transactions");
    revalidatePath("/");
    revalidatePath("/settings");
    revalidatePath("/assets");

    return { success: true };
  } catch (error) {
    logger.error("Failed to delete balancing transaction", { error });
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to revert balancing transfer",
    };
  }
}

export interface CreateOrUpdateBalancingTransactionInput {
  accountId: string;
  targetBalance: number;
  adjustmentDate: Date;
  balancingCategoryId: string;
}

/**
 * Creates or updates a balancing transfer for a specific date.
 * If a balancing transfer already exists on that date for the account, it updates it.
 * Otherwise, it creates a new one.
 * In both cases, balances are recalculated.
 */
export async function createOrUpdateBalancingTransaction(
  input: CreateOrUpdateBalancingTransactionInput,
): Promise<{
  success: boolean;
  error?: string;
  transactionId?: string;
  isUpdate?: boolean;
}> {
  const userId = await requireAuth();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const { transactionId, isUpdate } =
      await createOrUpdateBalancingTransactionViaBackend(userId, input);

    revalidatePath("/transactions");
    revalidatePath("/");
    revalidatePath("/settings");
    revalidatePath("/assets");

    return { success: true, transactionId: transactionId ?? undefined, isUpdate };
  } catch (error) {
    logger.error("Failed to create/update balancing transaction", { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update balance",
    };
  }
}

// ============================================================================
// Deletion Flows
// ============================================================================

export interface AccountDeleteImpact {
  accountId: string;
  accountName: string;
  currency: string;
  amountChange: number;
  currentBalance: number;
  projectedBalance: number;
  balanceIsAnchored: boolean;
}

export interface DeleteImpact {
  accountImpacts: AccountDeleteImpact[];
  totalTransactions: number;
  earliestDate: Date;
}

/**
 * Computes the balance impact of deleting a set of transactions without modifying any data.
 * Used to populate the delete confirmation dialog before the user confirms.
 */
export async function getDeleteImpact(
  transactionIds: string[],
): Promise<
  { success: true; data: DeleteImpact } | { success: false; error: string }
> {
  const userId = await requireAuth();
  if (!userId) return { success: false, error: "Not authenticated" };
  if (!transactionIds.length)
    return { success: false, error: "No transactions selected" };

  try {
    const impact = await getDeleteImpactViaBackend(userId, transactionIds);
    return {
      success: true,
      data: {
        accountImpacts: impact.accountImpacts,
        totalTransactions: impact.totalTransactions,
        earliestDate: impact.earliestDate,
      },
    };
  } catch (error) {
    logger.error("Failed to compute delete impact", { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to compute impact",
    };
  }
}

/**
 * Permanently deletes a set of transactions and updates account balances.
 * All transactions must belong to the authenticated user.
 * Balance recalculation runs after deletion.
 */
export async function deleteTransactions(transactionIds: string[]): Promise<{
  success: boolean;
  error?: string;
  affectedAccountIds?: string[];
  deletedCount?: number;
}> {
  const session = await getAuthenticatedSession();
  const userId = session?.user?.id ?? null;
  if (!userId) return { success: false, error: "Not authenticated" };
  if (isDemoRestrictedUserEmail(session?.user?.email)) {
    return { success: false, error: DEMO_RESTRICTED_ACTION_ERROR };
  }
  if (!transactionIds.length)
    return { success: false, error: "No transactions selected" };

  try {
    const { affectedAccountIds, deletedCount } = await deleteTransactionsViaBackend(
      userId,
      transactionIds,
    );

    revalidatePath("/transactions");
    revalidatePath("/");
    revalidatePath("/settings");
    revalidatePath("/assets");
    revalidatePath("/subscriptions");

    return { success: true, affectedAccountIds, deletedCount };
  } catch (error) {
    logger.error("Failed to delete transactions", { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete transactions",
    };
  }
}

/**
 * Generates an AI narrative summary of transactions for the current
 * filter/date-range via backend /api/llm/transactions-summary. Uses
 * getFilteredTotals (unconditional, unlike getPage's gated filteredTotals)
 * so a summary is available even on the unfiltered default view.
 * User-triggered only — never called on page load.
 */
export async function getTransactionsPeriodAiSummary(
  queryState: TransactionsQueryState,
): Promise<{ success: boolean; summary?: string; error?: string }> {
  const session = await getAuthenticatedSession();
  if (!session?.user?.id) return { success: false, error: "Not authenticated" };

  const [userRows, totals] = await Promise.all([
    db
      .select({ functionalCurrency: users.functionalCurrency })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1),
    getFilteredTotals(session.user.id, queryState),
  ]);
  const currency = userRows[0]?.functionalCurrency || "EUR";

  try {
    const pathWithQuery = "/api/llm/transactions-summary";
    const requestBody = JSON.stringify({
      currency,
      date_from: totals.resolvedFrom || "",
      date_to: totals.resolvedTo || "",
      total_in: totals.totalIn,
      total_out: totals.totalOut,
    });
    const response = await fetch(`${getBackendBaseUrl()}${pathWithQuery}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...createInternalAuthHeaders({
          method: "POST",
          pathWithQuery,
          userId: session.user.id,
          body: requestBody,
        }),
      },
      body: requestBody,
      cache: "no-store",
    });
    const payload = (await response.json()) as { summary?: string; detail?: string };
    if (!response.ok || !payload.summary) {
      return { success: false, error: payload.detail || "Failed to generate summary" };
    }
    return { success: true, summary: payload.summary };
  } catch (error) {
    logger.error("Failed to generate transactions AI summary", { error });
    return { success: false, error: "Failed to generate summary" };
  }
}
