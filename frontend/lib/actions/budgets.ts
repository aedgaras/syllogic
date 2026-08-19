"use server";

import { revalidatePath } from "next/cache";
import { eq, and, inArray, gte, lt, sql, desc, or } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  budgets,
  budgetCategories,
  categories,
  transactions,
  users,
  exchangeRates,
} from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth-helpers";
import { computeBudgetStatus } from "@/features/budgets/domain/status";
import { getCurrentPeriodRange } from "@/features/budgets/domain/period";
import { validateBudgetInput } from "@/features/budgets/domain/validation";
import type {
  BudgetCreateInput,
  BudgetDetailViewModel,
  BudgetKpis,
  BudgetPeriod,
  BudgetUpdateInput,
  BudgetViewModel,
} from "@/features/budgets/domain/contracts";

export type {
  BudgetCategoryDetail,
  BudgetCategoryInput,
  BudgetCategoryRef,
  BudgetCreateInput,
  BudgetDetailViewModel,
  BudgetKpis,
  BudgetPeriod,
  BudgetStatus,
  BudgetUpdateInput,
  BudgetViewModel,
} from "@/features/budgets/domain/contracts";

// Transfer transactions are normally excluded from spend via includeInAnalytics=false
// (they're money moving between the user's own accounts, not spend). Savings/Investment
// Transfer categories are the exception: a budget built on them is explicitly meant to
// track outgoing transfers, so those two categories bypass the includeInAnalytics gate.
// Scoped narrowly to these two systemKeys so generic Internal/External Transfer budgets
// are unaffected, and so this doesn't change spend totals anywhere else in the app.
const TRANSFER_SPEND_BYPASS_KEYS = ["savings_transfer", "investment_transfer"];

function spendEligibilityCondition() {
  return or(
    eq(transactions.includeInAnalytics, true),
    inArray(categories.systemKey, TRANSFER_SPEND_BYPASS_KEYS),
  );
}

async function getUserCurrency(userId: string): Promise<string> {
  const result = await db
    .select({ functionalCurrency: users.functionalCurrency })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return result[0]?.functionalCurrency || "EUR";
}

// Transaction spend is always summed in the user's functional currency
// (transactions.functionalAmount), but a budget's `amount`/`subLimit` are
// entered in the budget's own chosen currency. Without converting one side,
// percentage/status comparisons silently mix currencies whenever a budget's
// currency differs from the user's functional currency.
async function convertCurrency(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
): Promise<number> {
  if (amount === 0 || fromCurrency === toCurrency) return amount;

  const rate = await db.query.exchangeRates.findFirst({
    where: and(
      eq(exchangeRates.baseCurrency, fromCurrency),
      eq(exchangeRates.targetCurrency, toCurrency),
    ),
    orderBy: [desc(exchangeRates.date)],
  });
  if (rate) return amount * parseFloat(rate.rate);

  const inverseRate = await db.query.exchangeRates.findFirst({
    where: and(
      eq(exchangeRates.baseCurrency, toCurrency),
      eq(exchangeRates.targetCurrency, fromCurrency),
    ),
    orderBy: [desc(exchangeRates.date)],
  });
  if (inverseRate) return amount / parseFloat(inverseRate.rate);

  // No exchange rate on record — fall back to unconverted rather than
  // throwing, matching the prior (unconverted) behavior for this edge case.
  return amount;
}

type BudgetWithCategories = typeof budgets.$inferSelect & {
  budgetCategories: Array<{
    subLimit: string | null;
    category: { id: string; name: string; color: string | null };
  }>;
};

