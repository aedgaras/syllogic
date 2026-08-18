"use server";

import { revalidatePath } from "next/cache";
import {
  eq,
  and,
  isNull,
  desc,
  asc,
  sql,
  inArray,
  gte,
  lt,
  or,
  ne,
} from "drizzle-orm";
import { db } from "@/lib/db";
import {
  recurringTransactions,
  transactions,
  categories,
  accounts,
  type NewRecurringTransaction,
} from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth-helpers";
import type {
  MatchedTransaction,
  LinkedSubscriptionTransaction,
  PotentialMatch,
  SubscriptionCreateInput,
  SubscriptionDetectionResult,
  SubscriptionFrequency,
  SubscriptionKpis,
  SubscriptionUpdateInput,
  SubscriptionViewModel,
} from "@/features/subscriptions/public";
import {
  monthlyEquivalent,
  validateSubscriptionInput,
} from "@/features/subscriptions/public";
import {
  calculateStringSimilarity,
  detectFrequencyFromGaps,
  scoreSubscriptionMatch,
} from "@/features/subscriptions/domain/matching";

export type {
  MatchedTransaction,
  LinkedSubscriptionTransaction,
  PotentialMatch,
  SubscriptionCreateInput,
  SubscriptionDetectionResult,
  SubscriptionFrequency,
  SubscriptionKpis,
  SubscriptionUpdateInput,
  SubscriptionViewModel as Subscription,
} from "@/features/subscriptions/public";

type SubscriptionRow = typeof recurringTransactions.$inferSelect & {
  account?: { id: string; name: string } | null;
  category?: { id: string; name: string; color: string | null } | null;
  logo?: { id: string; logoUrl: string | null; updatedAt?: Date | null } | null;
};

function toSubscriptionViewModel(row: SubscriptionRow): SubscriptionViewModel {
  return {
    id: row.id,
    accountId: row.accountId,
    name: row.name,
    merchant: row.merchant,
    amount: row.amount,
    currency: row.currency,
    categoryId: row.categoryId,
    logoId: row.logoId,
    importance: row.importance,
    frequency: row.frequency as SubscriptionFrequency,
    isActive: row.isActive,
    description: row.description,
    nextDueDate: row.nextDueDate,
    endDate: row.endDate,
    autoGenerate: row.autoGenerate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    account: row.account
      ? { id: row.account.id, name: row.account.name }
      : null,
    category: row.category
      ? {
          id: row.category.id,
          name: row.category.name,
          color: row.category.color,
        }
      : null,
    logo: row.logo
      ? {
          id: row.logo.id,
          logoUrl: row.logo.logoUrl,
          updatedAt: row.logo.updatedAt,
        }
      : null,
  };
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Create a new subscription
 */
export async function createSubscription(
  input: SubscriptionCreateInput,
): Promise<{
  success: boolean;
  error?: string;
  subscriptionId?: string;
  subscription?: SubscriptionViewModel;
}> {
  const userId = await requireAuth();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const validationError = validateSubscriptionInput(input);
    if (validationError) return { success: false, error: validationError };

    if (input.autoGenerate && !input.nextDueDate) {
      return {
        success: false,
        error: "Next due date is required to auto-generate transactions",
      };
    }

    if (
      input.endDate &&
      input.nextDueDate &&
      input.endDate < input.nextDueDate
    ) {
      return { success: false, error: "End date must be after next due date" };
    }

    const account = await db.query.accounts.findFirst({
      where: and(eq(accounts.id, input.accountId), eq(accounts.userId, userId)),
    });

    if (!account) {
      return { success: false, error: "Invalid account" };
    }

    // Validate category belongs to user if provided
    if (input.categoryId) {
      const category = await db.query.categories.findFirst({
        where: and(
          eq(categories.id, input.categoryId),
          eq(categories.userId, userId),
        ),
      });

      if (!category) {
        return { success: false, error: "Invalid category" };
      }
    }

    // Check for duplicate name
    const existing = await db.query.recurringTransactions.findFirst({
      where: and(
        eq(recurringTransactions.userId, userId),
        eq(recurringTransactions.accountId, input.accountId),
        eq(recurringTransactions.name, input.name.trim()),
      ),
    });

    if (existing) {
      return {
        success: false,
        error: "A subscription with this name already exists",
      };
    }

    // Create subscription
    const [created] = await db
      .insert(recurringTransactions)
      .values({
        userId,
        accountId: input.accountId,
        name: input.name.trim(),
        merchant: input.merchant?.trim() || null,
        amount: input.amount.toFixed(2),
        currency: input.currency || "EUR",
        categoryId: input.categoryId || null,
        logoId: input.logoId || null,
        importance: input.importance,
        frequency: input.frequency,
        description: input.description?.trim() || null,
        nextDueDate: input.nextDueDate || null,
        endDate: input.endDate || null,
        autoGenerate: input.autoGenerate ?? false,
      })
      .returning({ id: recurringTransactions.id });

    const subscription = await db.query.recurringTransactions.findFirst({
      where: and(
        eq(recurringTransactions.id, created.id),
        eq(recurringTransactions.userId, userId),
      ),
      with: {
        account: true,
        category: true,
        logo: true,
      },
    });

    revalidatePath("/subscriptions");
    return {
      success: true,
      subscriptionId: created.id,
      subscription: subscription
        ? toSubscriptionViewModel(subscription)
        : undefined,
    };
  } catch (error) {
    console.error("Failed to create subscription:", error);
    return { success: false, error: "Failed to create subscription" };
  }
}

