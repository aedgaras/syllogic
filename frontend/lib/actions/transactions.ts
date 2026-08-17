"use server";

import { revalidatePath } from "next/cache";
import { eq, and, desc, inArray, notInArray, sql, gte, lte, gt, asc, ne, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions, accounts, categories, accountBalances, exchangeRates, internalTransfers, users } from "@/lib/db/schema";
import { requireAuth, getAuthenticatedSession } from "@/lib/auth-helpers";
import { isDemoRestrictedUserEmail, DEMO_RESTRICTED_ACTION_ERROR } from "@/lib/demo-access";
import { getBackendBaseUrl } from "@/lib/backend-url";
import { createInternalAuthHeaders } from "@/lib/internal-auth";
import type {
  ConvertTransactionToTransferInput,
  CreateTransactionInput,
  CreateTransferTransactionInput,
  TransactionWithRelations,
  UpdateTransactionInput,
} from "@/features/transactions/public";
import {
  hydrateResolvedAccountLogos as hydrateTransactionRowsWithResolvedAccountLogos,
  mapTransactionRowsForUi,
} from "@/features/transactions/server";

export type {
  ConvertTransactionToTransferInput,
  CreateTransactionInput,
  CreateTransferTransactionInput,
  FilteredTransactionTotals,
  TransactionWithRelations,
  TransactionsPageResult,
  UpdateTransactionInput,
} from "@/features/transactions/public";

/**
 * Recalculates account_balances records from a given date.
 * Stops at the earlier of:
 * - The next balancing transfer date (exclusive - day before)
 * - The most recent date in account_balances table (if no balancing transfers ahead)
 *
 * @param accountId - The account to recalculate balances for
 * @param fromDate - The starting date for recalculation
 * @param startingBalance - The account's starting balance
 * @param excludeTransactionId - Optional transaction ID to exclude (when deleting)
 */
