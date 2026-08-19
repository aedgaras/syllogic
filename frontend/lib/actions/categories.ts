"use server";

import { logger } from "@/lib/logger";
import { revalidatePath, updateTag } from "next/cache";
import {
  createCategoryViaBackend,
  updateCategoryViaBackend,
  deleteCategoryViaBackend,
  fetchCategoriesViaBackend,
  getCategoryStatsViaBackend,
  ensureSystemTransferCategoriesViaBackend,
  type BackendCategory,
} from "@/lib/actions/categories.gateway";
import { requireAuth } from "@/lib/auth-helpers";
import { getCachedUserCategories, CACHE_TAGS } from "@/lib/data/cached";
import {
  DEFAULT_TRANSFER_CATEGORIES,
  DEFAULT_INTEREST_CATEGORIES,
} from "@/lib/constants/default-categories";

export type Category = BackendCategory;

export interface CategoryCreateInput {
  name: string;
  categoryType: "expense" | "income" | "transfer";
  color: string;
  icon: string;
  description?: string;
  categorizationInstructions?: string;
}

export interface CategoryInput {
  name: string;
  categoryType: "expense" | "income" | "transfer";
  color: string;
  icon: string;
  description?: string;
  categorizationInstructions?: string;
  isSystem?: boolean;
  hideFromSelection?: boolean;
  systemKey?: string;
}

export interface CategoryUpdateInput {
  name?: string;
  color?: string;
  icon?: string;
  description?: string;
  categorizationInstructions?: string;
}

export async function createCategory(
  input: CategoryCreateInput,
): Promise<{ success: boolean; error?: string; categoryId?: string }> {
  const userId = await requireAuth();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const created = await createCategoryViaBackend(userId, input);

    revalidatePath("/");
    revalidatePath("/settings");
    updateTag(CACHE_TAGS.categories(userId));
    return { success: true, categoryId: created.id };
  } catch (error) {
    logger.error("Failed to create category", { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create category",
    };
  }
}

export async function updateCategory(
  categoryId: string,
  input: CategoryUpdateInput,
): Promise<{ success: boolean; error?: string }> {
  const userId = await requireAuth();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    await updateCategoryViaBackend(userId, categoryId, input);

    revalidatePath("/");
    revalidatePath("/settings");
    updateTag(CACHE_TAGS.categories(userId));
    return { success: true };
  } catch (error) {
    logger.error("Failed to update category", { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update category",
    };
  }
}

export async function deleteCategory(
  categoryId: string,
): Promise<{ success: boolean; error?: string }> {
  const userId = await requireAuth();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    await deleteCategoryViaBackend(userId, categoryId);

    revalidatePath("/");
    revalidatePath("/settings");
    revalidatePath("/transactions");
    updateTag(CACHE_TAGS.categories(userId));
    return { success: true };
  } catch (error) {
    logger.error("Failed to delete category", { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete category",
    };
  }
}

export async function getCategories(): Promise<Category[]> {
  return getCachedUserCategories() as Promise<Category[]>;
}

// Alias for backward compatibility
export const getUserCategories = getCategories;

export async function getCategoriesByType(
  type: "expense" | "income" | "transfer",
): Promise<Category[]> {
  const userId = await requireAuth();

  if (!userId) {
    return [];
  }

  const all = await fetchCategoriesViaBackend(userId);
  return all
    .filter((category) => category.categoryType === type)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getCategoryByName(
  name: string,
): Promise<Category | null> {
  const userId = await requireAuth();

  if (!userId) {
    return null;
  }

  const all = await fetchCategoriesViaBackend(userId);
  return all.find((category) => category.name === name) ?? null;
}

/**
 * Additive, idempotent backfill: inserts any of the default system transfer
 * categories the user doesn't already have (matched by systemKey), without
 * touching any of their existing categories. Safe to call on every transfer
 * creation - a no-op after the first call for a given user.
 */
export async function ensureSystemTransferCategories(
  userId: string,
): Promise<void> {
  const seeds = DEFAULT_TRANSFER_CATEGORIES.filter(
    (category): category is typeof category & { key: string } => !!category.key,
  ).map((category) => ({
    key: category.key,
    name: category.name,
    categoryType: category.categoryType,
    color: category.color,
    icon: category.icon,
    description: category.description,
    hideFromSelection: category.hideFromSelection,
  }));

  // The backend performs the same additive/idempotent check (by systemKey,
  // falling back to name for pre-migration categories) before inserting.
  await ensureSystemTransferCategoriesViaBackend(userId, seeds);
}

/**
 * Additive, idempotent backfill for the "Interest" system category, mirroring
 * ensureSystemTransferCategories above. Safe to call on every interest entry.
 */
export async function ensureSystemInterestCategory(userId: string): Promise<void> {
  const seeds = DEFAULT_INTEREST_CATEGORIES.filter(
    (category): category is typeof category & { key: string } => !!category.key,
  ).map((category) => ({
    key: category.key,
    name: category.name,
    categoryType: category.categoryType,
    color: category.color,
    icon: category.icon,
    description: category.description,
    hideFromSelection: category.hideFromSelection,
  }));

  await ensureSystemTransferCategoriesViaBackend(userId, seeds);
}

/**
 * Get the count of transactions assigned to a category
 */
export async function getCategoryTransactionCount(
  categoryId: string,
): Promise<{ count: number; error?: string }> {
  const userId = await requireAuth();

  if (!userId) {
    return { count: 0, error: "Not authenticated" };
  }

  try {
    const { transactionCount } = await getCategoryStatsViaBackend(
      userId,
      categoryId,
    );
    return { count: transactionCount };
  } catch (error) {
    logger.error("Failed to count category transactions", { error });
    return { count: 0, error: "Failed to count transactions" };
  }
}

/**
 * Delete a category with optional reassignment of transactions
 * @param categoryId - The category to delete
 * @param reassignToCategoryId - If provided, reassign transactions to this category; if null, set to uncategorized
 */
export async function deleteCategoryWithReassignment(
  categoryId: string,
  reassignToCategoryId: string | null,
): Promise<{ success: boolean; error?: string; reassignedCount?: number }> {
  const userId = await requireAuth();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const { reassignedCount } = await deleteCategoryViaBackend(
      userId,
      categoryId,
      reassignToCategoryId,
    );

    revalidatePath("/");
    revalidatePath("/settings");
    revalidatePath("/transactions");
    updateTag(CACHE_TAGS.categories(userId));

    return { success: true, reassignedCount };
  } catch (error) {
    logger.error("Failed to delete category", { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete category",
    };
  }
}