/**
 * Update an existing subscription
 */
export async function updateSubscription(
  id: string,
  input: SubscriptionUpdateInput,
): Promise<{ success: boolean; error?: string }> {
  const userId = await requireAuth();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    // Verify ownership
    const existing = await db.query.recurringTransactions.findFirst({
      where: and(
        eq(recurringTransactions.id, id),
        eq(recurringTransactions.userId, userId),
      ),
    });

    if (!existing) {
      return { success: false, error: "Subscription not found" };
    }

    // Validate inputs
    if (input.amount !== undefined && input.amount <= 0) {
      return { success: false, error: "Amount must be greater than 0" };
    }

    if (
      input.importance !== undefined &&
      (input.importance < 1 || input.importance > 3)
    ) {
      return { success: false, error: "Importance must be between 1 and 3" };
    }

    const targetAutoGenerate = input.autoGenerate ?? existing.autoGenerate;
    const targetNextDueDate =
      input.nextDueDate !== undefined ? input.nextDueDate : existing.nextDueDate;
    const targetEndDate =
      input.endDate !== undefined ? input.endDate : existing.endDate;

    if (targetAutoGenerate && !targetNextDueDate) {
      return {
        success: false,
        error: "Next due date is required to auto-generate transactions",
      };
    }

    if (targetEndDate && targetNextDueDate && targetEndDate < targetNextDueDate) {
      return { success: false, error: "End date must be after next due date" };
    }

    // Validate category if changing
    if (input.categoryId) {
      const category = await db.query.categories.findFirst({
        where: and(
          eq(categories.id, input.categoryId),
          eq(categories.userId, userId),
        ),
      });

      if (!category) {
        return { success: false, error: "Invalid category" };
      }
    }

    if (input.accountId) {
      const account = await db.query.accounts.findFirst({
        where: and(
          eq(accounts.id, input.accountId),
          eq(accounts.userId, userId),
        ),
      });

      if (!account) {
        return { success: false, error: "Invalid account" };
      }
    }

    // Check for duplicate name if changing
    const targetName = input.name?.trim() ?? existing.name;
    const targetAccountId = input.accountId ?? existing.accountId;
    const duplicateAccountCondition = targetAccountId
      ? eq(recurringTransactions.accountId, targetAccountId)
      : isNull(recurringTransactions.accountId);
    if (
      targetName !== existing.name ||
      targetAccountId !== existing.accountId
    ) {
      const duplicate = await db.query.recurringTransactions.findFirst({
        where: and(
          eq(recurringTransactions.userId, userId),
          duplicateAccountCondition,
          eq(recurringTransactions.name, targetName),
        ),
      });

      if (duplicate && duplicate.id !== existing.id) {
        return {
          success: false,
          error: "A subscription with this name already exists",
        };
      }
    }

    // Build update object
    const updateData: Partial<NewRecurringTransaction> = {
      updatedAt: new Date(),
    };

    if (input.name !== undefined) updateData.name = input.name.trim();
    if (input.merchant !== undefined)
      updateData.merchant = input.merchant.trim() || null;
    if (input.amount !== undefined) updateData.amount = input.amount.toFixed(2);
    if (input.currency !== undefined) updateData.currency = input.currency;
    if (input.categoryId !== undefined)
      updateData.categoryId = input.categoryId || null;
    if (input.accountId !== undefined)
      updateData.accountId = input.accountId || null;
    if (input.logoId !== undefined) updateData.logoId = input.logoId || null;
    if (input.importance !== undefined)
      updateData.importance = input.importance;
    if (input.frequency !== undefined) updateData.frequency = input.frequency;
    if (input.description !== undefined)
      updateData.description = input.description?.trim() || null;
    if (input.isActive !== undefined) updateData.isActive = input.isActive;
    if (input.nextDueDate !== undefined)
      updateData.nextDueDate = input.nextDueDate || null;
    if (input.endDate !== undefined) updateData.endDate = input.endDate || null;
    if (input.autoGenerate !== undefined)
      updateData.autoGenerate = input.autoGenerate;

    // Update
    await db
      .update(recurringTransactions)
      .set(updateData)
      .where(eq(recurringTransactions.id, id));

    revalidatePath("/subscriptions");
    revalidatePath("/transactions");
    return { success: true };
  } catch (error) {
    console.error("Failed to update subscription:", error);
    return { success: false, error: "Failed to update subscription" };
  }
}

/**
 * Delete a subscription
 */
export async function deleteSubscription(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const userId = await requireAuth();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    // Verify ownership
    const existing = await db.query.recurringTransactions.findFirst({
      where: and(
        eq(recurringTransactions.id, id),
        eq(recurringTransactions.userId, userId),
      ),
    });

    if (!existing) {
      return { success: false, error: "Subscription not found" };
    }

    // Delete (linked transactions will have recurringTransactionId set to null due to onDelete: "set null")
    await db
      .delete(recurringTransactions)
      .where(eq(recurringTransactions.id, id));

    revalidatePath("/subscriptions");
    revalidatePath("/transactions");
    return { success: true };
  } catch (error) {
    console.error("Failed to delete subscription:", error);
    return { success: false, error: "Failed to delete subscription" };
  }
}