async function computeSpentByBudgetId(
  userId: string,
  budgetsWithCategories: BudgetWithCategories[],
): Promise<Map<string, number>> {
  if (budgetsWithCategories.length === 0) return new Map();

  const now = new Date();
  const groups = new Map<
    string,
    { start: Date; end: Date; budgetIds: string[] }
  >();

  for (const budget of budgetsWithCategories) {
    const range = getCurrentPeriodRange(
      budget.period as BudgetPeriod,
      budget.startDate ? new Date(budget.startDate) : null,
      now,
    );
    const key = `${range.start.toISOString()}|${range.end.toISOString()}`;
    const group = groups.get(key) ?? {
      start: range.start,
      end: range.end,
      budgetIds: [],
    };
    group.budgetIds.push(budget.id);
    groups.set(key, group);
  }

  const spentByBudgetId = new Map<string, number>();

  await Promise.all(
    Array.from(groups.values()).map(async (group) => {
      const rows = await db
        .select({
          budgetId: budgetCategories.budgetId,
          spent: sql<string>`COALESCE(SUM(ABS(${transactions.functionalAmount})), 0)`,
        })
        .from(budgetCategories)
        .innerJoin(
          transactions,
          sql`COALESCE(${transactions.categoryId}, ${transactions.categorySystemId}) = ${budgetCategories.categoryId}`,
        )
        .innerJoin(categories, eq(categories.id, budgetCategories.categoryId))
        .where(
          and(
            inArray(budgetCategories.budgetId, group.budgetIds),
            eq(transactions.userId, userId),
            eq(transactions.transactionType, "debit"),
            spendEligibilityCondition(),
            gte(transactions.bookedAt, group.start),
            lt(transactions.bookedAt, group.end),
          ),
        )
        .groupBy(budgetCategories.budgetId);

      for (const row of rows) {
        spentByBudgetId.set(row.budgetId, parseFloat(row.spent));
      }
    }),
  );

  return spentByBudgetId;
}

function toBudgetViewModel(
  budget: BudgetWithCategories,
  spent: number,
): BudgetViewModel {
  const amount = parseFloat(budget.amount);
  const percentage = amount > 0 ? (spent / amount) * 100 : 0;
  return {
    id: budget.id,
    name: budget.name,
    amount,
    currency: budget.currency || "EUR",
    period: budget.period as BudgetPeriod,
    isActive: budget.isActive ?? true,
    categories: budget.budgetCategories.map((bc) => ({
      id: bc.category.id,
      name: bc.category.name,
      color: bc.category.color,
      subLimit: bc.subLimit === null ? null : parseFloat(bc.subLimit),
    })),
    spent,
    status: computeBudgetStatus(spent, amount),
    percentage,
  };
}

async function fetchBudgetViewModels(
  userId: string,
  includeInactive: boolean,
): Promise<BudgetViewModel[]> {
  const whereCondition = includeInactive
    ? eq(budgets.userId, userId)
    : and(eq(budgets.userId, userId), eq(budgets.isActive, true));

  const budgetsWithCategories = await db.query.budgets.findMany({
    where: whereCondition,
    with: {
      budgetCategories: {
        with: { category: true },
      },
    },
    orderBy: [desc(budgets.createdAt)],
  });

  const [spentByBudgetId, functionalCurrency] = await Promise.all([
    computeSpentByBudgetId(userId, budgetsWithCategories),
    getUserCurrency(userId),
  ]);

  return Promise.all(
    budgetsWithCategories.map(async (budget) => {
      const spent = await convertCurrency(
        spentByBudgetId.get(budget.id) ?? 0,
        functionalCurrency,
        budget.currency || "EUR",
      );
      return toBudgetViewModel(budget, spent);
    }),
  );
}

async function fetchBudgetViewModelById(
  userId: string,
  id: string,
): Promise<BudgetViewModel | undefined> {
  const budget = await db.query.budgets.findFirst({
    where: and(eq(budgets.id, id), eq(budgets.userId, userId)),
    with: {
      budgetCategories: {
        with: { category: true },
      },
    },
  });
  if (!budget) return undefined;

  const [spentByBudgetId, functionalCurrency] = await Promise.all([
    computeSpentByBudgetId(userId, [budget]),
    getUserCurrency(userId),
  ]);
  const spent = await convertCurrency(
    spentByBudgetId.get(budget.id) ?? 0,
    functionalCurrency,
    budget.currency || "EUR",
  );
  return toBudgetViewModel(budget, spent);
}

// ============================================================================
// CRUD Operations
// ============================================================================

