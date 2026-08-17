import {
  parseHorizonParam,
  parseIsoDateParam,
} from "@/lib/dashboard/query-params";
import { parseAccountParams } from "@/lib/filters/global-filters";
import type {
  TransactionSortField,
  TransactionSortOrder,
  TransactionsQueryState,
} from "./domain/contracts";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MIN_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;
const DEFAULT_SORT = "bookedAt";
const DEFAULT_ORDER = "desc";
const DEFAULT_HORIZON = 30;

type SearchParamsInput = Record<string, string | string[] | undefined>;
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

function parsePositiveInt(value: string | undefined | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

function parseMultiValueParam(
  searchParams: Pick<URLSearchParams, "getAll">,
  key: string,
) {
  return Array.from(
    new Set(
      searchParams
        .getAll(key)
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function toURLSearchParams(params: SearchParamsInput) {
  const nextParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value))
      value.forEach((entry) => nextParams.append(key, entry));
    else if (typeof value === "string") nextParams.append(key, value);
  }
  return nextParams;
}

function parseSortField(
  value: string | undefined | null,
): TransactionSortField {
  return value === "bookedAt" ||
    value === "amount" ||
    value === "description" ||
    value === "merchant"
    ? value
    : DEFAULT_SORT;
}

function parseSortOrder(
  value: string | undefined | null,
): TransactionSortOrder {
  return value === "asc" || value === "desc" ? value : DEFAULT_ORDER;
}

function normalizeDateRange(
  fromRaw?: string,
  toRaw?: string,
): { from?: string; to?: string } {
  const from = parseIsoDateParam(fromRaw);
  const to = parseIsoDateParam(toRaw);
  if (!from) return {};
  return !to || to < from ? { from } : { from, to };
}

function parseInternal(searchParams: URLSearchParams): TransactionsQueryState {
  const { from, to } = normalizeDateRange(
    searchParams.get("from") || undefined,
    searchParams.get("to") || undefined,
  );
  return {
    page: parsePositiveInt(searchParams.get("page"), DEFAULT_PAGE),
    pageSize: clamp(
      parsePositiveInt(searchParams.get("pageSize"), DEFAULT_PAGE_SIZE),
      MIN_PAGE_SIZE,
      MAX_PAGE_SIZE,
    ),
    search: searchParams.get("search")?.trim() || undefined,
    category: parseMultiValueParam(searchParams, "category"),
    accountIds: parseAccountParams(searchParams),
    status: parseMultiValueParam(searchParams, "status"),
    subscription: parseMultiValueParam(searchParams, "subscription"),
    analytics: parseMultiValueParam(searchParams, "analytics"),
    minAmount: searchParams.get("minAmount")?.trim() || undefined,
    maxAmount: searchParams.get("maxAmount")?.trim() || undefined,
    from,
    to,
    horizon: from ? undefined : parseHorizonParam(searchParams.get("horizon")),
    sort: parseSortField(searchParams.get("sort")),
    order: parseSortOrder(searchParams.get("order")),
  };
}

export function parseTransactionsSearchParams(searchParams: SearchParamsInput) {
  return parseInternal(toURLSearchParams(searchParams));
}

export function parseTransactionsSearchParamsFromUrlSearchParams(
  searchParams: URLSearchParams,
) {
  return parseInternal(searchParams);
}

export function toTransactionsSearchParams(state: TransactionsQueryState) {
  const params = new URLSearchParams();
  if (state.page !== DEFAULT_PAGE) params.set("page", String(state.page));
  if (state.pageSize !== DEFAULT_PAGE_SIZE)
    params.set("pageSize", String(state.pageSize));
  if (state.search) params.set("search", state.search);
  state.category.forEach((id) => params.append("category", id));
  state.accountIds.forEach((id) => params.append("account", id));
  state.status.forEach((id) => params.append("status", id));
  state.subscription.forEach((id) => params.append("subscription", id));
  state.analytics.forEach((id) => params.append("analytics", id));
  if (state.minAmount) params.set("minAmount", state.minAmount);
  if (state.maxAmount) params.set("maxAmount", state.maxAmount);
  if (state.from) {
    params.set("from", state.from);
    if (state.to) params.set("to", state.to);
  } else if (state.horizon) params.set("horizon", String(state.horizon));
  if (state.sort !== DEFAULT_SORT) params.set("sort", state.sort);
  if (state.order !== DEFAULT_ORDER) params.set("order", state.order);
  return params;
}

export function applyTransactionsQueryPatch(
  currentSearchParams: URLSearchParams,
  patch: Partial<TransactionsQueryState>,
) {
  const nextState = {
    ...parseTransactionsSearchParamsFromUrlSearchParams(currentSearchParams),
    ...patch,
  };
  if (nextState.page < 1 || !Number.isFinite(nextState.page))
    nextState.page = DEFAULT_PAGE;
  nextState.pageSize = clamp(nextState.pageSize, MIN_PAGE_SIZE, MAX_PAGE_SIZE);
  return toTransactionsSearchParams(nextState);
}

export function hasActiveTransactionFilters(state: TransactionsQueryState) {
  return Boolean(
    state.search ||
    state.category.length ||
    state.accountIds.length ||
    state.status.length ||
    state.subscription.length ||
    state.analytics.length ||
    state.minAmount ||
    state.maxAmount ||
    state.from ||
    state.to ||
    (state.horizon !== undefined && state.horizon !== DEFAULT_HORIZON),
  );
}

export type {
  TransactionSortField,
  TransactionSortOrder,
  TransactionsQueryState,
} from "./domain/contracts";