/**
 * Toggle active status of a subscription
 */
export async function toggleSubscriptionActive(
  id: string,
  isActive: boolean,
): Promise<{ success: boolean; error?: string }> {
  const userId = await requireAuth();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    // Verify ownership
    const existing = await db.query.recurringTransactions.findFirst({
      where: and(
        eq(recurringTransactions.id, id),
        eq(recurringTransactions.userId, userId),
      ),
    });

    if (!existing) {
      return { success: false, error: "Subscription not found" };
    }

    // Update active status
    await db
      .update(recurringTransactions)
      .set({
        isActive,
        updatedAt: new Date(),
      })
      .where(eq(recurringTransactions.id, id));

    revalidatePath("/subscriptions");
    return { success: true };
  } catch (error) {
    console.error("Failed to toggle subscription active status:", error);
    return { success: false, error: "Failed to update status" };
  }
}

/**
 * Get all subscriptions for the current user
 */
export async function getSubscriptions(
  includeInactive = false,
): Promise<SubscriptionViewModel[]> {
  const userId = await requireAuth();

  if (!userId) {
    return [];
  }

  try {
    const whereConditions = includeInactive
      ? eq(recurringTransactions.userId, userId)
      : and(
          eq(recurringTransactions.userId, userId),
          eq(recurringTransactions.isActive, true),
        );

    const results = await db.query.recurringTransactions.findMany({
      where: whereConditions,
      with: {
        account: true,
        category: true,
        logo: true,
      },
      orderBy: [
        desc(recurringTransactions.importance),
        asc(recurringTransactions.name),
      ],
    });

    return results.map(toSubscriptionViewModel);
  } catch (error) {
    console.error("Failed to get subscriptions:", error);
    return [];
  }
}

/**
 * Get subscription KPI metrics for the current user
 */