export async function createBudget(input: BudgetCreateInput): Promise<{
  success: boolean;
  error?: string;
  budgetId?: string;
  budget?: BudgetViewModel;
}> {
  const userId = await requireAuth();
  if (!userId) return { success: false, error: "Not authenticated" };

  try {
    const validationError = validateBudgetInput(input);
    if (validationError) return { success: false, error: validationError };

    const categoryIds = input.categories.map((c) => c.categoryId);
    if (categoryIds.length > 0) {
      const ownedCategories = await db.query.categories.findMany({
        where: and(
          inArray(categories.id, categoryIds),
          eq(categories.userId, userId),
        ),
      });
      if (ownedCategories.length !== categoryIds.length) {
        return { success: false, error: "Invalid category" };
      }
    }

    let budgetId = "";
    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(budgets)
        .values({
          userId,
          name: input.name.trim(),
          amount: input.amount.toFixed(2),
          currency: input.currency || "EUR",
          period: input.period,
        })
        .returning({ id: budgets.id });

      budgetId = created.id;

      if (input.categories.length > 0) {
        await tx.insert(budgetCategories).values(
          input.categories.map(({ categoryId, subLimit }) => ({
            budgetId: created.id,
            categoryId,
            subLimit: subLimit == null ? null : subLimit.toFixed(2),
          })),
        );
      }
    });

    revalidatePath("/budgets");
    const budget = await fetchBudgetViewModelById(userId, budgetId);
    return { success: true, budgetId, budget };
  } catch (error) {
    console.error("Failed to create budget:", error);
    return { success: false, error: "Failed to create budget" };
  }
}

export async function updateBudget(
  id: string,
  input: BudgetUpdateInput,
): Promise<{ success: boolean; error?: string; budget?: BudgetViewModel }> {
  const userId = await requireAuth();
  if (!userId) return { success: false, error: "Not authenticated" };

  try {
    const existing = await db.query.budgets.findFirst({
      where: and(eq(budgets.id, id), eq(budgets.userId, userId)),
    });
    if (!existing) return { success: false, error: "Budget not found" };

    const validationError = validateBudgetInput({
      name: input.name ?? existing.name,
      amount: input.amount ?? parseFloat(existing.amount),
    });
    if (validationError) {
      return { success: false, error: validationError };
    }

    const categoryIds = input.categories?.map((c) => c.categoryId);
    if (categoryIds !== undefined && categoryIds.length > 0) {
      const ownedCategories = await db.query.categories.findMany({
        where: and(
          inArray(categories.id, categoryIds),
          eq(categories.userId, userId),
        ),
      });
      if (ownedCategories.length !== categoryIds.length) {
        return { success: false, error: "Invalid category" };
      }
    }

    await db.transaction(async (tx) => {
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) updateData.name = input.name.trim();
      if (input.amount !== undefined)
        updateData.amount = input.amount.toFixed(2);
      if (input.currency !== undefined) updateData.currency = input.currency;
      if (input.period !== undefined) updateData.period = input.period;
      if (input.isActive !== undefined) updateData.isActive = input.isActive;

      await tx.update(budgets).set(updateData).where(eq(budgets.id, id));

      if (input.categories !== undefined) {
        await tx
          .delete(budgetCategories)
          .where(eq(budgetCategories.budgetId, id));
        if (input.categories.length > 0) {
          await tx.insert(budgetCategories).values(
            input.categories.map(({ categoryId, subLimit }) => ({
              budgetId: id,
              categoryId,
              subLimit: subLimit == null ? null : subLimit.toFixed(2),
            })),
          );
        }
      }
    });

    revalidatePath("/budgets");
    const budget = await fetchBudgetViewModelById(userId, id);
    return { success: true, budget };
  } catch (error) {
    console.error("Failed to update budget:", error);
    return { success: false, error: "Failed to update budget" };
  }
}

export async function deleteBudget(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const userId = await requireAuth();
  if (!userId) return { success: false, error: "Not authenticated" };

  try {
    const existing = await db.query.budgets.findFirst({
      where: and(eq(budgets.id, id), eq(budgets.userId, userId)),
    });
    if (!existing) return { success: false, error: "Budget not found" };

    await db.delete(budgets).where(eq(budgets.id, id));

    revalidatePath("/budgets");
    return { success: true };
  } catch (error) {
    console.error("Failed to delete budget:", error);
    return { success: false, error: "Failed to delete budget" };
  }
}

