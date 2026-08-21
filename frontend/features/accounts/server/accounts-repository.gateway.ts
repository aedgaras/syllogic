import { getBackendBaseUrl } from "@/lib/backend-url";
import { createInternalAuthHeaders } from "@/lib/internal-auth";
import type { UpdateAccountInput } from "../domain/contracts";

export interface BackendAccountLogo {
  id: string;
  logoUrl: string | null;
  updatedAt: Date | null;
}

export interface BackendAccount {
  id: string;
  name: string;
  accountType: string;
  institution: string | null;
  currency: string;
  provider: string | null;
  startingBalance: string;
  functionalBalance: string | null;
  creditLimit: string | null;
  logoId: string | null;
  logo: BackendAccountLogo | null;
  lastSyncedAt: Date | null;
}

interface AccountLogoApiResponse {
  id: string;
  logo_url: string | null;
  updated_at: string | null;
}

interface AccountApiResponse {
  id: string;
  name: string;
  account_type: string;
  institution: string | null;
  currency: string;
  provider: string | null;
  is_active: boolean;
  starting_balance: string;
  functional_balance: string | null;
  credit_limit: string | null;
  logo_id: string | null;
  logo: AccountLogoApiResponse | null;
  last_synced_at: string | null;
}

function mapLogo(logo: AccountLogoApiResponse | null): BackendAccountLogo | null {
  if (!logo) return null;
  return {
    id: logo.id,
    logoUrl: logo.logo_url,
    updatedAt: logo.updated_at ? new Date(logo.updated_at) : null,
  };
}

function mapAccount(data: AccountApiResponse): BackendAccount {
  return {
    id: data.id,
    name: data.name,
    accountType: data.account_type,
    institution: data.institution,
    currency: data.currency,
    provider: data.provider,
    startingBalance: data.starting_balance,
    functionalBalance: data.functional_balance,
    creditLimit: data.credit_limit,
    logoId: data.logo_id,
    logo: mapLogo(data.logo),
    lastSyncedAt: data.last_synced_at ? new Date(data.last_synced_at) : null,
  };
}

async function extractErrorDetail(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => ({ detail: fallback }));
  const detail = Array.isArray(data.detail) ? data.detail[0]?.msg : data.detail;
  return typeof detail === "string" ? detail : fallback;
}

