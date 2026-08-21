import type { UpdateAccountInput } from "../domain/contracts";
import {
  deactivateAccountViaBackend,
  findActiveOwnedAccountWithLogoViaBackend,
  findOwnedAccountViaBackend,
  getDailyTransactionChangesViaBackend,
  getEarliestTransactionDateViaBackend,
  getLatestStoredBalanceViaBackend,
  getStoredBalanceHistoryViaBackend,
  getTransactionSumBeforeViaBackend,
  getTransactionSumViaBackend,
  insertManualAccountViaBackend,
  permanentlyDeleteAccountViaBackend,
  updateAccountBalancesViaBackend,
  updateOwnedAccountViaBackend,
} from "./accounts-repository.gateway";

export function findOwnedAccount(userId: string, accountId: string) {
  return findOwnedAccountViaBackend(userId, accountId);
}

export function findActiveOwnedAccountWithLogo(userId: string, accountId: string) {
  return findActiveOwnedAccountWithLogoViaBackend(userId, accountId);
}

export async function insertManualAccount(
  userId: string,
  input: {
    name: string;
    accountType: string;
    institution?: string;
    currency: string;
    startingBalance?: number;
    creditLimit?: number;
  },
) {
  return insertManualAccountViaBackend(userId, input);
}

export async function updateOwnedAccount(
  userId: string,
  accountId: string,
  input: UpdateAccountInput,
) {
  await updateOwnedAccountViaBackend(userId, accountId, input);
}

export async function deactivateAccount(userId: string, accountId: string) {
  await deactivateAccountViaBackend(userId, accountId);
}

export async function permanentlyDeleteAccount(userId: string, accountId: string) {
  return permanentlyDeleteAccountViaBackend(userId, accountId);
}

export async function getTransactionSum(userId: string, accountId: string, through?: Date) {
  return getTransactionSumViaBackend(userId, accountId, through);
}

export async function updateAccountBalances(
  userId: string,
  accountId: string,
  values: { startingBalance?: number; functionalBalance: number },
) {
  await updateAccountBalancesViaBackend(userId, accountId, values);
}

export async function getEarliestTransactionDate(userId: string, accountId: string) {
  return getEarliestTransactionDateViaBackend(userId, accountId);
}

export function getStoredBalanceHistory(
  userId: string,
  accountId: string,
  startDate: Date | null,
) {
  return getStoredBalanceHistoryViaBackend(userId, accountId, startDate);
}

export async function getDailyTransactionChanges(
  userId: string,
  accountId: string,
  startDate: Date,
) {
  return getDailyTransactionChangesViaBackend(userId, accountId, startDate);
}

export async function getTransactionSumBefore(userId: string, accountId: string, date: Date) {
  return getTransactionSumBeforeViaBackend(userId, accountId, date);
}

export function getLatestStoredBalance(userId: string, accountId: string, date: Date) {
  return getLatestStoredBalanceViaBackend(userId, accountId, date);
}
