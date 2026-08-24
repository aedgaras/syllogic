"use server";

import { requireAuth } from "@/lib/auth-helpers";
import { searchLogo } from "@/lib/actions/logos";
import { setTransactionLogoIfMissingViaBackend } from "./transaction-logos.gateway";

function hasLogoDevApiKey(): boolean {
  // Use bracket access to avoid build-time env inlining in Next.js server bundles.
  return !!process.env["LOGO_DEV_API_KEY"];
}

type LogoSearchResult = Awaited<ReturnType<typeof searchLogo>>;

export interface MerchantLogoData {
  id: string;
  logoUrl: string | null;
  updatedAt?: Date | null;
}

export interface MerchantLogoCandidate {
  id: string;
  merchant: string | null;
  logoId: string | null;
  logo?: MerchantLogoData | null;
}

function toLogoData(
  logo: MerchantLogoData | null | undefined,
): MerchantLogoData | null {
  if (!logo) {
    return null;
  }

  return {
    id: logo.id,
    logoUrl: logo.logoUrl ?? null,
    updatedAt: logo.updatedAt ?? null,
  };
}

async function resolveSingleMerchantLogo<T extends MerchantLogoCandidate>(
  transaction: T,
  userId: string | null,
  logoSearches?: Map<string, Promise<LogoSearchResult>>,
): Promise<T & { logoId: string | null; logo: MerchantLogoData | null }> {
  if (transaction.logoId) {
    return {
      ...transaction,
      logoId: transaction.logoId,
      logo: toLogoData(transaction.logo),
    };
  }

  if (!userId || !hasLogoDevApiKey() || !transaction.merchant?.trim()) {
    return {
      ...transaction,
      logoId: null,
      logo: null,
    };
  }

  const normalizedMerchant = transaction.merchant.trim().toLowerCase();
  let searchPromise = logoSearches?.get(normalizedMerchant);

  if (!searchPromise) {
    searchPromise = searchLogo(transaction.merchant.trim());
    logoSearches?.set(normalizedMerchant, searchPromise);
  }

  const result = await searchPromise;
  if (!result.success || !result.logo) {
    return {
      ...transaction,
      logoId: null,
      logo: null,
    };
  }

  const persisted = await setTransactionLogoIfMissingViaBackend(
    userId,
    transaction.id,
    result.logo.id,
  );
  return {
    ...transaction,
    logoId: persisted.logoId,
    logo: persisted.logo,
  };
}

/**
 * Lazily resolves and persists a company logo for each transaction missing
 * one, deduping concurrent logo.dev lookups for the same merchant name
 * within this batch. Mirrors resolveMissingAccountLogos.
 */
export async function resolveMissingMerchantLogos<
  T extends MerchantLogoCandidate,
>(
  transactionsToResolve: T[],
): Promise<Array<T & { logoId: string | null; logo: MerchantLogoData | null }>> {
  const userId = await requireAuth();
  const logoSearches = new Map<string, Promise<LogoSearchResult>>();
  return Promise.all(
    transactionsToResolve.map((transaction) =>
      resolveSingleMerchantLogo(transaction, userId, logoSearches),
    ),
  );
}
