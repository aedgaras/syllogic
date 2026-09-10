/**
 * Category filtering utilities
 * Provides reusable functions for filtering categories by type
 */

export type CategoryType = "expense" | "income" | "transfer";

/**
 * Filter out categories that should be hidden from manual selection
 * (e.g., "Balancing Transfer" which is system-assigned only)
 */
export function filterSelectableCategories<
  T extends { hideFromSelection?: boolean | null; name?: string },
>(categories: T[]): T[] {
  return categories.filter((c) => !c.hideFromSelection);
}

/**
 * Filter categories by a specific type
 */
export function filterCategoriesByType<
  T extends { categoryType: string | null },
>(categories: T[], type: CategoryType): T[] {
  return categories.filter((c) => c.categoryType === type);
}

/**
 * Group categories by their type
 */
export function groupCategoriesByType<
  T extends { categoryType: string | null },
>(
  categories: T[],
): {
  expense: T[];
  income: T[];
  transfer: T[];
} {
  return {
    expense: filterCategoriesByType(categories, "expense"),
    income: filterCategoriesByType(categories, "income"),
    transfer: filterCategoriesByType(categories, "transfer"),
  };
}

/**
 * Get categories that apply to a transaction type
 * For debits: expense and transfer categories
 * For credits: income and transfer categories
 * Automatically filters out categories hidden from selection
 */
export function getCategoriesForTransactionType<
  T extends { categoryType: string | null; hideFromSelection?: boolean | null },
>(categories: T[], transactionType: "debit" | "credit"): T[] {
  const selectableCategories = filterSelectableCategories(categories);
  if (transactionType === "debit") {
    return selectableCategories.filter(
      (c) => c.categoryType === "expense" || c.categoryType === "transfer",
    );
  }
  return selectableCategories.filter(
    (c) => c.categoryType === "income" || c.categoryType === "transfer",
  );
}

/**
 * Get a human-readable label for a category type
 */
export function getCategoryTypeLabel(type: CategoryType): string {
  switch (type) {
    case "expense":
      return "Expense";
    case "income":
      return "Income";
    case "transfer":
      return "Transfer";
  }
}

/**
 * Category groups ("sections": Needs, Wants, Savings, Income)
 *
 * A group is an ordinary category row that gathers other categories one level
 * below it (`parentId`). It is never offered when picking a category for a
 * transaction, which is what `hideFromSelection` records. Seeded groups carry
 * a `group_`-prefixed `systemKey`; user-created ones carry none. Other hidden
 * system rows (e.g. `balancing_transfer`) are not groups, hence the systemKey
 * check.
 */
export const CATEGORY_GROUP_KEY_PREFIX = "group_";

export interface GroupShapedCategory {
  id: string;
  parentId?: string | null;
  hideFromSelection?: boolean | null;
  systemKey?: string | null;
}

export function isCategoryGroup<T extends GroupShapedCategory>(
  category: T,
  all?: T[],
): boolean {
  if (category.parentId) return false;
  if (all?.some((other) => other.parentId === category.id)) return true;
  if (!category.hideFromSelection) return false;
  return (
    !category.systemKey ||
    category.systemKey.startsWith(CATEGORY_GROUP_KEY_PREFIX)
  );
}

export interface CategorySection<T> {
  /** The group row, or null for the "Ungrouped" bucket. */
  group: T | null;
  categories: T[];
}

/**
 * Split a single category type's rows into `[...groups, ungrouped]` sections,
 * each group followed by its members. Groups keep the incoming order; the
 * ungrouped bucket is only present when it has members.
 */
export function splitCategoriesIntoSections<T extends GroupShapedCategory>(
  categories: T[],
): CategorySection<T>[] {
  const groups = categories.filter((category) =>
    isCategoryGroup(category, categories),
  );
  const groupIds = new Set(groups.map((group) => group.id));

  const sections: CategorySection<T>[] = groups.map((group) => ({
    group,
    categories: categories.filter((category) => category.parentId === group.id),
  }));

  const ungrouped = categories.filter(
    (category) =>
      !groupIds.has(category.id) &&
      (!category.parentId || !groupIds.has(category.parentId)),
  );
  if (ungrouped.length > 0) {
    sections.push({ group: null, categories: ungrouped });
  }

  return sections;
}
