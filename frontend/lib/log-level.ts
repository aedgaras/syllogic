import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import { decryptValue, encryptValue } from "@/lib/security/data-encryption";

// Shares the "log_level" app_settings row with the backend
// (backend/app/services/app_settings.py) — the same Postgres database, same
// envelope format, same key. A change made from either app's Settings UI is
// visible to both.
export const LOG_LEVEL_SETTING_KEY = "log_level";
export const VALID_LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof VALID_LOG_LEVELS)[number];

const DEFAULT_LOG_LEVEL: LogLevel = "info";

export type LogLevelStatus = {
  level: LogLevel;
  source: "database" | "environment" | "default";
};

function isValidLevel(value: string | null | undefined): value is LogLevel {
  return !!value && (VALID_LOG_LEVELS as readonly string[]).includes(value);
}

function envLogLevel(): LogLevel | null {
  const value = process.env.LOG_LEVEL?.trim().toLowerCase();
  return isValidLevel(value) ? value : null;
}

async function getStoredLevel(): Promise<LogLevel | null> {
  const row = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, LOG_LEVEL_SETTING_KEY),
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
    const parsed = JSON.parse(decrypted) as { level?: string };
    return isValidLevel(parsed.level) ? parsed.level : null;
  } catch {
    return null;
  }
}

export async function getLogLevelStatus(): Promise<LogLevelStatus> {
  const stored = await getStoredLevel();
  if (stored) return { level: stored, source: "database" };

  const fromEnv = envLogLevel();
  if (fromEnv) return { level: fromEnv, source: "environment" };

  return { level: DEFAULT_LOG_LEVEL, source: "default" };
}

export async function setLogLevel(
  level: LogLevel,
  updatedByUserId: string,
): Promise<LogLevelStatus> {
  const serialized = JSON.stringify({ level });
  // Not a secret. Encrypt it when a key is configured, but allow plaintext
  // storage so an administrator can always control the log level (same
  // tradeoff as registration-settings.ts).
  const storedValue = encryptValue(serialized) ?? serialized;

  await db
    .insert(appSettings)
    .values({
      key: LOG_LEVEL_SETTING_KEY,
      valueEncrypted: storedValue,
      updatedByUserId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { valueEncrypted: storedValue, updatedByUserId, updatedAt: new Date() },
    });

  return { level, source: "database" };
}

export async function clearLogLevel(): Promise<LogLevelStatus> {
  await db.delete(appSettings).where(eq(appSettings.key, LOG_LEVEL_SETTING_KEY));
  return getLogLevelStatus();
}

// Hot-path cache: refreshed at most once per interval so the effective level
// can be re-read cheaply from request handlers and from the background sync
// in instrumentation.ts.
let cache: { status: LogLevelStatus; expiresAt: number } | null = null;
const CACHE_TTL_MS = 10_000;

export async function getEffectiveLogLevelCached(): Promise<LogLevelStatus> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.status;
  const status = await getLogLevelStatus();
  cache = { status, expiresAt: now + CACHE_TTL_MS };
  return status;
}
