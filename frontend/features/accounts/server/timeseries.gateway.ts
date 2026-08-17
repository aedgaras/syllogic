import { getBackendBaseUrl } from "@/lib/backend-url";
import { createInternalAuthHeaders } from "@/lib/internal-auth";

export interface TimeseriesRecalculationResult {
  message?: string;
  days_processed?: number;
  records_stored?: number;
}

export async function requestTimeseriesRecalculation(
  accountId: string,
  userId: string,
): Promise<TimeseriesRecalculationResult> {
  const pathWithQuery = `/api/accounts/${accountId}/recalculate-timeseries`;
  const response = await fetch(`${getBackendBaseUrl()}${pathWithQuery}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...createInternalAuthHeaders({ method: "POST", pathWithQuery, userId }),
    },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(typeof data.detail === "string" ? data.detail : "Failed to recalculate timeseries");
  }
  return response.json();
}

export async function createPocketAccountViaBackend(
  userId: string,
  input: {
    name: string;
    accountType: string;
    currency: string;
    startingBalance: number;
    iban: string;
  },
) {
  const path = "/api/accounts/pocket";
  const url = `${getBackendBaseUrl().replace(/\/+$/, "")}${path}`;
  const body = JSON.stringify({
    name: input.name,
    account_type: input.accountType,
    currency: input.currency,
    starting_balance: String(input.startingBalance),
    iban: input.iban,
  });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...createInternalAuthHeaders({ method: "POST", pathWithQuery: path, userId, body }),
    },
    body,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({ detail: "Failed to create pocket account" }));
    const detail = Array.isArray(data.detail) ? data.detail[0]?.msg : data.detail;
    throw new Error(typeof detail === "string" ? detail : "Failed to create pocket account");
  }
  return response.json() as Promise<{ account_id: string; backfilled_count?: number }>;
}

export async function unlinkInternalTransferViaBackend(transferId: string, userId: string) {
  const path = `/api/accounts/internal-transfers/${encodeURIComponent(transferId)}`;
  const response = await fetch(`${getBackendBaseUrl().replace(/\/+$/, "")}${path}`, {
    method: "DELETE",
    headers: createInternalAuthHeaders({ method: "DELETE", pathWithQuery: path, userId }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({ detail: "Failed to unlink internal transfer" }));
    throw new Error(typeof data.detail === "string" ? data.detail : "Failed to unlink internal transfer");
  }
}
