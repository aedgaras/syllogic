"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import {
  getAccountsForLinkingViaBackend,
  createLinkGroupViaBackend,
  addTransactionToLinkGroupViaBackend,
  removeTransactionFromLinkGroupViaBackend,
  deleteLinkGroupViaBackend,
  getTransactionLinkGroupViaBackend,
  getUserLinkGroupsViaBackend,
  findPotentialReimbursementsViaBackend,
  findPotentialExpensesViaBackend,
  getTransactionLinkInfoViaBackend,
  createLinkGroupFromSelectionViaBackend,
} from "@/lib/actions/transaction-links.gateway";

export type LinkRole = "primary" | "reimbursement" | "expense";

export interface TransactionLinkInfo {
  id: string;
  groupId: string;
  transactionId: string;
  linkRole: LinkRole;
  createdAt: Date | null;
}

export interface LinkedTransaction {
  id: string;
  amount: number;
  description: string | null;
  merchant: string | null;
  bookedAt: Date;
  transactionType: string | null;
  linkRole: LinkRole;
}

export interface TransactionLinkGroup {
  groupId: string;
  primary: LinkedTransaction | null;
  linked: LinkedTransaction[];
  netAmount: number;
  currency: string | null;
}

export interface SuggestedLink {
  id: string;
  amount: number;
  description: string | null;
  merchant: string | null;
  bookedAt: Date;
  transactionType: string | null;
  accountId: string;
  accountName: string | null;
  score: number; // Match confidence score
}

export interface LinkSearchFilters {
  searchQuery?: string;
  accountId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  minAmount?: number;
  maxAmount?: number;
  page?: number;
  pageSize?: number;
}

export interface LinkSearchResult {
  transactions: SuggestedLink[];
  totalCount: number;
  hasMore: boolean;
}

export interface AccountOption {
  id: string;
  name: string;
}

/**
 * Gets all user accounts for filter dropdown.
 */
export async function getUserAccountsForLinking(): Promise<AccountOption[]> {
  const userId = await requireAuth();

  if (!userId) {
    return [];
  }

  try {
    return await getAccountsForLinkingViaBackend(userId);
  } catch (error) {
    logger.error("Failed to get user accounts", { error });
    return [];
  }
}

/**
 * Creates a new transaction link group with a primary transaction and linked transactions.
 */
export async function createTransactionLinkGroup(
  primaryId: string,
  linkedIds: string[],
  linkType: "reimbursement" | "expense",
): Promise<{ success: boolean; error?: string; groupId?: string }> {
  const userId = await requireAuth();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  if (linkedIds.length === 0) {
    return {
      success: false,
      error: "At least one linked transaction is required",
    };
  }

  try {
    const { groupId } = await createLinkGroupViaBackend(userId, primaryId, linkedIds, linkType);

    revalidatePath("/transactions");
    revalidatePath("/");
    return { success: true, groupId };
  } catch (error) {
    logger.error("Failed to create transaction link group", { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create link group",
    };
  }
}

/**
 * Adds a transaction to an existing link group.
 */
export async function addTransactionToLinkGroup(
  groupId: string,
  transactionId: string,
  role: LinkRole,
): Promise<{ success: boolean; error?: string }> {
  const userId = await requireAuth();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    await addTransactionToLinkGroupViaBackend(userId, groupId, transactionId, role);

    revalidatePath("/transactions");
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    logger.error("Failed to add transaction to link group", { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to add transaction to group",
    };
  }
}

/**
 * Removes a transaction from its link group.
 * If it's the primary transaction or the last one, deletes the entire group.
 */
export async function removeTransactionFromLinkGroup(
  transactionId: string,
): Promise<{ success: boolean; error?: string; groupDeleted?: boolean }> {
  const userId = await requireAuth();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const { groupDeleted } = await removeTransactionFromLinkGroupViaBackend(
      userId,
      transactionId,
    );

    revalidatePath("/transactions");
    revalidatePath("/");
    return { success: true, groupDeleted };
  } catch (error) {
    logger.error("Failed to remove transaction from link group", { error });
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to remove transaction from group",
    };
  }
}

/**
 * Deletes an entire link group.
 */
export async function deleteLinkGroup(
  groupId: string,
): Promise<{ success: boolean; error?: string }> {
  const userId = await requireAuth();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    await deleteLinkGroupViaBackend(userId, groupId);

    revalidatePath("/transactions");
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    logger.error("Failed to delete link group", { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete link group",
    };
  }
}

/**
 * Gets the link group for a transaction, including all linked transactions and net amount.
 */
export async function getTransactionLinkGroup(
  transactionId: string,
): Promise<TransactionLinkGroup | null> {
  const userId = await requireAuth();

  if (!userId) {
    return null;
  }

  try {
    return await getTransactionLinkGroupViaBackend(userId, transactionId);
  } catch (error) {
    logger.error("Failed to get transaction link group", { error });
    return null;
  }
}

/**
 * Gets all link groups for the current user.
 */
export async function getUserLinkGroups(): Promise<TransactionLinkGroup[]> {
  const userId = await requireAuth();

  if (!userId) {
    return [];
  }

  try {
    return await getUserLinkGroupsViaBackend(userId);
  } catch (error) {
    logger.error("Failed to get user link groups", { error });
    return [];
  }
}

/**
 * Finds potential reimbursement transactions for an expense.
 * Returns credits across all accounts with server-side filtering and pagination.
 */
export async function findPotentialReimbursements(
  transactionId: string,
  filters: LinkSearchFilters = {},
): Promise<LinkSearchResult> {
  const userId = await requireAuth();

  if (!userId) {
    return { transactions: [], totalCount: 0, hasMore: false };
  }

  try {
    return await findPotentialReimbursementsViaBackend(userId, transactionId, filters);
  } catch (error) {
    logger.error("Failed to find potential reimbursements", { error });
    return { transactions: [], totalCount: 0, hasMore: false };
  }
}

/**
 * Finds potential expense transactions for an income/allowance.
 * Returns debits across all accounts with server-side filtering and pagination.
 */
export async function findPotentialExpenses(
  transactionId: string,
  filters: LinkSearchFilters = {},
): Promise<LinkSearchResult> {
  const userId = await requireAuth();

  if (!userId) {
    return { transactions: [], totalCount: 0, hasMore: false };
  }

  try {
    return await findPotentialExpensesViaBackend(userId, transactionId, filters);
  } catch (error) {
    logger.error("Failed to find potential expenses", { error });
    return { transactions: [], totalCount: 0, hasMore: false };
  }
}

/**
 * Gets the link info for a single transaction.
 */
export async function getTransactionLinkInfo(
  transactionId: string,
): Promise<TransactionLinkInfo | null> {
  const userId = await requireAuth();

  if (!userId) {
    return null;
  }

  try {
    return await getTransactionLinkInfoViaBackend(userId, transactionId);
  } catch (error) {
    logger.error("Failed to get transaction link info", { error });
    return null;
  }
}

/**
 * Bulk creates a link group from multiple selected transactions.
 * Auto-detects the primary (largest expense or income) and assigns roles.
 */
export async function createLinkGroupFromSelection(
  transactionIds: string[],
): Promise<{ success: boolean; error?: string; groupId?: string }> {
  const userId = await requireAuth();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  if (transactionIds.length < 2) {
    return { success: false, error: "At least 2 transactions are required" };
  }

  try {
    const { groupId } = await createLinkGroupFromSelectionViaBackend(userId, transactionIds);

    revalidatePath("/transactions");
    revalidatePath("/");
    return { success: true, groupId };
  } catch (error) {
    logger.error("Failed to create link group from selection", { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create link group",
    };
  }
}
