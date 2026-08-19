import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import { decryptValue, encryptValue } from "@/lib/security/data-encryption";

// Shares the "ai_summary_enabled" app_settings row with the backend
// (backend/app/services/app_settings.py) — same Postgres database, same
// envelope format, same key.
export const AI_SUMMARY_ENABLED_SETTING_KEY = "ai_summary_enabled";

const DEFAULT_AI_SUMMARY_ENABLED = false;

export type AiSummaryEnabledStatus = {
  enabled: boolean;
  source: "database" | "default";
};

async function getStoredEnabled(): Promise<boolean | null> {
  const row = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, AI_SUMMARY_ENABLED_SETTING_KEY),
  });
  if (!row?.valueEncrypted) return null;

  let decrypted: string | null;
  try {
    decrypted = decryptValue(row.valueEncrypted);
  } catch {
    return null;
  }
  if (!decrypted) return null;

  try {
    const parsed = JSON.parse(decrypted) as { enabled?: unknown };
    return typeof parsed.enabled === "boolean" ? parsed.enabled : null;
  } catch {
    return null;
  }
}

export async function getAiSummaryEnabledStatus(): Promise<AiSummaryEnabledStatus> {
  const stored = await getStoredEnabled();
  if (stored !== null) return { enabled: stored, source: "database" };
  return { enabled: DEFAULT_AI_SUMMARY_ENABLED, source: "default" };
}

export async function setAiSummaryEnabled(
  enabled: boolean,
  updatedByUserId: string,
): Promise<AiSummaryEnabledStatus> {
  const serialized = JSON.stringify({ enabled });
  const storedValue = encryptValue(serialized) ?? serialized;

  await db
    .insert(appSettings)
    .values({
      key: AI_SUMMARY_ENABLED_SETTING_KEY,
      valueEncrypted: storedValue,
      updatedByUserId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { valueEncrypted: storedValue, updatedByUserId, updatedAt: new Date() },
    });

  return { enabled, source: "database" };
}
