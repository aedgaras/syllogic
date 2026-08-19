import { logger } from "@/lib/logger";
import "server-only";

import { getCachedFullUserAccounts } from "@/lib/data/cached";
import { requireAuth } from "@/lib/auth-helpers";
import { resolveMissingAccountLogo } from "@/lib/actions/account-logos";
import {
  buildBalanceHistory,
  calculateBalance,
} from "../domain/balance-history";
import type { BalanceHistoryPoint } from "../domain/contracts";
import { toAccountViewModel } from "./account.mapper";
import {
  findActiveOwnedAccountWithLogo,
  findOwnedAccount,
  getDailyTransactionChanges,
  getEarliestTransactionDate,
  getStoredBalanceHistory,
  getTransactionSumBefore,
} from "./accounts.repository";

export async function getAccounts() {
  try {
    const rows = await getCachedFullUserAccounts();
    return rows.map(toAccountViewModel);
  } catch (error) {
    logger.error("Failed to get accounts", { error });
    return [];
  }
}

export async function getAccountById(accountId: string) {
  const userId = await requireAuth();
  if (!userId) return null;
  const row = await findActiveOwnedAccountWithLogo(userId, accountId);
  if (!row) return null;
  return toAccountViewModel(await resolveMissingAccountLogo(row));
}

export async function getAccountBalanceHistory(
  accountId: string,
  days: number | null = 90,
): Promise<BalanceHistoryPoint[]> {
  const userId = await requireAuth();
  if (!userId) return [];
  const account = await findOwnedAccount(userId, accountId);
  if (!account) return [];

  let startDate: Date | null;
  if (typeof days === "number") {
    startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);
  } else {
    startDate = await getEarliestTransactionDate(accountId);
    startDate?.setHours(0, 0, 0, 0);
  }

  const stored = await getStoredBalanceHistory(accountId, startDate);
  if (stored.length > 0) {
    return stored.reverse().map((point) => ({
      date: point.date.toISOString().slice(0, 10),
      balance: Number.parseFloat(point.balanceInAccountCurrency),
    }));
  }

  const effectiveStart = startDate ?? new Date();
  effectiveStart.setHours(0, 0, 0, 0);
  const [priorSum, changes] = await Promise.all([
    getTransactionSumBefore(accountId, effectiveStart),
    getDailyTransactionChanges(accountId, effectiveStart),
  ]);
  return buildBalanceHistory(
    effectiveStart,
    new Date(),
    calculateBalance(
      Number.parseFloat(account.startingBalance ?? "0"),
      priorSum,
    ),
    changes.map((item) => ({
      date: item.date,
      amount: Number.parseFloat(item.amount),
    })),
  );
}
