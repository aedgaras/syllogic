"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, transactions, accounts, type User } from "@/lib/db/schema";
import { getAuthenticatedSession, requireAuth } from "@/lib/auth-helpers";
import { storage } from "@/lib/storage";
import { getBackendBaseUrl } from "@/lib/backend-url";
import { createInternalAuthHeaders } from "@/lib/internal-auth";

export type OpenAiSettings = {
  configured: boolean;
  source: "database" | "environment" | "none";
  databaseConfigured: boolean;
  environmentConfigured: boolean;
};

type BackendOpenAiSettings = {
  configured: boolean;
  source: "database" | "environment" | "none";
  database_configured: boolean;
  environment_configured: boolean;
};

function mapOpenAiSettings(settings: BackendOpenAiSettings): OpenAiSettings {
  return {
    configured: settings.configured,
    source: settings.source,
    databaseConfigured: settings.database_configured,
    environmentConfigured: settings.environment_configured,
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
  const pathWithQuery = "/api/app-settings/openai";
  const response = await fetch(`${backendUrl}${pathWithQuery}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...createInternalAuthHeaders({
        method,
        pathWithQuery,
        userId,
      }),
    },
    body: body ? JSON.stringify(body) : undefined,
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
      error: extractBackendError(payload, "Failed to update OpenAI settings"),
    };
  }

  return {
    success: true,
    settings: mapOpenAiSettings(payload as BackendOpenAiSettings),
  };
}

/**
 * Check if the OpenAI API key is configured in the environment.
 * This is used to determine whether to show the CSV import option.
 */
export async function hasOpenAiApiKey(): Promise<boolean> {
  const userId = await requireAuth();
  if (!userId) return false;

  const result = await requestOpenAiSettings("GET", userId);
  return result.success ? result.settings.configured : !!process.env.OPENAI_API_KEY;
}

export async function getOpenAiSettings(): Promise<OpenAiSettings & { error?: string }> {
  const userId = await requireAuth();
  if (!userId) {
    return {
      configured: false,
      source: "none",
      databaseConfigured: false,
      environmentConfigured: false,
      error: "Not authenticated",
    };
  }

  const result = await requestOpenAiSettings("GET", userId);
  if (result.success) return result.settings;

  return {
    configured: !!process.env.OPENAI_API_KEY,
    source: process.env.OPENAI_API_KEY ? "environment" : "none",
    databaseConfigured: false,
    environmentConfigured: !!process.env.OPENAI_API_KEY,
    error: result.error,
  };
}

export async function updateOpenAiApiKey(
  apiKey: string
): Promise<{ success: boolean; settings?: OpenAiSettings; error?: string }> {
  const userId = await requireAuth();
  if (!userId) return { success: false, error: "Not authenticated" };

  const normalized = apiKey.trim();
  if (!normalized) return { success: false, error: "OpenAI API key is required" };
  if (!normalized.startsWith("sk-")) {
    return { success: false, error: "OpenAI API keys should start with sk-" };
  }

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
      const fileExtension = profilePhoto.name.split(".").pop()?.toLowerCase() || "jpg";
      const fileName = `profile/${session.user.id}.${fileExtension}`;
      const buffer = Buffer.from(await profilePhoto.arrayBuffer());

      const uploadedFile = await storage.upload(fileName, buffer, {
        contentType: profilePhoto.type,
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
