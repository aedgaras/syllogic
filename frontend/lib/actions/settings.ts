"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, transactions, accounts, type User } from "@/lib/db/schema";
import { getAuthenticatedSession, requireAuth } from "@/lib/auth-helpers";
import { storage } from "@/lib/storage";
import { normalizeProfileImage } from "@/lib/profile-image";
import { getBackendBaseUrl } from "@/lib/backend-url";
import { getLlmConfig } from "@/lib/llm-config";
import { createInternalAuthHeaders } from "@/lib/internal-auth";
import {
  getOidcAdminSettings,
  saveOidcSettings,
  type OidcAdminSettings,
} from "@/lib/oidc-settings";
import {
  getRegistrationStatus,
  saveRegistrationSettings,
  type RegistrationStatus,
} from "@/lib/registration-settings";

async function requireAdminUserId(): Promise<string | null> {
  const userId = await requireAuth();
  if (!userId) return null;
  const user = await db.query.users.findFirst({
    columns: { role: true },
    where: eq(users.id, userId),
  });
  return user?.role === "admin" ? userId : null;
}

export async function getOidcSettings(): Promise<OidcAdminSettings & { error?: string }> {
  const adminUserId = await requireAdminUserId();
  if (!adminUserId) {
    return {
      enabled: false,
      displayName: "Single Sign-On",
      discoveryUrl: "",
      clientId: "",
      clientSecretConfigured: false,
      allowSignUp: true,
      encryptionConfigured: false,
      updatedAt: null,
      error: "Administrator access is required.",
    };
  }

  try {
    return await getOidcAdminSettings();
  } catch (error) {
    return {
      enabled: false,
      displayName: "Single Sign-On",
      discoveryUrl: "",
      clientId: "",
      clientSecretConfigured: false,
      allowSignUp: true,
      encryptionConfigured: false,
      updatedAt: null,
      error: error instanceof Error ? error.message : "Failed to load OIDC settings.",
    };
  }
}

export async function updateOidcSettings(input: {
  enabled: boolean;
  displayName: string;
  discoveryUrl: string;
  clientId: string;
  clientSecret?: string;
  allowSignUp: boolean;
}): Promise<{ success: boolean; settings?: OidcAdminSettings; error?: string }> {
  const adminUserId = await requireAdminUserId();
  if (!adminUserId) return { success: false, error: "Administrator access is required." };

  try {
    const settings = await saveOidcSettings(input, adminUserId);
    revalidatePath("/settings");
    revalidatePath("/login");
    return { success: true, settings };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to save OIDC settings.",
    };
  }
}

export async function getSignupSettings(): Promise<RegistrationStatus & { error?: string }> {
  const adminUserId = await requireAdminUserId();
  if (!adminUserId) {
    return {
      enabled: false,
      hasUsers: true,
      firstUserWillBeAdmin: false,
      environmentDisabled: false,
      databaseEnabled: false,
      databaseConfigured: false,
      error: "Administrator access is required.",
    };
  }

  try {
    return await getRegistrationStatus();
  } catch (error) {
    return {
      enabled: false,
      hasUsers: true,
      firstUserWillBeAdmin: false,
      environmentDisabled: false,
      databaseEnabled: false,
      databaseConfigured: false,
      error: error instanceof Error ? error.message : "Failed to load signup settings.",
    };
  }
}

export async function updateSignupSettings(
  enabled: boolean
): Promise<{ success: boolean; settings?: RegistrationStatus; error?: string }> {
  const adminUserId = await requireAdminUserId();
  if (!adminUserId) return { success: false, error: "Administrator access is required." };

  try {
    const settings = await saveRegistrationSettings(enabled, adminUserId);
    revalidatePath("/settings");
    revalidatePath("/login");
    revalidatePath("/register");
    return { success: true, settings };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to save signup settings.",
    };
  }
}

export type OpenAiSettings = {
  configured: boolean;
  source: "database" | "environment" | "none";
  databaseConfigured: boolean;
  environmentConfigured: boolean;
  baseUrl: string | null;
  model: string;
  provider: "openai" | "custom";
};

type BackendOpenAiSettings = {
  configured: boolean;
  source: "database" | "environment" | "none";
  database_configured: boolean;
  environment_configured: boolean;
  base_url: string | null;
  model: string;
  provider: "openai" | "custom";
};

function mapOpenAiSettings(settings: BackendOpenAiSettings): OpenAiSettings {
  return {
    configured: settings.configured,
    source: settings.source,
    databaseConfigured: settings.database_configured,
    environmentConfigured: settings.environment_configured,
    baseUrl: settings.base_url,
    model: settings.model,
    provider: settings.provider,
  };
}

function extractBackendError(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === "object" &&
    "detail" in payload
  ) {
    const detail = (payload as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail[0] && typeof detail[0] === "object") {
      const firstMessage = (detail[0] as { msg?: unknown }).msg;
      if (typeof firstMessage === "string") return firstMessage;
    }
  }
  return fallback;
}