function backendFetch(
  method: string,
  path: string,
  userId: string,
  body?: unknown,
) {
  const serializedBody = body !== undefined ? JSON.stringify(body) : undefined;
  return fetch(`${getBackendBaseUrl().replace(/\/+$/, "")}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...createInternalAuthHeaders({
        method,
        pathWithQuery: path,
        userId,
        body: serializedBody ?? "",
      }),
    },
    body: serializedBody,
  });
}

export async function listAccountsViaBackend(
  userId: string,
  options: { includeInactive?: boolean } = {},
): Promise<BackendAccount[]> {
  const query = `?include_inactive=${options.includeInactive ?? false ? "true" : "false"}`;
  const response = await backendFetch("GET", `/api/accounts${query}`, userId);
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to fetch accounts"));
  }
  const data: AccountApiResponse[] = await response.json();
  return data.map(mapAccount);
}

export async function findOwnedAccountViaBackend(
  userId: string,
  accountId: string,
): Promise<BackendAccount | undefined> {
  const response = await backendFetch("GET", `/api/accounts/${accountId}`, userId);
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to fetch account"));
  }
  return mapAccount(await response.json());
}

export async function findActiveOwnedAccountWithLogoViaBackend(
  userId: string,
  accountId: string,
): Promise<BackendAccount | undefined> {
  const response = await backendFetch("GET", `/api/accounts/${accountId}`, userId);
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to fetch account"));
  }
  const raw: AccountApiResponse = await response.json();
  if (!raw.is_active) return undefined;
  return mapAccount(raw);
}

export async function insertManualAccountViaBackend(
  userId: string,
  input: {
    name: string;
    accountType: string;
    institution?: string;
    currency: string;
    startingBalance?: number;
    creditLimit?: number;
  },
): Promise<{ id: string }> {
  const response = await backendFetch("POST", "/api/accounts/", userId, {
    name: input.name,
    account_type: input.accountType,
    institution: input.institution || null,
    currency: input.currency,
    provider: "manual",
    starting_balance: String(input.startingBalance ?? 0),
    credit_limit: input.creditLimit !== undefined ? String(input.creditLimit) : null,
  });
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to create account"));
  }
  const data: AccountApiResponse = await response.json();
  return { id: data.id };
}

export async function updateOwnedAccountViaBackend(
  userId: string,
  accountId: string,
  input: UpdateAccountInput,
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (input.name !== undefined) body.name = input.name;
  if (input.accountType !== undefined) body.account_type = input.accountType;
  if ("institution" in input) body.institution = input.institution ?? null;
  if (input.currency !== undefined) body.currency = input.currency;
  if (input.startingBalance !== undefined) body.starting_balance = String(input.startingBalance);
  if ("creditLimit" in input) {
    body.credit_limit = input.creditLimit == null ? null : String(input.creditLimit);
  }
  if ("logoId" in input) body.logo_id = input.logoId ?? null;
  const response = await backendFetch("PATCH", `/api/accounts/${accountId}`, userId, body);
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to update account"));
  }
}

export async function deactivateAccountViaBackend(
  userId: string,
  accountId: string,
): Promise<void> {
  const response = await backendFetch("PATCH", `/api/accounts/${accountId}`, userId, {
    is_active: false,
  });
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to deactivate account"));
  }
}

export async function permanentlyDeleteAccountViaBackend(
  userId: string,
  accountId: string,
): Promise<{ deletedBalances: number; deletedTransactions: number }> {
  const response = await backendFetch("POST", `/api/accounts/${accountId}/hard-delete`, userId);
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to delete account"));
  }
  const data: { deleted_balances: number; deleted_transactions: number } = await response.json();
  return { deletedBalances: data.deleted_balances, deletedTransactions: data.deleted_transactions };
}

export async function getTransactionSumViaBackend(
  userId: string,
  accountId: string,
  through?: Date,
): Promise<number> {
  const query = through ? `?through=${encodeURIComponent(through.toISOString())}` : "";
  const response = await backendFetch(
    "GET",
    `/api/accounts/${accountId}/transaction-sum${query}`,
    userId,
  );
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to fetch transaction sum"));
  }
  const data: { total: number } = await response.json();
  return data.total;
}

export async function getTransactionSumBeforeViaBackend(
  userId: string,
  accountId: string,
  date: Date,
): Promise<number> {
  const query = `?date=${encodeURIComponent(date.toISOString())}`;
  const response = await backendFetch(
    "GET",
    `/api/accounts/${accountId}/transaction-sum-before${query}`,
    userId,
  );
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to fetch transaction sum"));
  }
  const data: { total: number } = await response.json();
  return data.total;
}

export async function updateAccountBalancesViaBackend(
  userId: string,
  accountId: string,
  values: { startingBalance?: number; functionalBalance: number },
): Promise<void> {
  const body: Record<string, unknown> = {
    functional_balance: values.functionalBalance,
  };
  if (values.startingBalance !== undefined) {
    body.starting_balance = values.startingBalance;
  }
  const response = await backendFetch("PATCH", `/api/accounts/${accountId}`, userId, body);
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to update account balances"));
  }
}

export async function getEarliestTransactionDateViaBackend(
  userId: string,
  accountId: string,
): Promise<Date | null> {
  const response = await backendFetch(
    "GET",
    `/api/accounts/${accountId}/earliest-transaction-date`,
    userId,
  );
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to fetch earliest transaction date"));
  }
  const data: { date: string | null } = await response.json();
  return data.date ? new Date(data.date) : null;
}

export interface BackendBalancePoint {
  date: Date;
  balanceInAccountCurrency: string;
  balanceInFunctionalCurrency: string;
}

interface BalancePointApiResponse {
  date: string;
  balance_in_account_currency: number;
  balance_in_functional_currency: number;
}

function mapBalancePoint(row: BalancePointApiResponse): BackendBalancePoint {
  return {
    date: new Date(row.date),
    balanceInAccountCurrency: String(row.balance_in_account_currency),
    balanceInFunctionalCurrency: String(row.balance_in_functional_currency),
  };
}

export async function getStoredBalanceHistoryViaBackend(
  userId: string,
  accountId: string,
  startDate: Date | null,
): Promise<BackendBalancePoint[]> {
  const query = startDate ? `?since=${encodeURIComponent(startDate.toISOString())}` : "";
  const response = await backendFetch(
    "GET",
    `/api/accounts/${accountId}/balance-history${query}`,
    userId,
  );
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to fetch balance history"));
  }
  const data: BalancePointApiResponse[] = await response.json();
  return data.map(mapBalancePoint);
}

export async function getLatestStoredBalanceViaBackend(
  userId: string,
  accountId: string,
  date: Date,
): Promise<BackendBalancePoint | undefined> {
  const query = `?date=${encodeURIComponent(date.toISOString())}`;
  const response = await backendFetch(
    "GET",
    `/api/accounts/${accountId}/latest-stored-balance${query}`,
    userId,
  );
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to fetch latest stored balance"));
  }
  const data: BalancePointApiResponse | null = await response.json();
  return data ? mapBalancePoint(data) : undefined;
}

export interface BackendDailyTransactionChange {
  date: string;
  amount: string;
}

export async function getDailyTransactionChangesViaBackend(
  userId: string,
  accountId: string,
  startDate: Date,
): Promise<BackendDailyTransactionChange[]> {
  const query = `?since=${encodeURIComponent(startDate.toISOString())}`;
  const response = await backendFetch(
    "GET",
    `/api/accounts/${accountId}/daily-transaction-changes${query}`,
    userId,
  );
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to fetch daily transaction changes"));
  }
  const data: { date: string; amount: number }[] = await response.json();
  return data.map((row) => ({ date: row.date, amount: String(row.amount) }));
}

export async function getAccountLogoViaBackend(
  userId: string,
  accountId: string,
): Promise<{ logoId: string | null; logo: BackendAccountLogo | null }> {
  const response = await backendFetch("GET", `/api/accounts/${accountId}/logo`, userId);
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to fetch account logo"));
  }
  const data: { logo_id: string | null; logo: AccountLogoApiResponse | null } =
    await response.json();
  return { logoId: data.logo_id, logo: mapLogo(data.logo) };
}

export async function setAccountLogoIfMissingViaBackend(
  userId: string,
  accountId: string,
  logoId: string,
): Promise<{ applied: boolean; logoId: string | null; logo: BackendAccountLogo | null }> {
  const response = await backendFetch("PATCH", `/api/accounts/${accountId}/logo`, userId, {
    logo_id: logoId,
  });
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to set account logo"));
  }
  const data: { applied: boolean; logo_id: string | null; logo: AccountLogoApiResponse | null } =
    await response.json();
  return { applied: data.applied, logoId: data.logo_id, logo: mapLogo(data.logo) };
}