export async function toggleBudgetActive(
  id: string,
  isActive: boolean,
): Promise<{ success: boolean; error?: string }> {
  const userId = await requireAuth();
  if (!userId) return { success: false, error: "Not authenticated" };

  try {
    const existing = await db.query.budgets.findFirst({
      where: and(eq(budgets.id, id), eq(budgets.userId, userId)),
    });
    if (!existing) return { success: false, error: "Budget not found" };

    await db
      .update(budgets)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(budgets.id, id));

    revalidatePath("/budgets");
    return { success: true };
  } catch (error) {
    console.error("Failed to toggle budget active status:", error);
    return { success: false, error: "Failed to update status" };
  }
}

// ============================================================================
// Reads
// ============================================================================

export async function getBudgets(): Promise<BudgetViewModel[]> {
  const userId = await requireAuth();
  if (!userId) return [];

  try {
    return await fetchBudgetViewModels(userId, true);
  } catch (error) {
    console.error("Failed to get budgets:", error);
    return [];
  }
}

export async function getBudgetById(id: string): Promise<{
  id: string;
  name: string;
  amount: number;
  currency: string;
  period: BudgetPeriod;
  isActive: boolean;
  categories: Array<{ categoryId: string; subLimit: number | null }>;
} | null> {
  const userId = await requireAuth();
  if (!userId) return null;

  try {
    const budget = await db.query.budgets.findFirst({
      where: and(eq(budgets.id, id), eq(budgets.userId, userId)),
      with: { budgetCategories: true },
    });
    if (!budget) return null;

    return {
      id: budget.id,
      name: budget.name,
      amount: parseFloat(budget.amount),
      currency: budget.currency || "EUR",
      period: budget.period as BudgetPeriod,
      isActive: budget.isActive ?? true,
      categories: budget.budgetCategories.map((bc) => ({
        categoryId: bc.categoryId,
        subLimit: bc.subLimit === null ? null : parseFloat(bc.subLimit),
      })),
    };
  } catch (error) {
    console.error("Failed to get budget:", error);
    return null;
  }
}

async function computeSpentByCategoryForBudget(
  userId: string,
  budget: BudgetWithCategories,
): Promise<Map<string, number>> {
  const spentByCategoryId = new Map<string, number>();
  if (budget.budgetCategories.length === 0) return spentByCategoryId;

  const range = getCurrentPeriodRange(
    budget.period as BudgetPeriod,
    budget.startDate ? new Date(budget.startDate) : null,
    new Date(),
  );

  const rows = await db
    .select({
      categoryId: budgetCategories.categoryId,
      spent: sql<string>`COALESCE(SUM(ABS(${transactions.functionalAmount})), 0)`,
    })
    .from(budgetCategories)
    .innerJoin(
      transactions,
      sql`COALESCE(${transactions.categoryId}, ${transactions.categorySystemId}) = ${budgetCategories.categoryId}`,
    )
    .innerJoin(categories, eq(categories.id, budgetCategories.categoryId))
    .where(
      and(
        eq(budgetCategories.budgetId, budget.id),
        eq(transactions.userId, userId),
        eq(transactions.transactionType, "debit"),
        spendEligibilityCondition(),
        gte(transactions.bookedAt, range.start),
        lt(transactions.bookedAt, range.end),
      ),
    )
    .groupBy(budgetCategories.categoryId);

  for (const row of rows) {
    spentByCategoryId.set(row.categoryId, parseFloat(row.spent));
  }
  return spentByCategoryId;
}