async function requestOpenAiSettings(
  method: "GET" | "PUT" | "DELETE",
  userId: string,
  body?: { api_key: string }
): Promise<{ success: true; settings: OpenAiSettings } | { success: false; error: string }> {
  const backendUrl = getBackendBaseUrl();
  const pathWithQuery = "/api/app-settings/llm";
  const requestBody = body ? JSON.stringify(body) : undefined;
  const response = await fetch(`${backendUrl}${pathWithQuery}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...createInternalAuthHeaders({
        method,
        pathWithQuery,
        userId,
        body: requestBody ?? "",
      }),
    },
    body: requestBody,
    cache: "no-store",
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Keep the fallback error below.
  }

  if (!response.ok) {
    return {
      success: false,
      error: extractBackendError(payload, "Failed to update LLM settings"),
    };
  }

  return {
    success: true,
    settings: mapOpenAiSettings(payload as BackendOpenAiSettings),
  };
}

/**
 * Check if an LLM API is configured.
 * This is used to determine whether to show the CSV import option.
 */
export async function hasOpenAiApiKey(): Promise<boolean> {
  const userId = await requireAuth();
  if (!userId) return false;

  const result = await requestOpenAiSettings("GET", userId);
  return result.success ? result.settings.configured : getLlmConfig().configured;
}

export async function getOpenAiSettings(): Promise<OpenAiSettings & { error?: string }> {
  const userId = await requireAuth();
  if (!userId) {
    return {
      configured: false,
      source: "none",
      databaseConfigured: false,
      environmentConfigured: false,
      baseUrl: null,
      model: process.env.LLM_MODEL || process.env.CATEGORIZATION_LLM_MODEL || "gpt-4o-mini",
      provider: process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL ? "custom" : "openai",
      error: "Not authenticated",
    };
  }

  const result = await requestOpenAiSettings("GET", userId);
  if (result.success) return result.settings;

  return {
    configured: !!(process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL),
    source: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL ? "environment" : "none",
    databaseConfigured: false,
    environmentConfigured: !!(process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL),
    baseUrl: process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || null,
    model: process.env.LLM_MODEL || process.env.CATEGORIZATION_LLM_MODEL || "gpt-4o-mini",
    provider: process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL ? "custom" : "openai",
    error: result.error,
  };
}

export async function updateOpenAiApiKey(
  apiKey: string
): Promise<{ success: boolean; settings?: OpenAiSettings; error?: string }> {
  const userId = await requireAuth();
  if (!userId) return { success: false, error: "Not authenticated" };

  const normalized = apiKey.trim();
  if (!normalized) return { success: false, error: "LLM API key is required" };

  const result = await requestOpenAiSettings("PUT", userId, { api_key: normalized });
  if (!result.success) return result;

  revalidatePath("/settings");
  return { success: true, settings: result.settings };
}

export async function clearOpenAiApiKey(): Promise<{
  success: boolean;
  settings?: OpenAiSettings;
  error?: string;
}> {
  const userId = await requireAuth();
  if (!userId) return { success: false, error: "Not authenticated" };

  const result = await requestOpenAiSettings("DELETE", userId);
  if (!result.success) return result;

  revalidatePath("/settings");
  return { success: true, settings: result.settings };
}

/**
 * Get the current user's profile data.
 */
export async function getCurrentUserProfile(): Promise<User | null> {
  const userId = await requireAuth();

  if (!userId) {
    return null;
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  return user || null;
}

/**
 * Update the current user's profile data.
 */
export async function updateUserProfile(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const session = await getAuthenticatedSession();

  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const name = formData.get("name") as string;
    const profilePhotoEntry = formData.get("profilePhoto");
    const profilePhoto = profilePhotoEntry instanceof File ? profilePhotoEntry : null;

    if (!name?.trim()) {
      return { success: false, error: "Name is required" };
    }

    let profilePhotoPath: string | undefined;

    // Handle profile photo upload
    if (profilePhoto && profilePhoto.size > 0) {
      const fileName = `profile/${session.user.id}.webp`;
      const buffer = await normalizeProfileImage(profilePhoto);

      const uploadedFile = await storage.upload(fileName, buffer, {
        contentType: "image/webp",
      });

      // Add cache-busting timestamp to prevent browser caching
      profilePhotoPath = `${uploadedFile.url}?v=${Date.now()}`;
    }

    await db
      .update(users)
      .set({
        name: name.trim(),
        ...(profilePhotoPath && { profilePhotoPath, image: profilePhotoPath }),
        updatedAt: new Date(),
      })
      .where(eq(users.id, session.user.id));

    // Ensure layout consumers (sidebar avatar) pick up the updated image immediately.
    revalidatePath("/", "layout");
    revalidatePath("/settings");
    return { success: true };
  } catch (error) {
    console.error("Failed to update user profile:", error);
    return { success: false, error: "Failed to update profile" };
  }
}

/**
 * Delete all transactions and reset account balances to starting balance.
 * This is a destructive operation that cannot be undone.
 */
export async function deleteAllTransactionsAndResetBalances(): Promise<{
  success: boolean;
  error?: string;
  deletedCount?: number;
  accountsReset?: number;
}> {
  const userId = await requireAuth();

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    // Delete all transactions for the user
    const deleted = await db
      .delete(transactions)
      .where(eq(transactions.userId, userId))
      .returning({ id: transactions.id });

    // Reset all account balances to their starting balance
    const userAccounts = await db.query.accounts.findMany({
      where: eq(accounts.userId, userId),
    });

    for (const account of userAccounts) {
      await db
        .update(accounts)
        .set({
          functionalBalance: account.startingBalance || "0",
          balanceAvailable: null,
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, account.id));
    }

    revalidatePath("/");
    revalidatePath("/transactions");
    revalidatePath("/settings");

    return {
      success: true,
      deletedCount: deleted.length,
      accountsReset: userAccounts.length,
    };
  } catch (error) {
    console.error("Failed to delete transactions and reset balances:", error);
    return { success: false, error: "Failed to delete transactions and reset balances" };
  }
}
