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
  lastSyncedAt: Date | null;
  logo?: {
    id: string;
    logoUrl: string | null;
    updatedAt?: Date | null;
  } | null;
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
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    logo: row.logo
      ? {
          id: row.logo.id,
          logoUrl: row.logo.logoUrl,
          updatedAt: row.logo.updatedAt?.toISOString() ?? null,
        }
      : null,
  };
}
