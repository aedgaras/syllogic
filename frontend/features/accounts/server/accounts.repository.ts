import { and, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accountBalances,
  accounts,
  recurringTransactions,
  subscriptionSuggestions,
  transactions,
  type NewAccount,
} from "@/lib/db/schema";
import type { UpdateAccountInput } from "../domain/contracts";

export function findOwnedAccount(userId: string, accountId: string) {
  return db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), eq(accounts.userId, userId)),
  });
}

export function findActiveOwnedAccountWithLogo(
  userId: string,
  accountId: string,
) {
  return db.query.accounts.findFirst({
    where: and(
      eq(accounts.id, accountId),
      eq(accounts.userId, userId),
      eq(accounts.isActive, true),
    ),
    with: {
      logo: {
        columns: { id: true, logoUrl: true, updatedAt: true },
      },
    },
  });
}

export async function insertManualAccount(
  userId: string,
  input: {
    name: string;
    accountType: string;
    institution?: string;
    currency: string;
    startingBalance?: number;
  },
) {
  const balance = String(input.startingBalance ?? 0);
  const [result] = await db
    .insert(accounts)
    .values({
      userId,
      name: input.name,
      accountType: input.accountType,
      institution: input.institution || null,
      currency: input.currency,
      startingBalance: balance,
      functionalBalance: balance,
      provider: "manual",
      isActive: true,
    })
    .returning({ id: accounts.id });
  return result;
}

export async function updateOwnedAccount(
  accountId: string,
  input: UpdateAccountInput,
) {
  const values: Partial<NewAccount> = { updatedAt: new Date() };
  if (input.name !== undefined) values.name = input.name;
  if (input.accountType !== undefined) values.accountType = input.accountType;
  if ("institution" in input) values.institution = input.institution ?? null;
  if (input.currency !== undefined) values.currency = input.currency;
  if (input.startingBalance !== undefined)
    values.startingBalance = String(input.startingBalance);
  if ("logoId" in input) values.logoId = input.logoId ?? null;
  await db.update(accounts).set(values).where(eq(accounts.id, accountId));
}

export async function deactivateAccount(accountId: string) {
  await db
    .update(accounts)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(accounts.id, accountId));
}

export async function permanentlyDeleteAccount(
  userId: string,
  accountId: string,
) {
  await db
    .delete(recurringTransactions)
    .where(
      and(
        eq(recurringTransactions.accountId, accountId),
        eq(recurringTransactions.userId, userId),
      ),
    );
  await db
    .delete(subscriptionSuggestions)
    .where(
      and(
        eq(subscriptionSuggestions.accountId, accountId),
        eq(subscriptionSuggestions.userId, userId),
      ),
    );
  const deletedBalances = await db
    .delete(accountBalances)
    .where(eq(accountBalances.accountId, accountId))
    .returning({ id: accountBalances.id });
  const deletedTransactions = await db
    .delete(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        eq(transactions.userId, userId),
      ),
    )
    .returning({ id: transactions.id });
  await db
    .delete(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
  return {
    deletedBalances: deletedBalances.length,
    deletedTransactions: deletedTransactions.length,
  };
}

export async function getTransactionSum(accountId: string, through?: Date) {
  const where = through
    ? and(
        eq(transactions.accountId, accountId),
        lte(transactions.bookedAt, through),
      )
    : eq(transactions.accountId, accountId);
  const rows = await db
    .select({
      total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)`,
    })
    .from(transactions)
    .where(where);
  return Number.parseFloat(rows[0]?.total ?? "0");
}

export async function updateAccountBalances(
  accountId: string,
  values: { startingBalance?: number; functionalBalance: number },
) {
  await db
    .update(accounts)
    .set({
      ...(values.startingBalance === undefined
        ? {}
        : { startingBalance: values.startingBalance.toFixed(2) }),
      functionalBalance: values.functionalBalance.toFixed(2),
      updatedAt: new Date(),
    })
    .where(eq(accounts.id, accountId));
}

export async function getEarliestTransactionDate(accountId: string) {
  const rows = await db
    .select({
      date: sql<Date | null>`MIN(${transactions.bookedAt})`,
    })
    .from(transactions)
    .where(eq(transactions.accountId, accountId));
  return rows[0]?.date ? new Date(rows[0].date) : null;
}

export function getStoredBalanceHistory(
  accountId: string,
  startDate: Date | null,
) {
  return db.query.accountBalances.findMany({
    where: startDate
      ? and(
          eq(accountBalances.accountId, accountId),
          gte(accountBalances.date, startDate),
        )
      : eq(accountBalances.accountId, accountId),
    orderBy: [desc(accountBalances.date)],
  });
}

export async function getDailyTransactionChanges(
  accountId: string,
  startDate: Date,
) {
  return db
    .select({
      date: sql<string>`DATE(${transactions.bookedAt})`,
      amount: sql<string>`SUM(${transactions.amount})`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        gte(transactions.bookedAt, startDate),
      ),
    )
    .groupBy(sql`DATE(${transactions.bookedAt})`)
    .orderBy(sql`DATE(${transactions.bookedAt})`);
}

export async function getTransactionSumBefore(accountId: string, date: Date) {
  const rows = await db
    .select({
      total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        lt(transactions.bookedAt, date),
      ),
    );
  return Number.parseFloat(rows[0]?.total ?? "0");
}

export function getLatestStoredBalance(accountId: string, date: Date) {
  return db.query.accountBalances.findFirst({
    where: and(
      eq(accountBalances.accountId, accountId),
      lte(accountBalances.date, date),
    ),
    orderBy: [desc(accountBalances.date)],
  });
}
