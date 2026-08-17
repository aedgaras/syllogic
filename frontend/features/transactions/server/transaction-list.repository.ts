import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema";
import { resolveMissingAccountLogos } from "@/lib/actions/account-logos";
import { hasActiveTransactionFilters } from "../query-state";
import type {
  TransactionSortField,
  TransactionSortOrder,
  TransactionsQueryState,
} from "../domain/contracts";
import type { TransactionListRepository } from "../application/get-transaction-page";
import {
  mapTransactionListRows,
  type TransactionListRow,
} from "./transaction-list.mapper";

function normalizeAccountIds(accountIds: string[]) {
  return Array.from(new Set(accountIds.map((id) => id.trim()).filter(Boolean)));
}

function toNumberOrUndefined(value?: string) {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resolveSortOrder(
  sort: TransactionSortField,
  order: TransactionSortOrder,
) {
  if (sort === "amount")
    return order === "asc"
      ? [asc(transactions.amount), desc(transactions.bookedAt)]
      : [desc(transactions.amount), desc(transactions.bookedAt)];
  if (sort === "description")
    return order === "asc"
      ? [asc(transactions.description), desc(transactions.bookedAt)]
      : [desc(transactions.description), desc(transactions.bookedAt)];
  if (sort === "merchant")
    return order === "asc"
      ? [asc(transactions.merchant), desc(transactions.bookedAt)]
      : [desc(transactions.merchant), desc(transactions.bookedAt)];
  return order === "asc"
    ? [asc(transactions.bookedAt), desc(transactions.id)]
    : [desc(transactions.bookedAt), desc(transactions.id)];
}

export async function hydrateResolvedAccountLogos(rows: TransactionListRow[]) {
  const uniqueAccounts = Array.from(
    new Map(
      rows
        .filter((row) => row.account)
        .map((row) => [
          row.account!.id,
          {
            id: row.account!.id,
            institution: row.account!.institution,
            logoId: row.account!.logoId,
            logo: row.account!.logo,
          },
        ]),
    ).values(),
  );
  const resolvedAccounts = await resolveMissingAccountLogos(uniqueAccounts);
  const resolvedById = new Map(
    resolvedAccounts.map((account) => [account.id, account]),
  );

  return rows.map((row) => {
    if (!row.account) return row;
    const resolved = resolvedById.get(row.account.id);
    if (!resolved) return row;
    return {
      ...row,
      account: {
        ...row.account,
        logoId: resolved.logoId,
        logo: resolved.logo
          ? {
              id: resolved.logo.id,
              logoUrl: resolved.logo.logoUrl,
              updatedAt: resolved.logo.updatedAt ?? null,
            }
          : null,
      },
    };
  });
}

async function getLatestTransactionDateForScope(
  userId: string,
  accountIds: string[],
) {
  const conditions = [eq(transactions.userId, userId)];
  if (accountIds.length)
    conditions.push(inArray(transactions.accountId, accountIds));
  const result = await db
    .select({ latestDate: sql<string>`MAX(${transactions.bookedAt})` })
    .from(transactions)
    .where(and(...conditions));
  return result[0]?.latestDate ? new Date(result[0].latestDate) : new Date();
}

async function buildWhereClause(userId: string, input: TransactionsQueryState) {
  const accountIds = normalizeAccountIds(input.accountIds);
  const conditions = [eq(transactions.userId, userId)];
  if (accountIds.length)
    conditions.push(inArray(transactions.accountId, accountIds));

  let resolvedFrom: Date | undefined;
  let resolvedTo: Date | undefined;
  let effectiveHorizon: number | undefined;
  if (input.from) {
    resolvedFrom = new Date(`${input.from}T00:00:00.000Z`);
    resolvedTo = input.to
      ? new Date(`${input.to}T23:59:59.999Z`)
      : await getLatestTransactionDateForScope(userId, accountIds);
    resolvedTo.setHours(23, 59, 59, 999);
    if (resolvedTo < resolvedFrom) {
      resolvedTo = new Date(resolvedFrom);
      resolvedTo.setHours(23, 59, 59, 999);
    }
  } else if (input.horizon) {
    resolvedTo = await getLatestTransactionDateForScope(userId, accountIds);
    resolvedTo.setHours(23, 59, 59, 999);
    effectiveHorizon = input.horizon;
    resolvedFrom = new Date(resolvedTo);
    resolvedFrom.setDate(resolvedFrom.getDate() - (effectiveHorizon - 1));
    resolvedFrom.setHours(0, 0, 0, 0);
  }
  if (resolvedFrom) conditions.push(gte(transactions.bookedAt, resolvedFrom));
  if (resolvedTo) conditions.push(lte(transactions.bookedAt, resolvedTo));

  if (input.search)
    conditions.push(
      or(
        ilike(transactions.description, `%${input.search}%`),
        ilike(transactions.merchant, `%${input.search}%`),
      )!,
    );
  const categoryIds = input.category.filter(
    (value) => value !== "uncategorized",
  );
  const includeUncategorized = input.category.includes("uncategorized");
  if (categoryIds.length || includeUncategorized) {
    const categoryConditions = [];
    if (categoryIds.length) {
      categoryConditions.push(inArray(transactions.categoryId, categoryIds));
      categoryConditions.push(
        and(
          isNull(transactions.categoryId),
          inArray(transactions.categorySystemId, categoryIds),
        )!,
      );
    }
    if (includeUncategorized)
      categoryConditions.push(
        and(
          isNull(transactions.categoryId),
          isNull(transactions.categorySystemId),
        )!,
      );
    conditions.push(or(...categoryConditions)!);
  }
  const includesPending = input.status.includes("pending");
  const includesCompleted = input.status.includes("completed");
  if (includesPending !== includesCompleted)
    conditions.push(
      includesPending
        ? eq(transactions.pending, true)
        : or(eq(transactions.pending, false), isNull(transactions.pending))!,
    );

  const subscriptionIds = input.subscription.filter(
    (value) => value !== "no_subscription",
  );
  const includesNoSubscription = input.subscription.includes("no_subscription");
  if (subscriptionIds.length || includesNoSubscription) {
    const subscriptionConditions = [];
    if (subscriptionIds.length)
      subscriptionConditions.push(
        inArray(transactions.recurringTransactionId, subscriptionIds),
      );
    if (includesNoSubscription)
      subscriptionConditions.push(isNull(transactions.recurringTransactionId));
    conditions.push(or(...subscriptionConditions)!);
  }
  const includesAnalytics = input.analytics.includes("included");
  const includesNonAnalytics = input.analytics.includes("excluded");
  if (includesAnalytics !== includesNonAnalytics)
    conditions.push(eq(transactions.includeInAnalytics, includesAnalytics));
  const minAmount = toNumberOrUndefined(input.minAmount);
  const maxAmount = toNumberOrUndefined(input.maxAmount);
  if (minAmount !== undefined)
    conditions.push(sql`ABS(${transactions.amount}) >= ${minAmount}`);
  if (maxAmount !== undefined)
    conditions.push(sql`ABS(${transactions.amount}) <= ${maxAmount}`);

  return {
    whereClause: and(...conditions)!,
    resolvedFrom,
    resolvedTo,
    effectiveHorizon,
  };
}

export const transactionListRepository: TransactionListRepository = {
  async getPage(userId, input) {
    const { whereClause, resolvedFrom, resolvedTo, effectiveHorizon } =
      await buildWhereClause(userId, input);
    const shouldComputeFilteredTotals = hasActiveTransactionFilters(input);
    const [countRows, rawRows, totalsRows] = await Promise.all([
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(transactions)
        .where(whereClause),
      db.query.transactions.findMany({
        where: whereClause,
        orderBy: resolveSortOrder(input.sort, input.order),
        limit: input.pageSize,
        offset: (input.page - 1) * input.pageSize,
        with: {
          account: {
            with: {
              logo: { columns: { id: true, logoUrl: true, updatedAt: true } },
            },
          },
          category: true,
          categorySystem: true,
          recurringTransaction: true,
          transactionLink: true,
          internalTransfer: {
            with: {
              sourceAccount: { columns: { id: true, name: true } },
              pocketAccount: { columns: { id: true, name: true } },
            },
          },
        },
      }),
      shouldComputeFilteredTotals
        ? db
            .select({
              totalIn: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.transactionType} = 'credit' THEN ABS(${transactions.amount}) WHEN ${transactions.transactionType} IS NULL AND ${transactions.amount} > 0 THEN ${transactions.amount} ELSE 0 END), 0)`,
              totalOut: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.transactionType} = 'debit' THEN ABS(${transactions.amount}) WHEN ${transactions.transactionType} IS NULL AND ${transactions.amount} < 0 THEN ABS(${transactions.amount}) ELSE 0 END), 0)`,
            })
            .from(transactions)
            .where(whereClause)
        : Promise.resolve([]),
    ]);
    const rows = await hydrateResolvedAccountLogos(
      rawRows as TransactionListRow[],
    );
    return {
      rows: mapTransactionListRows(rows, (row) =>
        console.warn(
          "[getTransactionPage] Transaction missing account relation",
          { transactionId: row.id, accountId: row.accountId },
        ),
      ),
      totalCount: countRows[0]?.count ?? 0,
      filteredTotals: shouldComputeFilteredTotals
        ? {
            totalIn: Number.parseFloat(totalsRows[0]?.totalIn ?? "0"),
            totalOut: Number.parseFloat(totalsRows[0]?.totalOut ?? "0"),
          }
        : null,
      page: input.page,
      pageSize: input.pageSize,
      resolvedFrom: resolvedFrom?.toISOString().slice(0, 10),
      resolvedTo: resolvedTo?.toISOString().slice(0, 10),
      effectiveHorizon,
    };
  },
};
