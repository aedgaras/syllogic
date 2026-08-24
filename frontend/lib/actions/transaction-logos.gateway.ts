import { getBackendBaseUrl } from "@/lib/backend-url";
import { createInternalAuthHeaders } from "@/lib/internal-auth";
import type { MerchantLogoData } from "./transaction-logos";

interface TransactionLogoApiResponse {
  id: string;
  logo_url: string | null;
  updated_at: string | null;
}

function mapLogo(logo: TransactionLogoApiResponse | null): MerchantLogoData | null {
  if (!logo) return null;
  return {
    id: logo.id,
    logoUrl: logo.logo_url,
    updatedAt: logo.updated_at ? new Date(logo.updated_at) : null,
  };
}

async function extractErrorDetail(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => ({ detail: fallback }));
  const detail = Array.isArray(data.detail) ? data.detail[0]?.msg : data.detail;
  return typeof detail === "string" ? detail : fallback;
}

/**
 * Persists a resolved company logo onto a transaction, but never overwrites
 * one that's already set -- the backend enforces this atomically (conditional
 * `UPDATE ... WHERE logo_id IS NULL`). Always returns the final persisted
 * state, whether this call applied it or a concurrent request already had.
 */
export async function setTransactionLogoIfMissingViaBackend(
  userId: string,
  transactionId: string,
  logoId: string,
): Promise<{ logoId: string | null; logo: MerchantLogoData | null }> {
  const path = `/api/transactions/${transactionId}/logo`;
  const body = JSON.stringify({ logo_id: logoId });
  const response = await fetch(`${getBackendBaseUrl().replace(/\/+$/, "")}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...createInternalAuthHeaders({ method: "PATCH", pathWithQuery: path, userId, body }),
    },
    body,
  });
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to set transaction logo"));
  }
  const data: { logo_id: string | null; logo: TransactionLogoApiResponse | null } =
    await response.json();
  return { logoId: data.logo_id, logo: mapLogo(data.logo) };
}
