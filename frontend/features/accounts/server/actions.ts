"use server";

import { logger } from "@/lib/logger";
import { revalidatePath, updateTag } from "next/cache";
import { getAuthenticatedSession, requireAuth } from "@/lib/auth-helpers";
import { CACHE_TAGS } from "@/lib/data/cached";
import {
  DEMO_RESTRICTED_ACTION_ERROR,
  isDemoRestrictedUserEmail,
} from "@/lib/demo-access";
import { calculateBalance } from "../domain/balance-history";
import {
  recalculateAccountTimeseriesUseCase,
  recalculateStartingBalanceUseCase,
  type AccountRecalculationDependencies,
} from "../application/recalculate-account";
import type {
  BalanceOnDateResult,
  CreateAccountInput,
  CreateAccountResult,
  CreatePocketAccountInput,
  DeleteAccountResult,
  RecalculateAccountResult,
  UpdateAccountInput,
} from "../domain/contracts";
import {
  createPocketAccountViaBackend,
  requestTimeseriesRecalculation,
  unlinkInternalTransferViaBackend,
} from "./timeseries.gateway";
import {
  deactivateAccount,
  findOwnedAccount,
  getLatestStoredBalance,
  getTransactionSum,
  insertManualAccount,
  permanentlyDeleteAccount,
  updateAccountBalances,
  updateOwnedAccount,
} from "./accounts.repository";
import { getAccounts as queryAccounts } from "./queries";

function invalidateAccounts(userId: string, paths: string[]) {
  for (const path of paths) revalidatePath(path);
  updateTag(CACHE_TAGS.accounts(userId));
}

const recalculationDependencies: AccountRecalculationDependencies = {
  findAccount: findOwnedAccount,
  transactionSum: getTransactionSum,
  updateBalances: updateAccountBalances,
  recalculateTimeseries: requestTimeseriesRecalculation,
};

export async function getAccounts() {
  return queryAccounts();
}

export async function createAccount(
  input: CreateAccountInput,
): Promise<CreateAccountResult> {
  const userId = await requireAuth();
  if (!userId) return { success: false, error: "Not authenticated" };
  try {
    const account = await insertManualAccount(userId, input);
    invalidateAccounts(userId, [
      "/settings",
      "/transactions/import",
      "/assets",
    ]);
    return { success: true, accountId: account.id };
  } catch (error) {
    logger.error("Failed to create account", { error });
    return { success: false, error: "Failed to create account" };
  }
}

export async function updateAccount(
  accountId: string,
  input: UpdateAccountInput,
) {
  const userId = await requireAuth();
  if (!userId) return { success: false, error: "Not authenticated" };
  try {
    if (!(await findOwnedAccount(userId, accountId))) {
      return { success: false, error: "Account not found" };
    }
    await updateOwnedAccount(userId, accountId, input);
    invalidateAccounts(userId, [
      "/assets",
      "/accounts",
      `/accounts/${accountId}`,
      "/transactions",
      "/settings",
      "/",
    ]);
    return { success: true };
  } catch (error) {
    logger.error("Failed to update account", { error });
    return { success: false, error: "Failed to update account" };
  }
}

export async function deleteAccount(accountId: string) {
  const userId = await requireAuth();
  if (!userId) return { success: false, error: "Not authenticated" };
  try {
    if (!(await findOwnedAccount(userId, accountId))) {
      return { success: false, error: "Account not found" };
    }
    await deactivateAccount(userId, accountId);
    invalidateAccounts(userId, ["/settings", "/assets", "/"]);
    return { success: true };
  } catch (error) {
    logger.error("Failed to delete account", { error });
    return { success: false, error: "Failed to delete account" };
  }
}

