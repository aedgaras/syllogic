"use client";

export type Aspsp = {
  name: string;
  country: string;
  logo?: string;
  beta?: boolean;
};

export type BankConnectionStatus = {
  sync_progress?: {
    stage: string;
    accounts_done: number;
    accounts_total: number;
    transactions_created: number;
    transactions_updated: number;
    started_at?: string;
  };
  last_synced_at?: string | null;
  last_sync_error?: string | null;
};

export async function fetchAspsps(
  country: string,
  signal?: AbortSignal,
): Promise<Aspsp[]> {
  const response = await fetch(
    `/api/enable-banking/aspsps?country=${country}`,
    { signal },
  );
  if (!response.ok) throw new Error("Failed to load banks");
  const data = await response.json();
  return (Array.isArray(data) ? data : data.aspsps || []) as Aspsp[];
}

export async function fetchBankConnectionStatus(
  connectionId: string,
): Promise<BankConnectionStatus> {
  const response = await fetch(`/api/enable-banking/status/${connectionId}`);
  if (!response.ok) throw new Error(`Status ${response.status}`);
  return response.json();
}
