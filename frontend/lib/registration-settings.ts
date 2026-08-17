import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import { decryptValue, encryptValue } from "@/lib/security/data-encryption";
import { resolveRegistrationEnabled } from "@/lib/registration-policy";

export const REGISTRATION_SETTINGS_KEY = "registration_policy";

type StoredRegistrationSettings = {
  enabled: boolean;
};

export type RegistrationStatus = {
  enabled: boolean;
  hasUsers: boolean;
  firstUserWillBeAdmin: boolean;
  environmentDisabled: boolean;
  databaseEnabled: boolean;
  databaseConfigured: boolean;
};

function envDisabled(): boolean {
  const value = process.env.DISABLE_SIGN_UPS?.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(value || "");
}

async function getStoredSettings(): Promise<StoredRegistrationSettings | null> {
  const row = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, REGISTRATION_SETTINGS_KEY),
  });
  if (!row?.valueEncrypted) return null;
  const decrypted = decryptValue(row.valueEncrypted);
  if (!decrypted) return null;
  const value = JSON.parse(decrypted) as Partial<StoredRegistrationSettings>;
  return { enabled: value.enabled !== false };
}

export async function getRegistrationStatus(): Promise<RegistrationStatus> {
  const [firstUser, stored] = await Promise.all([
    db.query.users.findFirst({ columns: { id: true } }),
    getStoredSettings(),
  ]);
  const hasUsers = Boolean(firstUser);
  const environmentDisabled = envDisabled();
  const databaseEnabled = stored?.enabled !== false;

  return {
    // A fresh deployment must always permit its bootstrap administrator.
    enabled: resolveRegistrationEnabled({
      hasUsers,
      environmentDisabled,
      databaseEnabled,
    }),
    hasUsers,
    firstUserWillBeAdmin: !hasUsers,
    environmentDisabled,
    databaseEnabled,
    databaseConfigured: Boolean(stored),
  };
}

export async function saveRegistrationSettings(
  enabled: boolean,
  updatedByUserId: string,
): Promise<RegistrationStatus> {
  const serialized = JSON.stringify({ enabled });
  // This policy contains no secret. Encrypt it when a key is configured, but
  // allow plaintext storage so administrators can always control registration.
  const storedValue = encryptValue(serialized) ?? serialized;

  await db
    .insert(appSettings)
    .values({
      key: REGISTRATION_SETTINGS_KEY,
      valueEncrypted: storedValue,
      updatedByUserId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: {
        valueEncrypted: storedValue,
        updatedByUserId,
        updatedAt: new Date(),
      },
    });

  return getRegistrationStatus();
}