export async function hardDeleteAccount(
  accountId: string,
): Promise<DeleteAccountResult> {
  const userId = await requireAuth();
  if (!userId) return { success: false, error: "Not authenticated" };
  try {
    if (!(await findOwnedAccount(userId, accountId))) {
      return { success: false, error: "Account not found" };
    }
    const counts = await permanentlyDeleteAccount(userId, accountId);
    invalidateAccounts(userId, ["/settings", "/", "/transactions", "/assets"]);
    return { success: true, ...counts };
  } catch (error) {
    logger.error("Failed to hard delete account", { error });
    return {
      success: false,
      error: "Failed to delete account and associated data",
    };
  }
}

export async function recalculateStartingBalance(
  accountId: string,
  knownCurrentBalance: number,
): Promise<RecalculateAccountResult> {
  const userId = await requireAuth();
  if (!userId) return { success: false, error: "Not authenticated" };
  try {
    const result = await recalculateStartingBalanceUseCase(
      recalculationDependencies,
      {
        userId,
        accountId,
        knownCurrentBalance,
      },
    );
    if (!result.success) return result;
    invalidateAccounts(userId, ["/settings", "/transactions", "/", "/assets"]);
    return result;
  } catch (error) {
    logger.error("Failed to recalculate starting balance", { error });
    return { success: false, error: "Failed to recalculate starting balance" };
  }
}

export async function getAccountBalanceOnDate(
  accountId: string,
  date: Date,
): Promise<BalanceOnDateResult> {
  const userId = await requireAuth();
  if (!userId) return { balance: 0, found: false };
  const account = await findOwnedAccount(userId, accountId);
  if (!account) return { balance: 0, found: false };
  const stored = await getLatestStoredBalance(userId, accountId, date);
  if (stored) {
    return {
      balance: Number.parseFloat(stored.balanceInAccountCurrency),
      found: true,
    };
  }
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  return {
    balance: calculateBalance(
      Number.parseFloat(account.startingBalance ?? "0"),
      await getTransactionSum(userId, accountId, endOfDay),
    ),
    found: true,
  };
}

export async function recalculateAccountTimeseries(
  accountId: string,
): Promise<RecalculateAccountResult> {
  const userId = await requireAuth();
  if (!userId) return { success: false, error: "Not authenticated" };
  try {
    const result = await recalculateAccountTimeseriesUseCase(
      recalculationDependencies,
      {
        userId,
        accountId,
      },
    );
    if (!result.success) return result;
    invalidateAccounts(userId, ["/settings", "/", "/transactions", "/assets"]);
    return result;
  } catch (error) {
    logger.error("Failed to recalculate timeseries", { error });
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to recalculate timeseries",
    };
  }
}

export async function createPocketAccount(
  input: CreatePocketAccountInput,
): Promise<CreateAccountResult> {
  const session = await getAuthenticatedSession();
  const userId = session?.user?.id;
  if (!userId) return { success: false, error: "Not authenticated" };
  if (isDemoRestrictedUserEmail(session.user.email)) {
    return { success: false, error: DEMO_RESTRICTED_ACTION_ERROR };
  }
  try {
    const result = await createPocketAccountViaBackend(userId, {
      name: input.name,
      accountType: input.accountType ?? "savings",
      currency: input.currency ?? "EUR",
      startingBalance: input.startingBalance ?? 0,
      iban: input.iban,
    });
    invalidateAccounts(userId, [
      "/settings",
      "/assets",
      "/transactions/import",
    ]);
    return {
      success: true,
      accountId: result.account_id,
      backfilledCount: result.backfilled_count,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to create pocket account",
    };
  }
}

export async function unlinkInternalTransfer(transferId: string) {
  const session = await getAuthenticatedSession();
  const userId = session?.user?.id;
  if (!userId) return { success: false, error: "Not authenticated" };
  if (isDemoRestrictedUserEmail(session.user.email)) {
    return { success: false, error: DEMO_RESTRICTED_ACTION_ERROR };
  }
  try {
    await unlinkInternalTransferViaBackend(transferId, userId);
    invalidateAccounts(userId, ["/transactions", "/assets"]);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to unlink internal transfer",
    };
  }
}