export async function getBudgetDetail(
  id: string,
): Promise<BudgetDetailViewModel | null> {
  const userId = await requireAuth();
  if (!userId) return null;

  try {
    const budget = await db.query.budgets.findFirst({
      where: and(eq(budgets.id, id), eq(budgets.userId, userId)),
      with: {
        budgetCategories: {
          with: { category: true },
        },
      },
    });
    if (!budget) return null;

    const [spentByBudgetId, spentByCategoryId, functionalCurrency] =
      await Promise.all([
        computeSpentByBudgetId(userId, [budget]),
        computeSpentByCategoryForBudget(userId, budget),
        getUserCurrency(userId),
      ]);

    const budgetCurrency = budget.currency || "EUR";
    const overallSpent = await convertCurrency(
      spentByBudgetId.get(budget.id) ?? 0,
      functionalCurrency,
      budgetCurrency,
    );
    const base = toBudgetViewModel(budget, overallSpent);

    return {
      ...base,
      categories: await Promise.all(
        base.categories.map(async (ref) => {
          const spent = await convertCurrency(
            spentByCategoryId.get(ref.id) ?? 0,
            functionalCurrency,
            budgetCurrency,
          );
          const percentage =
            ref.subLimit != null && ref.subLimit > 0
              ? (spent / ref.subLimit) * 100
              : 0;
          const weight =
            ref.subLimit != null && base.amount > 0
              ? (ref.subLimit / base.amount) * 100
              : null;
          return {
            ...ref,
            spent,
            status:
              ref.subLimit == null
                ? ("no_limit" as const)
                : computeBudgetStatus(spent, ref.subLimit),
            percentage,
            weight,
          };
        }),
      ),
    };
  } catch (error) {
    console.error("Failed to get budget detail:", error);
    return null;
  }
}

export async function getBudgetKpis(): Promise<BudgetKpis> {
  const userId = await requireAuth();
  if (!userId) {
    return {
      totalBudgeted: 0,
      totalSpent: 0,
      overBudgetCount: 0,
      activeCount: 0,
      currency: "EUR",
    };
  }

  try {
    const [activeBudgets, currency] = await Promise.all([
      fetchBudgetViewModels(userId, false),
      getUserCurrency(userId),
    ]);

    // Budgets can each be in their own currency, but the KPI totals are a
    // single aggregate figure — convert every budget's amount/spent into
    // the user's functional currency before summing so budgets in different
    // currencies don't get added together as if they were the same unit.
    const [totalBudgeted, totalSpent] = await Promise.all([
      Promise.all(
        activeBudgets.map((b) =>
          convertCurrency(b.amount, b.currency, currency),
        ),
      ).then((amounts) => amounts.reduce((sum, a) => sum + a, 0)),
      Promise.all(
        activeBudgets.map((b) =>
          convertCurrency(b.spent, b.currency, currency),
        ),
      ).then((amounts) => amounts.reduce((sum, a) => sum + a, 0)),
    ]);

    return {
      totalBudgeted,
      totalSpent,
      overBudgetCount: activeBudgets.filter((b) => b.status === "over_budget")
        .length,
      activeCount: activeBudgets.length,
      currency,
    };
  } catch (error) {
    console.error("Failed to get budget KPIs:", error);
    return {
      totalBudgeted: 0,
      totalSpent: 0,
      overBudgetCount: 0,
      activeCount: 0,
      currency: "EUR",
    };
  }
}

export async function getCategoryBudgetUsage(): Promise<
  Record<string, Array<{ budgetId: string; budgetName: string }>>
> {
  const userId = await requireAuth();
  if (!userId) return {};

  try {
    const rows = await db
      .select({
        categoryId: budgetCategories.categoryId,
        budgetId: budgets.id,
        budgetName: budgets.name,
      })
      .from(budgetCategories)
      .innerJoin(budgets, eq(budgetCategories.budgetId, budgets.id))
      .where(and(eq(budgets.userId, userId), eq(budgets.isActive, true)));

    const usage: Record<
      string,
      Array<{ budgetId: string; budgetName: string }>
    > = {};
    for (const row of rows) {
      const entry = usage[row.categoryId] ?? [];
      entry.push({ budgetId: row.budgetId, budgetName: row.budgetName });
      usage[row.categoryId] = entry;
    }
    return usage;
  } catch (error) {
    console.error("Failed to get category budget usage:", error);
    return {};
  }
}
