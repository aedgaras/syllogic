"use server";

import { requireAuth } from "@/lib/auth-helpers";
import { searchLogo } from "@/lib/actions/logos";
import { setAccountLogoIfMissingViaBackend } from "./account-logos.gateway";

function hasLogoDevApiKey(): boolean {
  // Use bracket access to avoid build-time env inlining in Next.js server bundles.
  return !!process.env["LOGO_DEV_API_KEY"];
}

type LogoSearchResult = Awaited<ReturnType<typeof searchLogo>>;

export interface AccountLogoData {
  id: string;
  logoUrl: string | null;
  updatedAt?: Date | null;
}

export interface AccountLogoCandidate {
  id: string;
  institution: string | null;
  logoId: string | null;
  logo?: AccountLogoData | null;
}

function toLogoData(
  logo: AccountLogoData | null | undefined,
): AccountLogoData | null {
  if (!logo) {
    return null;
  }

  return {
    id: logo.id,
    logoUrl: logo.logoUrl ?? null,
    updatedAt: logo.updatedAt ?? null,
  };
}

async function resolveSingleAccountLogo<T extends AccountLogoCandidate>(
  account: T,
  userId: string | null,
  logoSearches?: Map<string, Promise<LogoSearchResult>>,
): Promise<T & { logoId: string | null; logo: AccountLogoData | null }> {
  if (account.logoId) {
    return {
      ...account,
      logoId: account.logoId,
      logo: toLogoData(account.logo),
    };
  }

  if (!userId || !hasLogoDevApiKey() || !account.institution?.trim()) {
    return {
      ...account,
      logoId: null,
      logo: null,
    };
  }

  const normalizedInstitution = account.institution.trim().toLowerCase();
  let searchPromise = logoSearches?.get(normalizedInstitution);

  if (!searchPromise) {
    searchPromise = searchLogo(account.institution.trim());
    logoSearches?.set(normalizedInstitution, searchPromise);
  }

  const result = await searchPromise;
  if (!result.success || !result.logo) {
    return {
      ...account,
      logoId: null,
      logo: null,
    };
  }

  const persisted = await setAccountLogoIfMissingViaBackend(
    userId,
    account.id,
    result.logo.id,
  );
  return {
    ...account,
    logoId: persisted.logoId,
    logo: persisted.logo,
  };
}

export async function resolveMissingAccountLogos<
  T extends AccountLogoCandidate,
>(
  accountsToResolve: T[],
): Promise<Array<T & { logoId: string | null; logo: AccountLogoData | null }>> {
  const userId = await requireAuth();
  const logoSearches = new Map<string, Promise<LogoSearchResult>>();
  return Promise.all(
    accountsToResolve.map((account) =>
      resolveSingleAccountLogo(account, userId, logoSearches),
    ),
  );
}

export async function resolveMissingAccountLogo<T extends AccountLogoCandidate>(
  account: T,
): Promise<T & { logoId: string | null; logo: AccountLogoData | null }> {
  const userId = await requireAuth();
  return resolveSingleAccountLogo(account, userId);
}
