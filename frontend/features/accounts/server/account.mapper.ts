import type { AccountViewModel } from "../domain/contracts";

interface AccountRow {
  id: string;
  name: string;
  accountType: string;
  institution: string | null;
  currency: string | null;
  provider: string | null;
  startingBalance: string | null;
  functionalBalance: string | null;
  creditLimit: string | null;
  lastSyncedAt: Date | string | null;
  logo?: {
    id: string;
    logoUrl: string | null;
    updatedAt?: Date | string | null;
  } | null;
}

// unstable_cache round-trips cached rows through JSON, so Date fields come
// back as ISO strings on a cache hit even though a fresh DB read gives Date.
function toISOStringSafe(value: Date | string | null | undefined) {
  return value ? new Date(value).toISOString() : null;
}

export function toAccountViewModel(row: AccountRow): AccountViewModel {
  return {
    id: row.id,
    name: row.name,
    accountType: row.accountType,
    institution: row.institution,
    currency: row.currency ?? "EUR",
    provider: row.provider,
    startingBalance: row.startingBalance ?? "0",
    functionalBalance: row.functionalBalance ?? "0",
    creditLimit: row.creditLimit,
    lastSyncedAt: toISOStringSafe(row.lastSyncedAt),
    logo: row.logo
      ? {
          id: row.logo.id,
          logoUrl: row.logo.logoUrl,
          updatedAt: toISOStringSafe(row.logo.updatedAt),
        }
      : null,
  };
}
