"use server";

import { revalidatePath } from "next/cache";
import { eq, and, inArray, gte, lt, sql, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  budgets,
  budgetCategories,
  categories,
  transactions,
  users,
} from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth-helpers";
import { computeBudgetStatus } from "@/features/budgets/domain/status";
import { getCurrentPeriodRange } from "@/features/budgets/domain/period";
import { validateBudgetInput } from "@/features/budgets/domain/validation";
import type {
  BudgetCreateInput,
  BudgetKpis,
  BudgetPeriod,
  BudgetUpdateInput,
  BudgetViewModel,
} from "@/features/budgets/domain/contracts";

export type {
  BudgetCreateInput,
  BudgetKpis,
  BudgetPeriod,
  BudgetStatus,
  BudgetUpdateInput,
  BudgetViewModel,
} from "@/features/budgets/domain/contracts";

async function getUserCurrency(userId: string): Promise<string> {
  const result = await db
    .select({ functionalCurrency: users.functionalCurrency })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return result[0]?.functionalCurrency || "EUR";
}

type BudgetWithCategories = typeof budgets.$inferSelect & {
  budgetCategories: Array<{
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
          spent: sql<string>`COALESCE(SUM(${transactions.functionalAmount}), 0)`,
        })
        .from(budgetCategories)
        .innerJoin(
          transactions,
          sql`COALESCE(${transactions.categoryId}, ${transactions.categorySystemId}) = ${budgetCategories.categoryId}`,
        )
        .where(
          and(
            inArray(budgetCategories.budgetId, group.budgetIds),
            eq(transactions.userId, userId),
            eq(transactions.transactionType, "debit"),
            eq(transactions.includeInAnalytics, true),
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

  const spentByBudgetId = await computeSpentByBudgetId(
    userId,
    budgetsWithCategories,
  );

  return budgetsWithCategories.map((budget) =>
    toBudgetViewModel(budget, spentByBudgetId.get(budget.id) ?? 0),
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

  const spentByBudgetId = await computeSpentByBudgetId(userId, [budget]);
  return toBudgetViewModel(budget, spentByBudgetId.get(budget.id) ?? 0);
}

// ============================================================================
// CRUD Operations
// ============================================================================

export async function createBudget(
  input: BudgetCreateInput,
): Promise<{
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

    const ownedCategories = await db.query.categories.findMany({
      where: and(
        inArray(categories.id, input.categoryIds),
        eq(categories.userId, userId),
      ),
    });
    if (ownedCategories.length !== input.categoryIds.length) {
      return { success: false, error: "Invalid category" };
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

      await tx.insert(budgetCategories).values(
        input.categoryIds.map((categoryId) => ({
          budgetId: created.id,
          categoryId,
        })),
      );
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
      categoryIds: input.categoryIds,
    });
    if (input.categoryIds !== undefined && validationError) {
      return { success: false, error: validationError };
    }

    if (input.categoryIds !== undefined) {
      const ownedCategories = await db.query.categories.findMany({
        where: and(
          inArray(categories.id, input.categoryIds),
          eq(categories.userId, userId),
        ),
      });
      if (ownedCategories.length !== input.categoryIds.length) {
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

      if (input.categoryIds !== undefined) {
        await tx
          .delete(budgetCategories)
          .where(eq(budgetCategories.budgetId, id));
        await tx.insert(budgetCategories).values(
          input.categoryIds.map((categoryId) => ({
            budgetId: id,
            categoryId,
          })),
        );
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
  categoryIds: string[];
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
      categoryIds: budget.budgetCategories.map((bc) => bc.categoryId),
    };
  } catch (error) {
    console.error("Failed to get budget:", error);
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

    return {
      totalBudgeted: activeBudgets.reduce((sum, b) => sum + b.amount, 0),
      totalSpent: activeBudgets.reduce((sum, b) => sum + b.spent, 0),
      overBudgetCount: activeBudgets.filter(
        (b) => b.status === "over_budget",
      ).length,
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
