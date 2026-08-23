import { logger } from "@/lib/logger";
// Cached read layer. NOT a "use server" module.
// Two cache layers:
// - React.cache: per-request dedup (no TTL, scoped to a single render).
// - unstable_cache: cross-request, keyed by userId, invalidated by tag.
// Mutations MUST call revalidateTag(...) for the relevant tag below.

import { cache } from "react";
import { unstable_cache } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getAuthenticatedSession } from "@/lib/auth-helpers";
import { resolveMissingAccountLogos } from "@/lib/actions/account-logos";
import { fetchCategoriesViaBackend } from "@/lib/actions/categories.gateway";
import { listAccountsViaBackend } from "@/features/accounts/server/accounts-repository.gateway";
import type {
  OnboardingStatus,
  OnboardingStatusResult,
} from "@/lib/actions/onboarding";

export const CACHE_TAGS = {
  categories: (userId: string) => `categories:${userId}`,
  accounts: (userId: string) => `accounts:${userId}`,
  onboarding: (userId: string) => `onboarding:${userId}`,
  preferences: (userId: string) => `preferences:${userId}`,
} as const;

export const getCachedSession = cache(async () => {
  return getAuthenticatedSession();
});

// ---------- Categories ----------

async function fetchCategoriesForUser(userId: string) {
  const categories = await fetchCategoriesViaBackend(userId);
  return categories.sort((a, b) => a.name.localeCompare(b.name));
}

const getCachedCategoriesByUser = (userId: string) =>
  unstable_cache(() => fetchCategoriesForUser(userId), ["categories", userId], {
    tags: [CACHE_TAGS.categories(userId)],
  })();

export const getCachedUserCategories = cache(async () => {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId) return [];
  try {
    return await getCachedCategoriesByUser(userId);
  } catch (error) {
    logger.error("Failed to get cached user categories", { error });
    return [];
  }
});

// ---------- Accounts (slim, for filter dropdowns) ----------

async function fetchAccountsForUser(userId: string) {
  const rows = await listAccountsViaBackend(userId, { includeInactive: false });
  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      institution: row.institution,
      accountType: row.accountType,
      currency: row.currency,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const getCachedAccountsByUser = (userId: string) =>
  unstable_cache(() => fetchAccountsForUser(userId), ["accounts", userId], {
    tags: [CACHE_TAGS.accounts(userId)],
  })();

export const getCachedUserAccounts = cache(async () => {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId) return [];
  try {
    return await getCachedAccountsByUser(userId);
  } catch (error) {
    logger.error("Failed to get cached user accounts", { error });
    return [];
  }
});

// ---------- Accounts (full, with logos — superset for getAccounts) ----------

async function fetchFullAccountsForUser(userId: string) {
  const accountRows = await listAccountsViaBackend(userId, { includeInactive: false });
  accountRows.sort((a, b) => a.name.localeCompare(b.name));
  return resolveMissingAccountLogos(accountRows);
}

const getCachedFullAccountsByUser = (userId: string) =>
  unstable_cache(
    () => fetchFullAccountsForUser(userId),
    ["accounts:full", userId],
    { tags: [CACHE_TAGS.accounts(userId)] },
  )();

export const getCachedFullUserAccounts = cache(async () => {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId) return [];
  try {
    return await getCachedFullAccountsByUser(userId);
  } catch (error) {
    logger.error("Failed to get cached full user accounts", { error });
    return [];
  }
});

// ---------- Preferences (hide balances, tutorials) ----------

async function fetchPreferencesForUser(userId: string) {
  const user = await db.query.users.findFirst({
    columns: {
      hideBalances: true,
      tutorialsEnabled: true,
      defaultAccountId: true,
    },
    where: eq(users.id, userId),
  });
  return {
    hideBalances: user?.hideBalances ?? false,
    tutorialsEnabled: user?.tutorialsEnabled ?? true,
    defaultAccountId: user?.defaultAccountId ?? null,
  };
}

const getCachedPreferencesByUser = (userId: string) =>
  unstable_cache(
    () => fetchPreferencesForUser(userId),
    ["preferences", userId],
    { tags: [CACHE_TAGS.preferences(userId)] },
  )();

export const getCachedUserPreferences = cache(async () => {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId)
    return { hideBalances: false, tutorialsEnabled: true, defaultAccountId: null };
  try {
    return await getCachedPreferencesByUser(userId);
  } catch (error) {
    logger.error("Failed to get cached user preferences", { error });
    return { hideBalances: false, tutorialsEnabled: true, defaultAccountId: null };
  }
});

// ---------- Onboarding status ----------
// Inlined DB lookup (mirrors lib/actions/onboarding.ts#getOnboardingStatus) to
// avoid a circular import: that module is "use server" and pulls in storage,
// constants, and other action modules.

async function fetchOnboardingStatusForUser(
  userId: string,
): Promise<OnboardingStatusResult | null> {
  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      logger.warn(`[Onboarding] User not found: ${userId}`);
      return null;
    }

    const status = (user.onboardingStatus as OnboardingStatus) || "pending";

    return {
      status,
      isCompleted: status === "completed",
    };
  } catch (error: any) {
    logger.error("[Onboarding] Failed to get onboarding status", {
      error: error?.message || String(error),
      stack: error?.stack,
      userId,
      databaseUrl: process.env.DATABASE_URL ? "set" : "not set",
    });
    return {
      status: "pending",
      isCompleted: false,
    };
  }
}

const getCachedOnboardingStatusByUser = (userId: string) =>
  unstable_cache(
    () => fetchOnboardingStatusForUser(userId),
    ["onboarding", userId],
    { tags: [CACHE_TAGS.onboarding(userId)] },
  )();

export const getCachedOnboardingStatus = cache(async () => {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId) return null;
  return getCachedOnboardingStatusByUser(userId);
});