async function recalculateAccountBalancesFromDate(
  accountId: string,
  fromDate: Date,
  startingBalance: number,
  excludeTransactionId?: string
): Promise<void> {
  // Normalize fromDate to start of day
  const startDate = new Date(fromDate);
  startDate.setHours(0, 0, 0, 0);

  // Get the "Balancing Transfer" category ID for this account's user
  const account = await db.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
  });

  if (!account) {
    console.error("Account not found for balance recalculation");
    return;
  }

  const balancingCategory = await db.query.categories.findFirst({
    where: and(
      eq(categories.userId, account.userId),
      eq(categories.name, "Balancing Transfer")
    ),
  });

  // Find the next balancing transfer AFTER fromDate
  // Use the original fromDate (exact timestamp), not startDate (beginning of day)
  // This ensures we don't find the transaction we just created as the "next" one
  let nextBalancingTransferDate: Date | null = null;
  if (balancingCategory) {
    const conditions = [
      eq(transactions.accountId, accountId),
      eq(transactions.categoryId, balancingCategory.id),
      gt(transactions.bookedAt, fromDate)
    ];

    // Exclude the transaction being deleted if provided
    if (excludeTransactionId) {
      conditions.push(ne(transactions.id, excludeTransactionId));
    }

    const nextBalancingTransfer = await db.query.transactions.findFirst({
      where: and(...conditions),
      orderBy: [asc(transactions.bookedAt)],
    });

    if (nextBalancingTransfer) {
      nextBalancingTransferDate = new Date(nextBalancingTransfer.bookedAt);
    }
  }

  // Find the most recent balance date in account_balances
  const mostRecentBalance = await db.query.accountBalances.findFirst({
    where: eq(accountBalances.accountId, accountId),
    orderBy: [desc(accountBalances.date)],
  });

  // Determine end date for recalculation
  let endDate: Date;
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  if (nextBalancingTransferDate) {
    // Stop the day BEFORE the next balancing transfer
    endDate = new Date(nextBalancingTransferDate);
    endDate.setDate(endDate.getDate() - 1);
    endDate.setHours(23, 59, 59, 999);
  } else if (mostRecentBalance) {
    // No balancing transfer ahead
    const mostRecentDate = new Date(mostRecentBalance.date);
    mostRecentDate.setHours(23, 59, 59, 999);

    // Use the later of: most recent balance date OR today
    // This handles the case where we're adding a balancing transfer after existing records
    if (mostRecentDate >= startDate) {
      endDate = mostRecentDate;
    } else {
      // Most recent balance is before our start date, recalculate to today
      endDate = today;
    }
  } else {
    // Fallback to today (initial setup case)
    endDate = today;
  }

  // Ensure we don't go past today
  if (endDate > today) {
    endDate = today;
  }

  // Iterate through each day from fromDate to endDate
  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    // Calculate balance up to end of this day
    const endOfDay = new Date(currentDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Build conditions for balance calculation, excluding the deleted transaction
    const balanceConditions = [
      eq(transactions.accountId, accountId),
      lte(transactions.bookedAt, endOfDay)
    ];

    if (excludeTransactionId) {
      balanceConditions.push(ne(transactions.id, excludeTransactionId));
    }

    const balanceResult = await db
      .select({
        total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)`,
      })
      .from(transactions)
      .where(and(...balanceConditions));

    const transactionSum = parseFloat(balanceResult[0]?.total || "0");
    const balanceOnDate = startingBalance + transactionSum;

    // Normalize date to midnight for storage (matching backend behavior)
    const dateForStorage = new Date(currentDate);
    dateForStorage.setHours(0, 0, 0, 0);

    // Check if a record exists for this date
    const existingRecord = await db.query.accountBalances.findFirst({
      where: and(
        eq(accountBalances.accountId, accountId),
        eq(accountBalances.date, dateForStorage)
      ),
    });

    if (existingRecord) {
      // Update existing record
      await db
        .update(accountBalances)
        .set({
          balanceInAccountCurrency: balanceOnDate.toFixed(2),
          balanceInFunctionalCurrency: balanceOnDate.toFixed(2),
          updatedAt: new Date(),
        })
        .where(eq(accountBalances.id, existingRecord.id));
    } else {
      // Insert new record
      await db.insert(accountBalances).values({
        accountId,
        date: dateForStorage,
        balanceInAccountCurrency: balanceOnDate.toFixed(2),
        balanceInFunctionalCurrency: balanceOnDate.toFixed(2),
      });
    }

    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1);
  }
}

export async function createTransaction(
  input: CreateTransactionInput
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
      console.error("Backend import failed:", response.status, errorText);
      return { success: false, error: `Failed to create transaction: ${response.status}` };
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
      transactionId: backendResponse.transaction_ids?.[0] || undefined
    };
  } catch (error) {
    console.error("Failed to create transaction:", error);
    return { success: false, error: "Failed to create transaction" };
  }
}

/**
 * Creates both sides of an account-to-account transfer and links them so the
 * movement affects account balances without being counted as income/spending.
 */
export async function createTransferTransaction(
  input: CreateTransferTransactionInput
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
  if (!(input.bookedAt instanceof Date) || Number.isNaN(input.bookedAt.getTime())) {
    return { success: false, error: "A valid transaction date is required" };
  }
  if (input.sourceAccountId === input.destinationAccountId) {
    return { success: false, error: "Source and destination accounts must be different" };
  }

  try {
    const ownedAccounts = await db.query.accounts.findMany({
      where: and(
        inArray(accounts.id, [input.sourceAccountId, input.destinationAccountId]),
        eq(accounts.userId, userId)
      ),
    });
    const sourceAccount = ownedAccounts.find((account) => account.id === input.sourceAccountId);
    const destinationAccount = ownedAccounts.find(
      (account) => account.id === input.destinationAccountId
    );

    if (!sourceAccount || !destinationAccount) {
      return { success: false, error: "One or both accounts were not found" };
    }

    const sourceCurrency = sourceAccount.currency || "EUR";
    const destinationCurrency = destinationAccount.currency || "EUR";
    if (sourceCurrency !== destinationCurrency) {
      return {
        success: false,
        error: "Transfers between accounts with different currencies are not supported yet",
      };
    }

    const transferCategory = await db.query.categories.findFirst({
      where: and(eq(categories.userId, userId), eq(categories.categoryType, "transfer")),
      orderBy: [desc(categories.isSystem), asc(categories.createdAt)],
    });

    const [user] = await db
      .select({ functionalCurrency: users.functionalCurrency })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const functionalCurrency = user?.functionalCurrency || "EUR";
    let functionalRate: number | null = sourceCurrency === functionalCurrency ? 1 : null;

    if (functionalRate === null) {
      const endOfBookedDay = new Date(input.bookedAt);
      endOfBookedDay.setHours(23, 59, 59, 999);
      const sevenDaysEarlier = new Date(input.bookedAt);
      sevenDaysEarlier.setDate(sevenDaysEarlier.getDate() - 7);
      sevenDaysEarlier.setHours(0, 0, 0, 0);
      const rate = await db.query.exchangeRates.findFirst({
        where: and(
          eq(exchangeRates.baseCurrency, sourceCurrency),
          eq(exchangeRates.targetCurrency, functionalCurrency),
          gte(exchangeRates.date, sevenDaysEarlier),
          lte(exchangeRates.date, endOfBookedDay)
        ),
        orderBy: [desc(exchangeRates.date)],
      });
      if (rate) functionalRate = parseFloat(rate.rate);
    }

    const amount = Math.abs(input.amount);
    const sourceAmount = (-amount).toFixed(2);
    const destinationAmount = amount.toFixed(2);
    const sourceFunctionalAmount = functionalRate === null
      ? null
      : (-amount * functionalRate).toFixed(2);
    const destinationFunctionalAmount = functionalRate === null
      ? null
      : (amount * functionalRate).toFixed(2);
    const result = await db.transaction(async (tx) => {
      const [sourceTransaction] = await tx
        .insert(transactions)
        .values({
          userId,
          accountId: sourceAccount.id,
          transactionType: "debit",
          amount: sourceAmount,
          currency: sourceCurrency,
          functionalAmount: sourceFunctionalAmount,
          description,
          merchant: destinationAccount.name,
          categorySystemId: transferCategory?.id || null,
          bookedAt: input.bookedAt,
          pending: false,
          includeInAnalytics: false,
        })
        .returning({ id: transactions.id });
      const [destinationTransaction] = await tx
        .insert(transactions)
        .values({
          userId,
          accountId: destinationAccount.id,
          transactionType: "credit",
          amount: destinationAmount,
          currency: destinationCurrency,
          functionalAmount: destinationFunctionalAmount,
          description,
          merchant: sourceAccount.name,
          categorySystemId: transferCategory?.id || null,
          bookedAt: input.bookedAt,
          pending: false,
          includeInAnalytics: false,
        })
        .returning({ id: transactions.id });

      const [transfer] = await tx
        .insert(internalTransfers)
        .values({
          userId,
          sourceTxnId: sourceTransaction.id,
          mirrorTxnId: destinationTransaction.id,
          sourceAccountId: sourceAccount.id,
          pocketAccountId: destinationAccount.id,
          amount: amount.toFixed(2),
          currency: sourceCurrency,
        })
        .returning({ id: internalTransfers.id });

      await tx
        .update(transactions)
        .set({ internalTransferId: transfer.id, updatedAt: new Date() })
        .where(inArray(transactions.id, [sourceTransaction.id, destinationTransaction.id]));

      for (const account of [sourceAccount, destinationAccount]) {
        const [balanceResult] = await tx
          .select({ total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)` })
          .from(transactions)
          .where(and(eq(transactions.accountId, account.id), eq(transactions.userId, userId)));
        const newBalance = parseFloat(account.startingBalance || "0")
          + parseFloat(balanceResult?.total || "0");
        await tx
          .update(accounts)
          .set({ functionalBalance: newBalance.toFixed(2), updatedAt: new Date() })
          .where(and(eq(accounts.id, account.id), eq(accounts.userId, userId)));
      }

      return {
        sourceTransactionId: sourceTransaction.id,
        destinationTransactionId: destinationTransaction.id,
      };
    });

    // Daily snapshots are derived data. The linked transfer itself and current
    // balances above are committed atomically, so a snapshot failure must not
    // invite the user to retry and create a duplicate transfer.
    try {
      await recalculateAccountBalancesFromDate(
        sourceAccount.id,
        input.bookedAt,
        parseFloat(sourceAccount.startingBalance || "0")
      );
      await recalculateAccountBalancesFromDate(
        destinationAccount.id,
        input.bookedAt,
        parseFloat(destinationAccount.startingBalance || "0")
      );
    } catch (snapshotError) {
      console.error("Transfer created, but balance snapshot recalculation failed:", snapshotError);
    }

    revalidatePath("/transactions");
    revalidatePath("/");
    revalidatePath("/settings");
    revalidatePath("/assets");
    revalidatePath(`/accounts/${sourceAccount.id}`);
    revalidatePath(`/accounts/${destinationAccount.id}`);

    return { success: true, ...result };
  } catch (error) {
    console.error("Failed to create transfer transaction:", error);
    return { success: false, error: "Failed to create transfer" };
  }
}

