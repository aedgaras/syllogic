import { getBackendBaseUrl } from "@/lib/backend-url";
import { createInternalAuthHeaders } from "@/lib/internal-auth";

/**
 * Schedule actions live in the Python backend rather than in a server action:
 * materializing an occurrence has to run the same FX conversion and account
 * balance recalculation the Celery beat does (see
 * backend/app/services/recurring_transaction_generator.py), and duplicating
 * that in TypeScript is exactly the drift this gateway avoids.
 */

export interface GenerateNowResult {
  createdCount: number;
  transactionIds: string[];
  nextDueDate: string | null;
  message: string;
}

export interface SkipNextResult {
  skippedDate: string | null;
  nextDueDate: string | null;
  autoGenerate: boolean;
  message: string;
}

async function extractErrorDetail(
  response: Response,
  fallback: string,
): Promise<string> {
  const data = await response.json().catch(() => ({ detail: fallback }));
  const detail = Array.isArray(data.detail) ? data.detail[0]?.msg : data.detail;
  return typeof detail === "string" ? detail : fallback;
}

function backendPost(path: string, userId: string) {
  return fetch(`${getBackendBaseUrl().replace(/\/+$/, "")}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...createInternalAuthHeaders({
        method: "POST",
        pathWithQuery: path,
        userId,
        body: "",
      }),
    },
  });
}

export async function generateNextOccurrence(
  subscriptionId: string,
  userId: string,
): Promise<GenerateNowResult> {
  const path = `/api/subscriptions/${subscriptionId}/generate-now`;
  const response = await backendPost(path, userId);

  if (!response.ok) {
    throw new Error(
      await extractErrorDetail(response, "Failed to generate transaction"),
    );
  }

  const data = await response.json();
  return {
    createdCount: data.created_count ?? 0,
    transactionIds: data.transaction_ids ?? [],
    nextDueDate: data.next_due_date ?? null,
    message: data.message ?? "",
  };
}

export async function skipNextOccurrence(
  subscriptionId: string,
  userId: string,
): Promise<SkipNextResult> {
  const path = `/api/subscriptions/${subscriptionId}/skip-next`;
  const response = await backendPost(path, userId);

  if (!response.ok) {
    throw new Error(
      await extractErrorDetail(response, "Failed to skip occurrence"),
    );
  }

  const data = await response.json();
  return {
    skippedDate: data.skipped_date ?? null,
    nextDueDate: data.next_due_date ?? null,
    autoGenerate: Boolean(data.auto_generate),
    message: data.message ?? "",
  };
}
