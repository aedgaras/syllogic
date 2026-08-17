import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import {
  decryptValue,
  encryptValue,
  isDataEncryptionEnabled,
} from "@/lib/security/data-encryption";
import { validateOidcConfig, type OidcRuntimeConfig } from "@/lib/oidc-config";

export type { OidcRuntimeConfig } from "@/lib/oidc-config";

export const OIDC_SETTINGS_KEY = "oidc_authentication";
export const OIDC_PROVIDER_ID = "oidc";

export type OidcAdminSettings = Omit<OidcRuntimeConfig, "clientSecret"> & {
  clientSecretConfigured: boolean;
  encryptionConfigured: boolean;
  updatedAt: string | null;
};

const disabledSettings: OidcAdminSettings = {
  enabled: false,
  displayName: "Single Sign-On",
  discoveryUrl: "",
  clientId: "",
  clientSecretConfigured: false,
  allowSignUp: true,
  encryptionConfigured: false,
  updatedAt: null,
};

function parseStoredConfig(raw: string): OidcRuntimeConfig {
  const value = JSON.parse(raw) as Partial<OidcRuntimeConfig>;
  return {
    enabled: value.enabled === true,
    displayName: value.displayName?.trim() || "Single Sign-On",
    discoveryUrl: value.discoveryUrl?.trim() || "",
    clientId: value.clientId?.trim() || "",
    clientSecret: value.clientSecret?.trim() || "",
    allowSignUp: value.allowSignUp !== false,
  };
}

export async function getOidcRuntimeConfig(): Promise<OidcRuntimeConfig | null> {
  const row = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, OIDC_SETTINGS_KEY),
  });
  if (!row?.valueEncrypted) return null;

  const decrypted = decryptValue(row.valueEncrypted);
  if (!decrypted) return null;
  const config = validateOidcConfig(parseStoredConfig(decrypted));
  return config.enabled ? config : null;
}

export async function getOidcAdminSettings(): Promise<OidcAdminSettings> {
  const row = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, OIDC_SETTINGS_KEY),
  });
  if (!row?.valueEncrypted) {
    return {
      ...disabledSettings,
      encryptionConfigured: isDataEncryptionEnabled(),
    };
  }

  const decrypted = decryptValue(row.valueEncrypted);
  if (!decrypted) {
    return {
      ...disabledSettings,
      encryptionConfigured: isDataEncryptionEnabled(),
    };
  }
  const config = parseStoredConfig(decrypted);
  return {
    enabled: config.enabled,
    displayName: config.displayName,
    discoveryUrl: config.discoveryUrl,
    clientId: config.clientId,
    clientSecretConfigured: Boolean(config.clientSecret),
    allowSignUp: config.allowSignUp,
    encryptionConfigured: isDataEncryptionEnabled(),
    updatedAt: row.updatedAt?.toISOString() ?? null,
  };
}

export async function saveOidcSettings(
  input: Omit<OidcRuntimeConfig, "clientSecret"> & { clientSecret?: string },
  updatedByUserId: string,
): Promise<OidcAdminSettings> {
  const existing = await getOidcRuntimeConfigIncludingDisabled();
  const config = validateOidcConfig({
    ...input,
    clientSecret: input.clientSecret?.trim() || existing?.clientSecret || "",
  });
  const encrypted = encryptValue(JSON.stringify(config));
  if (!encrypted) {
    throw new Error(
      "DATA_ENCRYPTION_KEY_CURRENT is required to store OIDC credentials.",
    );
  }

  await db
    .insert(appSettings)
    .values({
      key: OIDC_SETTINGS_KEY,
      valueEncrypted: encrypted,
      updatedByUserId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: {
        valueEncrypted: encrypted,
        updatedByUserId,
        updatedAt: new Date(),
      },
    });

  return getOidcAdminSettings();
}

async function getOidcRuntimeConfigIncludingDisabled(): Promise<OidcRuntimeConfig | null> {
  const row = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, OIDC_SETTINGS_KEY),
  });
  if (!row?.valueEncrypted) return null;
  const decrypted = decryptValue(row.valueEncrypted);
  return decrypted ? parseStoredConfig(decrypted) : null;
}