/**
 * Converts an existing standalone transaction into the source side of an
 * account-to-account transfer, then creates and links the destination side.
 */
export async function convertTransactionToTransfer(
  input: ConvertTransactionToTransferInput
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
  if (!(input.bookedAt instanceof Date) || Number.isNaN(input.bookedAt.getTime())) {
    return { success: false, error: "A valid transaction date is required" };
  }
  if (input.sourceAccountId === input.destinationAccountId) {
    return { success: false, error: "Source and destination accounts must be different" };
  }

  try {
    const existing = await db.query.transactions.findFirst({
      where: and(eq(transactions.id, input.transactionId), eq(transactions.userId, userId)),
      with: { account: true, category: true },
    });
    if (!existing) return { success: false, error: "Transaction not found" };
    if (existing.internalTransferId) {
      return { success: false, error: "This transaction is already part of a transfer" };
    }
    if (existing.category?.name === "Balancing Transfer") {
      return { success: false, error: "Balancing transfers cannot be converted" };
    }

    const ownedAccounts = await db.query.accounts.findMany({
      where: and(
        inArray(accounts.id, [input.sourceAccountId, input.destinationAccountId]),
        eq(accounts.userId, userId)
      ),
    });
    const sourceAccount = ownedAccounts.find((account) => account.id === input.sourceAccountId);
    const destinationAccount = ownedAccounts.find(
      (account) => account.id === input.destinationAccountId
    );
    if (!sourceAccount || !destinationAccount) {
      return { success: false, error: "One or both accounts were not found" };
    }

    const sourceCurrency = sourceAccount.currency || "EUR";
    const destinationCurrency = destinationAccount.currency || "EUR";
    if (sourceCurrency !== destinationCurrency) {
      return {
        success: false,
        error: "Transfers between accounts with different currencies are not supported yet",
      };
    }

    const transferCategory = await db.query.categories.findFirst({
      where: and(eq(categories.userId, userId), eq(categories.categoryType, "transfer")),
      orderBy: [desc(categories.isSystem), asc(categories.createdAt)],
    });
    const [user] = await db
      .select({ functionalCurrency: users.functionalCurrency })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const functionalCurrency = user?.functionalCurrency || "EUR";
    let functionalRate: number | null = sourceCurrency === functionalCurrency ? 1 : null;
    if (functionalRate === null) {
      const endOfBookedDay = new Date(input.bookedAt);
      endOfBookedDay.setHours(23, 59, 59, 999);
      const sevenDaysEarlier = new Date(input.bookedAt);
      sevenDaysEarlier.setDate(sevenDaysEarlier.getDate() - 7);
      sevenDaysEarlier.setHours(0, 0, 0, 0);
      const rate = await db.query.exchangeRates.findFirst({
        where: and(
          eq(exchangeRates.baseCurrency, sourceCurrency),
          eq(exchangeRates.targetCurrency, functionalCurrency),
          gte(exchangeRates.date, sevenDaysEarlier),
          lte(exchangeRates.date, endOfBookedDay)
        ),
        orderBy: [desc(exchangeRates.date)],
      });
      if (rate) functionalRate = parseFloat(rate.rate);
    }

    const amount = Math.abs(input.amount);
    const sourceAmount = (-amount).toFixed(2);
    const destinationAmount = amount.toFixed(2);
    const sourceFunctionalAmount = functionalRate === null
      ? null
      : (-amount * functionalRate).toFixed(2);
    const destinationFunctionalAmount = functionalRate === null
      ? null
      : (amount * functionalRate).toFixed(2);
    const affectedAccounts = new Map<string, { startingBalance: number; fromDate: Date }>();
    if (existing.account) {
      affectedAccounts.set(existing.accountId, {
        startingBalance: parseFloat(existing.account.startingBalance || "0"),
        fromDate: existing.bookedAt < input.bookedAt ? existing.bookedAt : input.bookedAt,
      });
    }
    for (const account of [sourceAccount, destinationAccount]) {
      const current = affectedAccounts.get(account.id);
      if (!current) {
        affectedAccounts.set(account.id, {
          startingBalance: parseFloat(account.startingBalance || "0"),
          fromDate: input.bookedAt,
        });
      } else if (input.bookedAt < current.fromDate) {
        current.fromDate = input.bookedAt;
      }
    }

    const result = await db.transaction(async (tx) => {
      await tx
        .update(transactions)
        .set({
          accountId: sourceAccount.id,
          transactionType: "debit",
          amount: sourceAmount,
          currency: sourceCurrency,
          functionalAmount: sourceFunctionalAmount,
          description,
          merchant: destinationAccount.name,
          creditor: null,
          debtor: null,
          counterpartyIbanCiphertext: null,
          counterpartyIbanHash: null,
          categoryId: null,
          categorySystemId: transferCategory?.id || null,
          recurringTransactionId: null,
          bookedAt: input.bookedAt,
          pending: false,
          includeInAnalytics: false,
          updatedAt: new Date(),
        })
        .where(and(eq(transactions.id, existing.id), eq(transactions.userId, userId)));

      const [destinationTransaction] = await tx
        .insert(transactions)
        .values({
          userId,
          accountId: destinationAccount.id,
          transactionType: "credit",
          amount: destinationAmount,
          currency: destinationCurrency,
          functionalAmount: destinationFunctionalAmount,
          description,
          merchant: sourceAccount.name,
          categorySystemId: transferCategory?.id || null,
          bookedAt: input.bookedAt,
          pending: false,
          includeInAnalytics: false,
        })
        .returning({ id: transactions.id });
      const [transfer] = await tx
        .insert(internalTransfers)
        .values({
          userId,
          sourceTxnId: existing.id,
          mirrorTxnId: destinationTransaction.id,
          sourceAccountId: sourceAccount.id,
          pocketAccountId: destinationAccount.id,
          amount: amount.toFixed(2),
          currency: sourceCurrency,
        })
        .returning({ id: internalTransfers.id });
      await tx
        .update(transactions)
        .set({ internalTransferId: transfer.id, updatedAt: new Date() })
        .where(inArray(transactions.id, [existing.id, destinationTransaction.id]));

      for (const [accountId, { startingBalance }] of affectedAccounts) {
        const [balanceResult] = await tx
          .select({ total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)` })
          .from(transactions)
          .where(and(eq(transactions.accountId, accountId), eq(transactions.userId, userId)));
        const newBalance = startingBalance + parseFloat(balanceResult?.total || "0");
        await tx
          .update(accounts)
          .set({ functionalBalance: newBalance.toFixed(2), updatedAt: new Date() })
          .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
      }

      return { sourceTransactionId: existing.id, destinationTransactionId: destinationTransaction.id };
    });

    try {
      for (const [accountId, { startingBalance, fromDate }] of affectedAccounts) {
        await recalculateAccountBalancesFromDate(accountId, fromDate, startingBalance);
      }
    } catch (snapshotError) {
      console.error("Transaction converted, but balance snapshot recalculation failed:", snapshotError);
    }

    revalidatePath("/transactions");
    revalidatePath("/");
    revalidatePath("/settings");
    revalidatePath("/assets");
    revalidatePath("/subscriptions");
    for (const accountId of affectedAccounts.keys()) revalidatePath(`/accounts/${accountId}`);

    return { success: true, ...result };
  } catch (error) {
    console.error("Failed to convert transaction to transfer:", error);
    return { success: false, error: "Failed to convert transaction to transfer" };
  }
}

export async function updateTransaction(
  input: UpdateTransactionInput
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
  if (!(input.bookedAt instanceof Date) || Number.isNaN(input.bookedAt.getTime())) {
    return { success: false, error: "A valid transaction date is required" };
  }
  if (input.transactionType !== "debit" && input.transactionType !== "credit") {
    return { success: false, error: "A valid transaction type is required" };
  }

  try {
    const existing = await db.query.transactions.findFirst({
      where: and(
        eq(transactions.id, input.transactionId),
        eq(transactions.userId, userId)
      ),
      with: {
        account: true,
        category: true,
      },
    });

    if (!existing) {
      return { success: false, error: "Transaction not found" };
    }
    if (existing.internalTransferId) {
      return { success: false, error: "Unlink the internal transfer before editing it" };
    }
    if (existing.category?.name === "Balancing Transfer") {
      return { success: false, error: "Balancing transfers cannot be edited" };
    }

    const account = await db.query.accounts.findFirst({
      where: and(eq(accounts.id, input.accountId), eq(accounts.userId, userId)),
    });
    if (!account) {
      return { success: false, error: "Account not found" };
    }

    if (input.categoryId) {
      const category = await db.query.categories.findFirst({
        where: and(
          eq(categories.id, input.categoryId),
          eq(categories.userId, userId)
        ),
      });
      if (!category) {
        return { success: false, error: "Category not found" };
      }
    }

    const signedAmount = input.transactionType === "debit"
      ? -Math.abs(input.amount)
      : Math.abs(input.amount);
    const amountForStorage = signedAmount.toFixed(2);
    const currency = account.currency || "EUR";

    const [user] = await db
      .select({ functionalCurrency: users.functionalCurrency })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const functionalCurrency = user?.functionalCurrency || "EUR";
    let functionalAmount: string | null = null;

    if (currency === functionalCurrency) {
      functionalAmount = amountForStorage;
    } else {
      const endOfBookedDay = new Date(input.bookedAt);
      endOfBookedDay.setHours(23, 59, 59, 999);
      const sevenDaysEarlier = new Date(input.bookedAt);
      sevenDaysEarlier.setDate(sevenDaysEarlier.getDate() - 7);
      sevenDaysEarlier.setHours(0, 0, 0, 0);

      const rate = await db.query.exchangeRates.findFirst({
        where: and(
          eq(exchangeRates.baseCurrency, currency),
          eq(exchangeRates.targetCurrency, functionalCurrency),
          gte(exchangeRates.date, sevenDaysEarlier),
          lte(exchangeRates.date, endOfBookedDay)
        ),
        orderBy: [desc(exchangeRates.date)],
      });
      if (rate) {
        functionalAmount = (signedAmount * parseFloat(rate.rate)).toFixed(2);
      }
    }

    await db
      .update(transactions)
      .set({
        accountId: input.accountId,
        amount: amountForStorage,
        functionalAmount,
        currency,
        description,
        merchant,
        categoryId: input.categoryId || null,
        bookedAt: input.bookedAt,
        transactionType: input.transactionType,
        updatedAt: new Date(),
      })
      .where(and(eq(transactions.id, input.transactionId), eq(transactions.userId, userId)));

    const affectedAccounts = new Map<string, { startingBalance: number; fromDate: Date }>();
    affectedAccounts.set(existing.accountId, {
      startingBalance: parseFloat(existing.account?.startingBalance || "0"),
      fromDate: existing.bookedAt < input.bookedAt ? existing.bookedAt : input.bookedAt,
    });
    if (input.accountId !== existing.accountId) {
      affectedAccounts.set(input.accountId, {
        startingBalance: parseFloat(account.startingBalance || "0"),
        fromDate: input.bookedAt,
      });
    }

    for (const [accountId, { startingBalance, fromDate }] of affectedAccounts) {
      const [balanceResult] = await db
        .select({ total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)` })
        .from(transactions)
        .where(and(eq(transactions.accountId, accountId), eq(transactions.userId, userId)));
      const newBalance = startingBalance + parseFloat(balanceResult?.total || "0");

      await db
        .update(accounts)
        .set({ functionalBalance: newBalance.toFixed(2), updatedAt: new Date() })
        .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
      await recalculateAccountBalancesFromDate(accountId, fromDate, startingBalance);
    }

    revalidatePath("/transactions");
    revalidatePath("/");
    revalidatePath("/settings");
    revalidatePath("/assets");
    revalidatePath("/subscriptions");

    return { success: true };
  } catch (error) {
    console.error("Failed to update transaction:", error);
    return { success: false, error: "Failed to update transaction" };
  }
}

export async function updateTransactionCategory(
  transactionId: string,
  categoryId: string | null
): Promise<{ success: boolean; error?: string }> {
  const userId = await requireAuth();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    // Verify the transaction belongs to the user
    const transaction = await db.query.transactions.findFirst({
      where: and(
        eq(transactions.id, transactionId),
        eq(transactions.userId, userId)
      ),
    });

    if (!transaction) {
      return { success: false, error: "Transaction not found" };
    }

    // Verify the category belongs to the user (if provided)
    if (categoryId) {
      const category = await db.query.categories.findFirst({
        where: and(
          eq(categories.id, categoryId),
          eq(categories.userId, userId)
        ),
      });

      if (!category) {
        return { success: false, error: "Category not found" };
      }
    }

    await db
      .update(transactions)
      .set({
        categoryId,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, transactionId));

    revalidatePath("/transactions");
    return { success: true };
  } catch (error) {
    console.error("Failed to update transaction category:", error);
    return { success: false, error: "Failed to update transaction category" };
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
    const result = await db.query.transactions.findMany({
      where: eq(transactions.userId, userId),
      orderBy: [desc(transactions.bookedAt)],
      with: {
        account: {
          with: {
            logo: {
              columns: {
                id: true,
                logoUrl: true,
                updatedAt: true,
              },
            },
          },
        },
        category: true,
        categorySystem: true,
        recurringTransaction: true,
        transactionLink: true,
        internalTransfer: {
          with: {
            sourceAccount: {
              columns: {
                id: true,
                name: true,
              },
            },
            pocketAccount: {
              columns: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });
    const hydratedRows = await hydrateTransactionRowsWithResolvedAccountLogos(result);
    return mapTransactionRowsForUi(hydratedRows, "getTransactions");
  } catch (error: unknown) {
    const normalizedError =
      error instanceof Error
        ? {
            message: error.message,
            cause: "cause" in error ? (error as Error & { cause?: unknown }).cause : undefined,
            stack: error.stack,
          }
        : { message: String(error), cause: undefined, stack: undefined };
    console.error("[getTransactions] Query failed:", {
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
  accountId: string
): Promise<TransactionWithRelations[]> {
  const userId = await requireAuth();

  if (!userId) {
    return [];
  }

  // Verify the account belongs to the user
  const account = await db.query.accounts.findFirst({
    where: and(
      eq(accounts.id, accountId),
      eq(accounts.userId, userId)
    ),
  });

  if (!account) {
    return [];
  }

  try {
    const result = await db.query.transactions.findMany({
      where: and(
        eq(transactions.userId, userId),
        eq(transactions.accountId, accountId)
      ),
      orderBy: [desc(transactions.bookedAt)],
      with: {
        account: {
          with: {
            logo: {
              columns: {
                id: true,
                logoUrl: true,
                updatedAt: true,
              },
            },
          },
        },
        category: true,
        categorySystem: true,
        recurringTransaction: true,
        transactionLink: true,
        internalTransfer: {
          with: {
            sourceAccount: {
              columns: {
                id: true,
                name: true,
              },
            },
            pocketAccount: {
              columns: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });
    const hydratedRows = await hydrateTransactionRowsWithResolvedAccountLogos(result);
    return mapTransactionRowsForUi(hydratedRows, "getTransactionsForAccount");
  } catch (error: unknown) {
    const normalizedError =
      error instanceof Error
        ? {
            message: error.message,
            cause: "cause" in error ? (error as Error & { cause?: unknown }).cause : undefined,
            stack: error.stack,
          }
        : { message: String(error), cause: undefined, stack: undefined };
    console.error("[getTransactionsForAccount] Query failed:", {
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
  categoryId: string | null
): Promise<{ success: boolean; error?: string; updatedCount?: number }> {
  const userId = await requireAuth();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  if (transactionIds.length === 0) {
    return { success: false, error: "No transactions selected" };
  }

  try {
    // Verify the category belongs to the user (if provided)
    if (categoryId) {
      const category = await db.query.categories.findFirst({
        where: and(
          eq(categories.id, categoryId),
          eq(categories.userId, userId)
        ),
      });

      if (!category) {
        return { success: false, error: "Category not found" };
      }
    }

    // Update all transactions that belong to the user
    await db
      .update(transactions)
      .set({
        categoryId,
        updatedAt: new Date(),
      })
      .where(
        and(
          inArray(transactions.id, transactionIds),
          eq(transactions.userId, userId)
        )
      );

    revalidatePath("/transactions");
    return { success: true, updatedCount: transactionIds.length };
  } catch (error) {
    console.error("Failed to bulk update transaction categories:", error);
    return { success: false, error: "Failed to update transactions" };
  }
}

export async function updateTransactionIncludeInAnalytics(
  transactionId: string,
  includeInAnalytics: boolean
): Promise<{ success: boolean; error?: string }> {
  const userId = await requireAuth();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    // Verify the transaction belongs to the user
    const transaction = await db.query.transactions.findFirst({
      where: and(
        eq(transactions.id, transactionId),
        eq(transactions.userId, userId)
      ),
    });

    if (!transaction) {
      return { success: false, error: "Transaction not found" };
    }

    await db
      .update(transactions)
      .set({
        includeInAnalytics,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, transactionId));

    revalidatePath("/transactions");
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to update transaction include_in_analytics:", error);
    return { success: false, error: "Failed to update transaction" };
  }
}

export async function bulkUpdateTransactionIncludeInAnalytics(
  transactionIds: string[],
  includeInAnalytics: boolean
): Promise<{ success: boolean; error?: string; updatedCount?: number }> {
  const userId = await requireAuth();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  if (transactionIds.length === 0) {
    return { success: false, error: "No transactions selected" };
  }

  try {
    // Update all transactions that belong to the user
    await db
      .update(transactions)
      .set({
        includeInAnalytics,
        updatedAt: new Date(),
      })
      .where(
        and(
          inArray(transactions.id, transactionIds),
          eq(transactions.userId, userId)
        )
      );

    revalidatePath("/transactions");
    revalidatePath("/");
    return { success: true, updatedCount: transactionIds.length };
  } catch (error) {
    console.error("Failed to bulk update transaction include_in_analytics:", error);
    return { success: false, error: "Failed to update transactions" };
  }
}

/**
 * Deletes a balancing transfer transaction and recalculates balances.
 * This reverts the balance adjustment as if the transfer never existed.
 */
export async function deleteBalancingTransaction(
  transactionId: string
): Promise<{ success: boolean; error?: string }> {
  const userId = await requireAuth();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    // Get the transaction with its account and category
    const transaction = await db.query.transactions.findFirst({
      where: and(
        eq(transactions.id, transactionId),
        eq(transactions.userId, userId)
      ),
      with: {
        account: true,
        category: true,
      },
    });

    if (!transaction) {
      return { success: false, error: "Transaction not found" };
    }

    // Verify this is a "Balancing Transfer" category
    if (!transaction.category || transaction.category.name !== "Balancing Transfer") {
      return { success: false, error: "Only balancing transfers can be reverted" };
    }

    const accountId = transaction.accountId;
    const transactionDate = transaction.bookedAt;

    // Get the account's starting balance for recalculation
    const account = transaction.account;
    if (!account) {
      return { success: false, error: "Transaction account not found" };
    }
    const startingBalance = parseFloat(account.startingBalance || "0");

    // Delete the transaction
    await db.delete(transactions).where(eq(transactions.id, transactionId));

    // Recalculate balances from the deleted transaction's date
    // Pass the transactionId to exclude it from balance calculations
    // (the transaction is deleted but we pass it for the recalculation logic to find the next balancing transfer correctly)
    await recalculateAccountBalancesFromDate(
      accountId,
      transactionDate,
      startingBalance,
      transactionId
    );

    // Update the account's functional_balance
    const balanceResult = await db
      .select({
        total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)`,
      })
      .from(transactions)
      .where(eq(transactions.accountId, accountId));

    const transactionSum = parseFloat(balanceResult[0]?.total || "0");
    const newFunctionalBalance = startingBalance + transactionSum;

    await db
      .update(accounts)
      .set({
        functionalBalance: newFunctionalBalance.toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, accountId));

    revalidatePath("/transactions");
    revalidatePath("/");
    revalidatePath("/settings");
    revalidatePath("/assets");

    return { success: true };
  } catch (error) {
    console.error("Failed to delete balancing transaction:", error);
    return { success: false, error: "Failed to revert balancing transfer" };
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
  input: CreateOrUpdateBalancingTransactionInput
): Promise<{ success: boolean; error?: string; transactionId?: string; isUpdate?: boolean }> {
  const userId = await requireAuth();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const { accountId, targetBalance, adjustmentDate, balancingCategoryId } = input;

    // Verify the account belongs to the user
    const account = await db.query.accounts.findFirst({
      where: and(
        eq(accounts.id, accountId),
        eq(accounts.userId, userId)
      ),
    });

    if (!account) {
      return { success: false, error: "Account not found" };
    }

    // Verify the category belongs to the user
    const category = await db.query.categories.findFirst({
      where: and(
        eq(categories.id, balancingCategoryId),
        eq(categories.userId, userId)
      ),
    });

    if (!category || category.name !== "Balancing Transfer") {
      return { success: false, error: "Invalid balancing transfer category" };
    }

    // Normalize date to start and end of day for searching
    const startOfDay = new Date(adjustmentDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(adjustmentDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Check if there's already a balancing transfer on this date for this account
    const existingBalancingTransfer = await db.query.transactions.findFirst({
      where: and(
        eq(transactions.accountId, accountId),
        eq(transactions.categoryId, balancingCategoryId),
        gte(transactions.bookedAt, startOfDay),
        lte(transactions.bookedAt, endOfDay)
      ),
    });

    const startingBalance = parseFloat(account.startingBalance || "0");

    // Calculate what the balance would be on this date WITHOUT any balancing transfer
    // We need to exclude the existing balancing transfer (if any) from the calculation
    const balanceConditions = [
      eq(transactions.accountId, accountId),
      lte(transactions.bookedAt, endOfDay)
    ];

    if (existingBalancingTransfer) {
      balanceConditions.push(ne(transactions.id, existingBalancingTransfer.id));
    }

    const balanceWithoutAdjustment = await db
      .select({
        total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)`,
      })
      .from(transactions)
      .where(and(...balanceConditions));

    const transactionSumWithoutAdjustment = parseFloat(balanceWithoutAdjustment[0]?.total || "0");
    const currentBalanceWithoutAdjustment = startingBalance + transactionSumWithoutAdjustment;

    // Calculate the required adjustment amount
    const difference = targetBalance - currentBalanceWithoutAdjustment;

    if (Math.abs(difference) < 0.01) {
      // No adjustment needed - if there's an existing balancing transfer, delete it
      if (existingBalancingTransfer) {
        await db.delete(transactions).where(eq(transactions.id, existingBalancingTransfer.id));

        // Recalculate balances
        await recalculateAccountBalancesFromDate(
          accountId,
          adjustmentDate,
          startingBalance,
          existingBalancingTransfer.id
        );

        // Update functional balance
        const newBalanceResult = await db
          .select({
            total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)`,
          })
          .from(transactions)
          .where(eq(transactions.accountId, accountId));

        const newFunctionalBalance = startingBalance + parseFloat(newBalanceResult[0]?.total || "0");

        await db
          .update(accounts)
          .set({
            functionalBalance: newFunctionalBalance.toFixed(2),
            updatedAt: new Date(),
          })
          .where(eq(accounts.id, accountId));

        revalidatePath("/transactions");
        revalidatePath("/");
        revalidatePath("/settings");
        revalidatePath("/assets");

        return { success: true, isUpdate: true };
      }
      return { success: true };
    }

    const transactionType = difference > 0 ? "credit" : "debit";
    // Keep the sign! Debits should be negative, credits positive.
    // The balance formula is: balance = starting_balance + SUM(transactions.amount)
    const amount = difference;

    let transactionId: string;
    let isUpdate = false;

    if (existingBalancingTransfer) {
      // Update existing transaction
      await db
        .update(transactions)
        .set({
          amount: amount.toString(),
          transactionType,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, existingBalancingTransfer.id));

      transactionId = existingBalancingTransfer.id;
      isUpdate = true;
    } else {
      // Create new transaction
      const [result] = await db.insert(transactions).values({
        userId,
        accountId,
        amount: amount.toString(),
        description: "Balance adjustment",
        categoryId: balancingCategoryId,
        bookedAt: adjustmentDate,
        transactionType,
        currency: account.currency || "EUR",
      }).returning({ id: transactions.id });

      transactionId = result.id;
    }

    // Recalculate balances from the adjustment date
    await recalculateAccountBalancesFromDate(
      accountId,
      adjustmentDate,
      startingBalance
    );

    // Update the account's functional_balance
    const balanceResult = await db
      .select({
        total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)`,
      })
      .from(transactions)
      .where(eq(transactions.accountId, accountId));

    const transactionSum = parseFloat(balanceResult[0]?.total || "0");
    const newFunctionalBalance = startingBalance + transactionSum;

    await db
      .update(accounts)
      .set({
        functionalBalance: newFunctionalBalance.toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, accountId));

    revalidatePath("/transactions");
    revalidatePath("/");
    revalidatePath("/settings");
    revalidatePath("/assets");

    return { success: true, transactionId, isUpdate };
  } catch (error) {
    console.error("Failed to create/update balancing transaction:", error);
    return { success: false, error: "Failed to update balance" };
  }
}

// ============================================================================
// Deletion Flows
// ============================================================================

async function includeLinkedTransferTransactions(
  userId: string,
  transactionIds: string[]
): Promise<string[]> {
  const normalizedIds = Array.from(new Set(transactionIds));
  if (!normalizedIds.length) return normalizedIds;

  const linkedTransfers = await db.query.internalTransfers.findMany({
    where: and(
      eq(internalTransfers.userId, userId),
      or(
        inArray(internalTransfers.sourceTxnId, normalizedIds),
        inArray(internalTransfers.mirrorTxnId, normalizedIds)
      )
    ),
  });

  for (const transfer of linkedTransfers) {
    normalizedIds.push(transfer.sourceTxnId);
    if (transfer.mirrorTxnId) normalizedIds.push(transfer.mirrorTxnId);
  }
  return Array.from(new Set(normalizedIds));
}

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
  transactionIds: string[]
): Promise<{ success: true; data: DeleteImpact } | { success: false; error: string }> {
  const userId = await requireAuth();
  if (!userId) return { success: false, error: "Not authenticated" };
  if (!transactionIds.length) return { success: false, error: "No transactions selected" };

  try {
    const idsToDelete = await includeLinkedTransferTransactions(userId, transactionIds);
    const txRows = await db.query.transactions.findMany({
      where: and(
        inArray(transactions.id, idsToDelete),
        eq(transactions.userId, userId)
      ),
      with: { account: true },
    });

    if (!txRows.length) return { success: false, error: "Transactions not found" };

    // Group by account
    const byAccount = new Map<
      string,
      { account: NonNullable<(typeof txRows)[0]["account"]>; amountSum: number; earliestDate: Date }
    >();

    for (const tx of txRows) {
      if (!tx.account) continue;
      const amount = parseFloat(tx.amount);
      const existing = byAccount.get(tx.accountId);
      if (existing) {
        existing.amountSum += amount;
        if (tx.bookedAt < existing.earliestDate) existing.earliestDate = tx.bookedAt;
      } else {
        byAccount.set(tx.accountId, { account: tx.account, amountSum: amount, earliestDate: tx.bookedAt });
      }
    }

    const accountImpacts: AccountDeleteImpact[] = [];
    let overallEarliestDate = new Date(8640000000000000); // max-date sentinel for min-reduction

    // Single grouped query replaces the previous per-account SUM inside the loop (N queries → 1).
    const accountIds = Array.from(byAccount.keys());
    const remainingSums = await db
      .select({
        accountId: transactions.accountId,
        sum: sql<string>`COALESCE(SUM(${transactions.amount}), 0)`,
      })
      .from(transactions)
      .where(
        and(
          inArray(transactions.accountId, accountIds),
          eq(transactions.userId, userId),
          notInArray(transactions.id, idsToDelete)
        )
      )
      .groupBy(transactions.accountId);
    const remainingSumMap = new Map(remainingSums.map((r) => [r.accountId, r.sum]));

    for (const [accountId, { account, amountSum, earliestDate }] of byAccount) {
      const currentBalance = parseFloat(account.functionalBalance || "0");
      const startingBalance = parseFloat(account.startingBalance || "0");
      const projectedBalance = startingBalance + parseFloat(remainingSumMap.get(accountId) ?? "0");

      accountImpacts.push({
        accountId,
        accountName: account.name,
        currency: account.currency ?? "EUR",
        // Debits are stored as negative amounts; credits as positive (schema convention).
        // Deleting a debit raises the balance (+), deleting a credit lowers it (-).
        amountChange: -amountSum,
        currentBalance,
        projectedBalance,
        balanceIsAnchored: account.balanceIsAnchored ?? false,
      });

      if (earliestDate < overallEarliestDate) overallEarliestDate = earliestDate;
    }

    return {
      success: true,
      data: {
        accountImpacts,
        totalTransactions: txRows.length,
        earliestDate: overallEarliestDate,
      },
    };
  } catch (error) {
    console.error("Failed to compute delete impact:", error);
    return { success: false, error: "Failed to compute impact" };
  }
}

/**
 * Permanently deletes a set of transactions and updates account balances.
 * All transactions must belong to the authenticated user.
 * Balance recalculation runs after deletion.
 */
export async function deleteTransactions(
  transactionIds: string[]
): Promise<{ success: boolean; error?: string; affectedAccountIds?: string[]; deletedCount?: number }> {
  const session = await getAuthenticatedSession();
  const userId = session?.user?.id ?? null;
  if (!userId) return { success: false, error: "Not authenticated" };
  if (isDemoRestrictedUserEmail(session?.user?.email)) {
    return { success: false, error: DEMO_RESTRICTED_ACTION_ERROR };
  }
  if (!transactionIds.length) return { success: false, error: "No transactions selected" };

  try {
    const idsToDelete = await includeLinkedTransferTransactions(userId, transactionIds);
    // Fetch target transactions to get per-account data before deleting
    const txRows = await db.query.transactions.findMany({
      where: and(
        inArray(transactions.id, idsToDelete),
        eq(transactions.userId, userId)
      ),
      with: { account: true },
    });

    if (!txRows.length) return { success: false, error: "Transactions not found" };
    // No strict length equality check: the DELETE is already user-scoped (userId in WHERE),
    // so foreign or concurrently-deleted IDs are safely ignored rather than aborting the batch.

    // Build per-account: earliest bookedAt for recalculation range
    const accountData = new Map<string, { startingBalance: number; earliestDate: Date }>();
    for (const tx of txRows) {
      if (!tx.account) continue;
      const existing = accountData.get(tx.accountId);
      if (existing) {
        if (tx.bookedAt < existing.earliestDate) existing.earliestDate = tx.bookedAt;
      } else {
        accountData.set(tx.accountId, {
          startingBalance: parseFloat(tx.account.startingBalance || "0"),
          earliestDate: tx.bookedAt,
        });
      }
    }

    // Delete all transactions (userId filter ensures security)
    await db
      .delete(transactions)
      .where(and(inArray(transactions.id, idsToDelete), eq(transactions.userId, userId)));

    // Update functionalBalance and recalculate daily snapshots per affected account
    const affectedAccountIds: string[] = [];
    for (const [accountId, { startingBalance, earliestDate }] of accountData) {
      affectedAccountIds.push(accountId);

      // Recompute functionalBalance from remaining transactions
      const balanceResult = await db
        .select({ total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)` })
        .from(transactions)
        .where(and(eq(transactions.accountId, accountId), eq(transactions.userId, userId)));

      const transactionSum = parseFloat(balanceResult[0]?.total || "0");
      const newFunctionalBalance = startingBalance + transactionSum;

      await db
        .update(accounts)
        .set({ functionalBalance: newFunctionalBalance.toFixed(2), updatedAt: new Date() })
        .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));

      // Rebuild daily balance snapshots from the earliest deleted transaction date
      await recalculateAccountBalancesFromDate(accountId, earliestDate, startingBalance);
    }

    revalidatePath("/transactions");
    revalidatePath("/");
    revalidatePath("/settings");
    revalidatePath("/assets");
    revalidatePath("/subscriptions");

    return { success: true, affectedAccountIds, deletedCount: txRows.length };
  } catch (error) {
    console.error("Failed to delete transactions:", error);
    return { success: false, error: "Failed to delete transactions" };
  }
}
