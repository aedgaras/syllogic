import type { CashflowForecast } from "./types";

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Request to ${path} failed (${res.status}): ${body}`);
  }
  return res.json();
}

export function getCashflowForecast(params: {
  horizonDays: number;
  accountIds?: string[];
}): Promise<CashflowForecast> {
  const search = new URLSearchParams({
    horizon_days: String(params.horizonDays),
  });
  for (const id of params.accountIds ?? []) {
    search.append("account_ids", id);
  }
  return request<CashflowForecast>(`/forecast/cashflow?${search.toString()}`);
}