export async function getSubscriptionKpis(): Promise<SubscriptionKpis> {
  const userId = await requireAuth();

  if (!userId) {
    return {
      activeCount: 0,
      monthlyTotal: 0,
      allTimeTotal: 0,
      currency: "EUR",
    };
  }

  try {
    const activeSubscriptions = await db.query.recurringTransactions.findMany({
      where: and(
        eq(recurringTransactions.userId, userId),
        eq(recurringTransactions.isActive, true),
      ),
      columns: {
        amount: true,
        currency: true,
        frequency: true,
      },
    });

    const monthlyTotal = activeSubscriptions.reduce(
      (sumValue, subscription) => {
        return (
          sumValue +
          monthlyEquivalent(subscription.amount, subscription.frequency)
        );
      },
      0,
    );

    const currency =
      activeSubscriptions.find((sub) => sub.currency)?.currency || "EUR";

    const allTimeResult = await db
      .select({
        total: sql<number>`COALESCE(SUM(ABS(${transactions.amount})), 0)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          sql`${transactions.recurringTransactionId} is not null`,
        ),
      );

    const allTimeTotal = allTimeResult[0]?.total ?? 0;

    return {
      activeCount: activeSubscriptions.length,
      monthlyTotal,
      allTimeTotal,
      currency,
    };
  } catch (error) {
    console.error("Failed to get subscription KPIs:", error);
    return {
      activeCount: 0,
      monthlyTotal: 0,
      allTimeTotal: 0,
      currency: "EUR",
    };
  }
}

/**
 * Get a single subscription by ID
 */
export async function getSubscription(
  id: string,
): Promise<SubscriptionViewModel | null> {
  const userId = await requireAuth();

  if (!userId) {
    return null;
  }

  try {
    const result = await db.query.recurringTransactions.findFirst({
      where: and(
        eq(recurringTransactions.id, id),
        eq(recurringTransactions.userId, userId),
      ),
      with: {
        account: true,
        category: true,
        logo: true,
      },
    });

    return result ? toSubscriptionViewModel(result) : null;
  } catch (error) {
    console.error("Failed to get subscription:", error);
    return null;
  }
}

// ============================================================================
// Matching & Linking Operations
// ============================================================================

/**
 * Find potential matches between unlinked transactions and active subscriptions
 */
export async function findPotentialMatches(): Promise<PotentialMatch[]> {
  const userId = await requireAuth();

  if (!userId) {
    return [];
  }

  try {
    // Get active subscriptions
    const activeSubscriptions = await db.query.recurringTransactions.findMany({
      where: and(
        eq(recurringTransactions.userId, userId),
        eq(recurringTransactions.isActive, true),
      ),
    });

    if (activeSubscriptions.length === 0) {
      return [];
    }

    // Get unlinked transactions from last 90 days
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const unlinkedTransactions = await db.query.transactions.findMany({
      where: and(
        eq(transactions.userId, userId),
        isNull(transactions.recurringTransactionId),
        sql`${transactions.bookedAt} >= ${ninetyDaysAgo}`,
      ),
      with: {
        account: true,
      },
      orderBy: [desc(transactions.bookedAt)],
      limit: 500, // Limit for performance
    });

    if (unlinkedTransactions.length === 0) {
      return [];
    }

    // Find matches
    const matches: PotentialMatch[] = [];

    for (const subscription of activeSubscriptions) {
      for (const transaction of unlinkedTransactions) {
        if (
          subscription.accountId &&
          transaction.accountId !== subscription.accountId
        ) {
          continue;
        }

        const { score: matchScore, reason: matchReason } =
          scoreSubscriptionMatch(subscription, transaction);

        // Only include matches with score >= 50
        if (matchScore >= 50) {
          matches.push({
            transactionId: transaction.id,
            subscriptionId: subscription.id,
            transaction: {
              id: transaction.id,
              merchant: transaction.merchant,
              amount: transaction.amount,
              description: transaction.description,
              bookedAt: transaction.bookedAt,
              accountName: transaction.account?.name || "Unknown",
            },
            subscription: {
              id: subscription.id,
              name: subscription.name,
              merchant: subscription.merchant,
              amount: subscription.amount,
            },
            matchScore,
            matchReason,
          });
        }
      }
    }

    // Sort by match score descending
    matches.sort((a, b) => b.matchScore - a.matchScore);

    // Return top 50 matches
    return matches.slice(0, 50);
  } catch (error) {
    console.error("Failed to find potential matches:", error);
    return [];
  }
}

/**
 * Link a transaction to a subscription
 */
export async function linkTransactionToSubscription(
  transactionId: string,
  subscriptionId: string,
): Promise<{ success: boolean; error?: string }> {
  const userId = await requireAuth();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    // Verify both records belong to user
    const [transaction, subscription] = await Promise.all([
      db.query.transactions.findFirst({
        where: and(
          eq(transactions.id, transactionId),
          eq(transactions.userId, userId),
        ),
      }),
      db.query.recurringTransactions.findFirst({
        where: and(
          eq(recurringTransactions.id, subscriptionId),
          eq(recurringTransactions.userId, userId),
        ),
      }),
    ]);

    if (!transaction) {
      return { success: false, error: "Transaction not found" };
    }

    if (!subscription) {
      return { success: false, error: "Subscription not found" };
    }

    if (
      subscription.accountId &&
      transaction.accountId !== subscription.accountId
    ) {
      return {
        success: false,
        error: "Transaction account does not match this subscription account",
      };
    }

    // Link the transaction
    await db
      .update(transactions)
      .set({
        recurringTransactionId: subscriptionId,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, transactionId));

    revalidatePath("/transactions");
    revalidatePath("/subscriptions");
    return { success: true };
  } catch (error) {
    console.error("Failed to link transaction:", error);
    return { success: false, error: "Failed to link transaction" };
  }
}

/**
 * Unlink a transaction from its subscription
 */
export async function unlinkTransactionFromSubscription(
  transactionId: string,
): Promise<{ success: boolean; error?: string }> {
  const userId = await requireAuth();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    // Verify transaction belongs to user
    const transaction = await db.query.transactions.findFirst({
      where: and(
        eq(transactions.id, transactionId),
        eq(transactions.userId, userId),
      ),
    });

    if (!transaction) {
      return { success: false, error: "Transaction not found" };
    }

    // Unlink the transaction
    await db
      .update(transactions)
      .set({
        recurringTransactionId: null,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, transactionId));

    revalidatePath("/transactions");
    revalidatePath("/subscriptions");
    return { success: true };
  } catch (error) {
    console.error("Failed to unlink transaction:", error);
    return { success: false, error: "Failed to unlink transaction" };
  }
}

/**
 * Bulk link multiple transactions to subscriptions
 */
export async function bulkLinkTransactions(
  links: Array<{ transactionId: string; subscriptionId: string }>,
): Promise<{ success: boolean; error?: string; linkedCount?: number }> {
  const userId = await requireAuth();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  if (links.length === 0) {
    return { success: true, linkedCount: 0 };
  }

  try {
    // Verify all transactions and subscriptions belong to user
    const transactionIds = links.map((l) => l.transactionId);
    const subscriptionIds = [...new Set(links.map((l) => l.subscriptionId))];

    const [userTransactions, userSubscriptions] = await Promise.all([
      db.query.transactions.findMany({
        where: and(
          inArray(transactions.id, transactionIds),
          eq(transactions.userId, userId),
        ),
      }),
      db.query.recurringTransactions.findMany({
        where: and(
          inArray(recurringTransactions.id, subscriptionIds),
          eq(recurringTransactions.userId, userId),
        ),
      }),
    ]);

    // Create sets for quick lookup
    const validTransactionIds = new Set(userTransactions.map((t) => t.id));
    const validSubscriptionIds = new Set(userSubscriptions.map((r) => r.id));
    const transactionById = new Map(userTransactions.map((t) => [t.id, t]));
    const subscriptionById = new Map(userSubscriptions.map((r) => [r.id, r]));

    // Filter to valid links only
    const validLinks = links.filter((link) => {
      if (
        !validTransactionIds.has(link.transactionId) ||
        !validSubscriptionIds.has(link.subscriptionId)
      ) {
        return false;
      }

      const transaction = transactionById.get(link.transactionId);
      const subscription = subscriptionById.get(link.subscriptionId);
      if (!transaction || !subscription) {
        return false;
      }

      if (
        subscription.accountId &&
        subscription.accountId !== transaction.accountId
      ) {
        return false;
      }

      return true;
    });

    if (validLinks.length === 0) {
      return { success: false, error: "No valid links found" };
    }

    // Perform bulk update
    let linkedCount = 0;
    for (const link of validLinks) {
      await db
        .update(transactions)
        .set({
          recurringTransactionId: link.subscriptionId,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, link.transactionId));
      linkedCount++;
    }

    revalidatePath("/transactions");
    revalidatePath("/subscriptions");
    return { success: true, linkedCount };
  } catch (error) {
    console.error("Failed to bulk link transactions:", error);
    return { success: false, error: "Failed to link transactions" };
  }
}

/**
 * Match transactions to a subscription based on description and amount similarity.
 * Updates the recurring_transaction_id field for matched transactions.
 */
export async function matchTransactionsToSubscription(
  subscriptionId: string,
  descriptionSimilarityThreshold: number = 0.6,
  amountTolerancePercent: number = 0.05,
): Promise<{
  success: boolean;
  error?: string;
  matchedCount?: number;
  transactionIds?: string[];
}> {
  const userId = await requireAuth();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const subscription = await db.query.recurringTransactions.findFirst({
      where: and(
        eq(recurringTransactions.id, subscriptionId),
        eq(recurringTransactions.userId, userId),
      ),
    });

    if (!subscription) {
      return { success: false, error: "Subscription not found" };
    }

    const recurringMismatchCondition = or(
      isNull(transactions.recurringTransactionId),
      ne(transactions.recurringTransactionId, subscriptionId),
    );
    const candidateWhere = subscription.accountId
      ? and(
          eq(transactions.userId, userId),
          eq(transactions.accountId, subscription.accountId),
          recurringMismatchCondition,
        )
      : and(eq(transactions.userId, userId), recurringMismatchCondition);

    const candidateTransactions = await db.query.transactions.findMany({
      where: candidateWhere,
      orderBy: [desc(transactions.bookedAt)],
      limit: 2000,
    });

    const subscriptionAmount = Math.abs(parseFloat(subscription.amount || "0"));
    const matchedTransactionIds: string[] = [];

    for (const txn of candidateTransactions) {
      const txnAmount = Math.abs(parseFloat(txn.amount || "0"));

      if (txnAmount === 0 || subscriptionAmount === 0) {
        continue;
      }

      const diff = Math.abs(subscriptionAmount - txnAmount);
      const avg = (subscriptionAmount + txnAmount) / 2;
      const percentDiff = avg === 0 ? 1 : diff / avg;

      if (percentDiff > amountTolerancePercent) {
        continue;
      }

      let bestScore = 0;

      if (subscription.merchant && txn.merchant) {
        bestScore = Math.max(
          bestScore,
          calculateStringSimilarity(subscription.merchant, txn.merchant),
        );
      }

      if (subscription.name && txn.description) {
        bestScore = Math.max(
          bestScore,
          calculateStringSimilarity(subscription.name, txn.description),
        );
      }

      if (subscription.name && txn.merchant) {
        bestScore = Math.max(
          bestScore,
          calculateStringSimilarity(subscription.name, txn.merchant),
        );
      }

      if (subscription.merchant && txn.description) {
        bestScore = Math.max(
          bestScore,
          calculateStringSimilarity(subscription.merchant, txn.description),
        );
      }

      if (bestScore / 100 < descriptionSimilarityThreshold) {
        continue;
      }

      matchedTransactionIds.push(txn.id);
    }

    if (matchedTransactionIds.length > 0) {
      await db
        .update(transactions)
        .set({
          recurringTransactionId: subscriptionId,
          updatedAt: new Date(),
        })
        .where(inArray(transactions.id, matchedTransactionIds));
    }

    revalidatePath("/transactions");
    revalidatePath("/subscriptions");

    return {
      success: true,
      matchedCount: matchedTransactionIds.length,
      transactionIds: matchedTransactionIds,
    };
  } catch (error) {
    console.error("Failed to match transactions:", error);
    return { success: false, error: "Failed to match transactions" };
  }
}

/**
 * Get cost aggregations for a subscription
 * Returns the sum of linked transactions for this year and all time
 */
export async function getSubscriptionCostAggregations(
  subscriptionId: string,
): Promise<{ thisYear: number; allTime: number }> {
  const userId = await requireAuth();

  if (!userId) {
    return { thisYear: 0, allTime: 0 };
  }

  try {
    // Verify subscription belongs to user
    const subscription = await db.query.recurringTransactions.findFirst({
      where: and(
        eq(recurringTransactions.id, subscriptionId),
        eq(recurringTransactions.userId, userId),
      ),
    });

    if (!subscription) {
      return { thisYear: 0, allTime: 0 };
    }

    // Get all linked transactions
    const linkedTransactions = await db.query.transactions.findMany({
      where: and(
        eq(transactions.userId, userId),
        eq(transactions.recurringTransactionId, subscriptionId),
      ),
    });

    // Calculate all time total
    const allTime = linkedTransactions.reduce((sum, txn) => {
      return sum + Math.abs(parseFloat(txn.amount || "0"));
    }, 0);

    // Calculate this year total
    const currentYear = new Date().getFullYear();
    const thisYear = linkedTransactions
      .filter((txn) => {
        const txnYear = txn.bookedAt
          ? new Date(txn.bookedAt).getFullYear()
          : null;
        return txnYear === currentYear;
      })
      .reduce((sum, txn) => {
        return sum + Math.abs(parseFloat(txn.amount || "0"));
      }, 0);

    return { thisYear, allTime };
  } catch (error) {
    console.error("Failed to get subscription cost aggregations:", error);
    return { thisYear: 0, allTime: 0 };
  }
}

/**
 * Get all transactions linked to a subscription
 */
export async function getLinkedTransactions(
  subscriptionId: string,
): Promise<LinkedSubscriptionTransaction[]> {
  const userId = await requireAuth();

  if (!userId) {
    return [];
  }

  try {
    // Verify subscription belongs to user
    const subscription = await db.query.recurringTransactions.findFirst({
      where: and(
        eq(recurringTransactions.id, subscriptionId),
        eq(recurringTransactions.userId, userId),
      ),
    });

    if (!subscription) {
      return [];
    }

    // Get linked transactions
    const linkedTransactions = await db.query.transactions.findMany({
      where: and(
        eq(transactions.userId, userId),
        eq(transactions.recurringTransactionId, subscriptionId),
      ),
      with: {
        account: true,
        category: true,
      },
      orderBy: [desc(transactions.bookedAt)],
    });

    return linkedTransactions.map((transaction) => ({
      id: transaction.id,
      merchant: transaction.merchant,
      description: transaction.description,
      amount: transaction.amount,
      bookedAt: transaction.bookedAt,
      account: transaction.account ? { name: transaction.account.name } : null,
      category: transaction.category
        ? {
            id: transaction.category.id,
            name: transaction.category.name,
            color: transaction.category.color,
          }
        : null,
    }));
  } catch (error) {
    console.error("Failed to get linked transactions:", error);
    return [];
  }
}

// ============================================================================
// Subscription Detection & Creation from Transaction
// ============================================================================

/**
 * Detect subscription pattern from a transaction
 * Finds similar historical transactions and detects the frequency
 */
export async function detectSubscriptionFromTransaction(
  transactionId: string,
): Promise<SubscriptionDetectionResult> {
  const userId = await requireAuth();

  if (!userId) {
    return {
      success: false,
      error: "Not authenticated",
      confidence: 0,
      matchedTransactions: [],
      suggestedName: "",
      suggestedAmount: 0,
      suggestedMerchant: null,
    };
  }

  try {
    // Get the source transaction
    const sourceTransaction = await db.query.transactions.findFirst({
      where: and(
        eq(transactions.id, transactionId),
        eq(transactions.userId, userId),
      ),
      with: {
        account: true,
      },
    });

    if (!sourceTransaction) {
      return {
        success: false,
        error: "Transaction not found",
        confidence: 0,
        matchedTransactions: [],
        suggestedName: "",
        suggestedAmount: 0,
        suggestedMerchant: null,
      };
    }

    // Look back 24 months for similar transactions
    const twoYearsAgo = new Date();
    twoYearsAgo.setMonth(twoYearsAgo.getMonth() - 24);

    // Get all expense transactions from the same account in the last 24 months
    const allTransactions = await db.query.transactions.findMany({
      where: and(
        eq(transactions.userId, userId),
        eq(transactions.accountId, sourceTransaction.accountId),
        gte(transactions.bookedAt, twoYearsAgo),
        lt(transactions.amount, "0"), // Only expenses
      ),
      orderBy: [asc(transactions.bookedAt)],
    });

    const sourceAmount = Math.abs(parseFloat(sourceTransaction.amount || "0"));
    const sourceMerchant =
      sourceTransaction.merchant?.toLowerCase().trim() || "";
    const sourceDescription =
      sourceTransaction.description?.toLowerCase().trim() || "";

    // Find similar transactions by merchant/description and amount
    const similarTransactions: MatchedTransaction[] = [];

    for (const txn of allTransactions) {
      // Skip the source transaction itself
      if (txn.id === transactionId) continue;

      const txnAmount = Math.abs(parseFloat(txn.amount || "0"));
      const txnMerchant = txn.merchant?.toLowerCase().trim() || "";
      const txnDescription = txn.description?.toLowerCase().trim() || "";

      // Amount matching (within 10% tolerance to account for minor currency conversion fluctuations)
      const amountDiff = Math.abs(sourceAmount - txnAmount);
      const amountTolerance = sourceAmount * 0.1;
      const amountMatches = amountDiff <= amountTolerance;

      if (!amountMatches) continue;

      // Merchant/description matching - improved algorithm
      // We check multiple combinations to ensure robust matching
      let textMatches = false;
      let bestSimilarity = 0;

      // 1. Merchant-to-merchant matching
      if (sourceMerchant && txnMerchant) {
        if (sourceMerchant === txnMerchant) {
          textMatches = true;
          bestSimilarity = 100;
        } else {
          const similarity = calculateStringSimilarity(
            sourceMerchant,
            txnMerchant,
          );
          if (similarity >= 70) {
            // Lowered from 80% to 70% for more forgiving matching
            textMatches = true;
            bestSimilarity = Math.max(bestSimilarity, similarity);
          }
          // Also check substring matching for merchants
          if (
            !textMatches &&
            sourceMerchant.length >= 4 &&
            txnMerchant.length >= 4
          ) {
            if (
              sourceMerchant.includes(txnMerchant) ||
              txnMerchant.includes(sourceMerchant)
            ) {
              textMatches = true;
              bestSimilarity = Math.max(bestSimilarity, 85);
            }
          }
        }
      }

      // 2. Description-to-description matching (always check if both exist)
      if (!textMatches && sourceDescription && txnDescription) {
        // Exact match
        if (sourceDescription === txnDescription) {
          textMatches = true;
          bestSimilarity = 100;
        } else {
          const similarity = calculateStringSimilarity(
            sourceDescription,
            txnDescription,
          );
          if (similarity >= 50) {
            // Lowered threshold from 60% to 50%
            textMatches = true;
            bestSimilarity = Math.max(bestSimilarity, similarity);
          }
          // Substring matching for short descriptions (like "Moneybird")
          if (
            !textMatches &&
            sourceDescription.length >= 4 &&
            txnDescription.length >= 4
          ) {
            if (
              sourceDescription.includes(txnDescription) ||
              txnDescription.includes(sourceDescription)
            ) {
              textMatches = true;
              bestSimilarity = Math.max(bestSimilarity, 80);
            }
          }
        }
      }

      // 3. Cross-matching: source description to candidate merchant
      if (!textMatches && sourceDescription && txnMerchant) {
        const similarity = calculateStringSimilarity(
          sourceDescription,
          txnMerchant,
        );
        if (similarity >= 60) {
          // Lowered from 70%
          textMatches = true;
          bestSimilarity = Math.max(bestSimilarity, similarity);
        }
        // Substring check
        if (!textMatches && sourceDescription.length >= 4) {
          if (
            sourceDescription.includes(txnMerchant) ||
            txnMerchant.includes(sourceDescription)
          ) {
            textMatches = true;
            bestSimilarity = Math.max(bestSimilarity, 75);
          }
        }
      }

      // 4. Cross-matching: source merchant to candidate description
      if (!textMatches && sourceMerchant && txnDescription) {
        const similarity = calculateStringSimilarity(
          sourceMerchant,
          txnDescription,
        );
        if (similarity >= 60) {
          // Lowered from 70%
          textMatches = true;
          bestSimilarity = Math.max(bestSimilarity, similarity);
        }
        // Substring check
        if (!textMatches && sourceMerchant.length >= 4) {
          if (
            sourceMerchant.includes(txnDescription) ||
            txnDescription.includes(sourceMerchant)
          ) {
            textMatches = true;
            bestSimilarity = Math.max(bestSimilarity, 75);
          }
        }
      }

      // 5. Fallback: Very close amounts with same day of month (likely same subscription with price change)
      // Only if we have SOME text match potential (at least one field in common)
      if (!textMatches && amountDiff <= sourceAmount * 0.03) {
        // Within 3% amount difference
        // Check if at least one text field has some overlap
        const hasAnyTextOverlap =
          (sourceMerchant &&
            txnMerchant &&
            calculateStringSimilarity(sourceMerchant, txnMerchant) >= 50) ||
          (sourceDescription &&
            txnDescription &&
            calculateStringSimilarity(sourceDescription, txnDescription) >=
              40) ||
          (sourceMerchant &&
            txnDescription &&
            txnDescription.includes(sourceMerchant)) ||
          (sourceDescription &&
            txnMerchant &&
            sourceDescription.includes(txnMerchant));

        if (hasAnyTextOverlap) {
          textMatches = true;
          bestSimilarity = Math.max(bestSimilarity, 60);
        }
      }

      if (textMatches) {
        similarTransactions.push({
          id: txn.id,
          amount: parseFloat(txn.amount || "0"),
          bookedAt: txn.bookedAt,
          merchant: txn.merchant,
          description: txn.description,
        });
      }
    }

    // Add source transaction to matched list
    const allMatched: MatchedTransaction[] = [
      {
        id: sourceTransaction.id,
        amount: parseFloat(sourceTransaction.amount || "0"),
        bookedAt: sourceTransaction.bookedAt,
        merchant: sourceTransaction.merchant,
        description: sourceTransaction.description,
      },
      ...similarTransactions,
    ];

    // Sort by date ascending (handle potential null dates gracefully)
    allMatched.sort((a, b) => {
      const dateA = a.bookedAt ? new Date(a.bookedAt).getTime() : 0;
      const dateB = b.bookedAt ? new Date(b.bookedAt).getTime() : 0;
      return dateA - dateB;
    });

    // Calculate suggested name and amount
    const suggestedName =
      sourceTransaction.merchant ||
      sourceTransaction.description?.substring(0, 50) ||
      "Subscription";
    const suggestedAmount = sourceAmount;
    const suggestedMerchant = sourceTransaction.merchant;

    // Need at least 2 matches for auto-detection
    if (allMatched.length < 2) {
      return {
        success: true,
        detectedFrequency: undefined,
        confidence: 0,
        matchedTransactions: allMatched,
        suggestedName,
        suggestedAmount,
        suggestedMerchant,
      };
    }

    // Calculate date gaps between consecutive transactions
    const gaps: number[] = [];
    for (let i = 1; i < allMatched.length; i++) {
      const prevBookedAt = allMatched[i - 1].bookedAt;
      const currBookedAt = allMatched[i].bookedAt;
      if (!prevBookedAt || !currBookedAt) continue;
      const prevDate = new Date(prevBookedAt);
      const currDate = new Date(currBookedAt);
      const daysDiff = Math.round(
        (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (!isNaN(daysDiff) && daysDiff > 0) {
        gaps.push(daysDiff);
      }
    }

    // Detect frequency
    const { frequency, confidence: gapConfidence } =
      detectFrequencyFromGaps(gaps);

    // Calculate overall confidence
    let confidence = gapConfidence;

    // Boost confidence based on match count (max +30 for 5+ matches)
    const matchBonus = Math.min(30, (allMatched.length - 1) * 10);
    confidence = Math.min(100, confidence + matchBonus);

    // Boost for exact merchant matches
    const exactMerchantMatches = similarTransactions.filter(
      (t) => t.merchant?.toLowerCase() === sourceMerchant,
    ).length;
    if (exactMerchantMatches > 0) {
      confidence = Math.min(100, confidence + 10);
    }

    return {
      success: true,
      detectedFrequency: frequency || undefined,
      confidence,
      matchedTransactions: allMatched,
      suggestedName,
      suggestedAmount,
      suggestedMerchant,
    };
  } catch (error) {
    console.error("Failed to detect subscription:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      error: `Failed to detect subscription pattern: ${errorMessage}`,
      confidence: 0,
      matchedTransactions: [],
      suggestedName: "",
      suggestedAmount: 0,
      suggestedMerchant: null,
    };
  }
}

/**
 * Input for creating a subscription from a transaction
 */
export interface CreateSubscriptionFromTransactionInput {
  transactionId: string;
  name: string;
  frequency: SubscriptionFrequency;
  categoryId?: string;
  importance?: number;
  matchedTransactionIds: string[];
}

/**
 * Create a subscription from a transaction and link all matched transactions
 */
export async function createSubscriptionFromTransaction(
  input: CreateSubscriptionFromTransactionInput,
): Promise<{
  success: boolean;
  error?: string;
  subscriptionId?: string;
  linkedCount?: number;
}> {
  const userId = await requireAuth();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    // Get the source transaction
    const sourceTransaction = await db.query.transactions.findFirst({
      where: and(
        eq(transactions.id, input.transactionId),
        eq(transactions.userId, userId),
      ),
    });

    if (!sourceTransaction) {
      return { success: false, error: "Transaction not found" };
    }

    // Validate inputs
    if (!input.name?.trim()) {
      return { success: false, error: "Name is required" };
    }

    const importance = input.importance ?? 2;
    if (importance < 1 || importance > 3) {
      return { success: false, error: "Importance must be between 1 and 3" };
    }

    // Validate category if provided
    if (input.categoryId) {
      const category = await db.query.categories.findFirst({
        where: and(
          eq(categories.id, input.categoryId),
          eq(categories.userId, userId),
        ),
      });

      if (!category) {
        return { success: false, error: "Invalid category" };
      }
    }

    // Check for duplicate name
    const existing = await db.query.recurringTransactions.findFirst({
      where: and(
        eq(recurringTransactions.userId, userId),
        eq(recurringTransactions.accountId, sourceTransaction.accountId),
        eq(recurringTransactions.name, input.name.trim()),
      ),
    });

    if (existing) {
      return {
        success: false,
        error: "A subscription with this name already exists",
      };
    }

    // Create the subscription
    const amount = Math.abs(parseFloat(sourceTransaction.amount));
    const [created] = await db
      .insert(recurringTransactions)
      .values({
        userId,
        accountId: sourceTransaction.accountId,
        name: input.name.trim(),
        merchant: sourceTransaction.merchant || null,
        amount: amount.toFixed(2),
        currency: sourceTransaction.currency || "EUR",
        categoryId: input.categoryId || sourceTransaction.categoryId || null,
        importance,
        frequency: input.frequency,
        description: null,
      })
      .returning({ id: recurringTransactions.id });

    // Link all matched transactions
    let linkedCount = 0;
    if (input.matchedTransactionIds.length > 0) {
      // Verify all transactions belong to user
      const userTxns = await db.query.transactions.findMany({
        where: and(
          inArray(transactions.id, input.matchedTransactionIds),
          eq(transactions.userId, userId),
        ),
      });

      const validIds = new Set(userTxns.map((t) => t.id));

      for (const txnId of input.matchedTransactionIds) {
        if (validIds.has(txnId)) {
          await db
            .update(transactions)
            .set({
              recurringTransactionId: created.id,
              updatedAt: new Date(),
            })
            .where(eq(transactions.id, txnId));
          linkedCount++;
        }
      }
    }

    revalidatePath("/transactions");
    revalidatePath("/subscriptions");

    return {
      success: true,
      subscriptionId: created.id,
      linkedCount,
    };
  } catch (error) {
    console.error("Failed to create subscription from transaction:", error);
    return { success: false, error: "Failed to create subscription" };
  }
}
