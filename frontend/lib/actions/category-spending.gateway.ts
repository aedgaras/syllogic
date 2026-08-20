import { getBackendBaseUrl } from "@/lib/backend-url";
import { createInternalAuthHeaders } from "@/lib/internal-auth";
import { resolveCategoryColor } from "@/lib/category-spending/helpers";
import {
  mapBackendTransaction,
  type BackendTransactionWithDetails,
} from "@/features/transactions/server/transaction-list.gateway";
import { hydrateResolvedAccountLogos } from "@/features/transactions/server/transaction-list.repository";
import { mapTransactionRowsForUi } from "@/features/transactions/server/transaction-list.mapper";
import type {
  CategorySpendingData,
  CategorySpendingFilters,
  CategorySpendingTransactionsFilters,
  CategorySpendingTransactionsPageResult,
} from "./category-spending";

function backendFetch(pathWithQuery: string, userId: string) {
  return fetch(`${getBackendBaseUrl()}${pathWithQuery}`, {
    headers: createInternalAuthHeaders({ method: "GET", pathWithQuery, userId }),
    cache: "no-store",
  });
}

function appendCommonFilterParams(params: URLSearchParams, filters: CategorySpendingFilters) {
  for (const id of filters.accountIds ?? []) params.append("account_ids", id);
  if (filters.dateFrom) params.set("from", filters.dateFrom);
  if (filters.dateTo) params.set("to", filters.dateTo);
  if (filters.horizon !== undefined) params.set("horizon", String(filters.horizon));
}

interface BackendCategorySpendingCategory {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  amount: string;
  share_pct: number;
  delta_amount: string;
  delta_pct: number;
  average_monthly_amount: string;
}

interface BackendCategorySpendingData {
  currency: string;
  categories: BackendCategorySpendingCategory[];
  summary: {
    total_spend: string;
    average_monthly_spend: string;
    top_category: { id: string; name: string; amount: string } | null;
  };
  range: {
    start_date: string;
    end_date: string;
    comparison_start_date: string;
    comparison_end_date: string;
    month_count: number;
    reference_date: string;
  };
}

export async function getCategorySpendingDataViaBackend(
  userId: string,
  filters: CategorySpendingFilters = {},
): Promise<CategorySpendingData> {
  const params = new URLSearchParams();
  appendCommonFilterParams(params, filters);
  const response = await backendFetch(
    `/api/transactions/stats/category-spending?${params.toString()}`,
    userId,
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch category spending: ${response.status}`);
  }
  const data: BackendCategorySpendingData = await response.json();

  const categories = data.categories.map((item, index) => ({
    id: item.id,
    name: item.name,
    color: item.color,
    icon: item.icon,
    fill: resolveCategoryColor(item.color, index),
    amount: Number.parseFloat(item.amount),
    sharePct: item.share_pct,
    deltaAmount: Number.parseFloat(item.delta_amount),
    deltaPct: item.delta_pct,
    averageMonthlyAmount: Number.parseFloat(item.average_monthly_amount),
  }));

  return {
    currency: data.currency,
    categories,
    summary: {
      totalSpend: Number.parseFloat(data.summary.total_spend),
      averageMonthlySpend: Number.parseFloat(data.summary.average_monthly_spend),
      topCategory: data.summary.top_category
        ? {
            id: data.summary.top_category.id,
            name: data.summary.top_category.name,
            amount: Number.parseFloat(data.summary.top_category.amount),
          }
        : null,
    },
    range: {
      startDate: data.range.start_date,
      endDate: data.range.end_date,
      comparisonStartDate: data.range.comparison_start_date,
      comparisonEndDate: data.range.comparison_end_date,
      monthCount: data.range.month_count,
      referenceDate: data.range.reference_date,
    },
  };
}

interface BackendCategorySpendingTransactionsPage {
  rows: BackendTransactionWithDetails[];
  total_count: number;
  page: number;
  page_size: number;
}

export async function getCategorySpendingTransactionsPageViaBackend(
  userId: string,
  filters: CategorySpendingTransactionsFilters = {},
): Promise<CategorySpendingTransactionsPageResult> {
  const params = new URLSearchParams();
  appendCommonFilterParams(params, filters);
  for (const id of filters.categoryIds ?? []) params.append("category", id);
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.order) params.set("order", filters.order);
  if (filters.page) params.set("page", String(filters.page));
  if (filters.pageSize) params.set("page_size", String(filters.pageSize));

  const response = await backendFetch(
    `/api/transactions/stats/category-spending/transactions?${params.toString()}`,
    userId,
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch category spending transactions: ${response.status}`);
  }
  const data: BackendCategorySpendingTransactionsPage = await response.json();

  const rows = data.rows.map(mapBackendTransaction);
  const hydratedRows = await hydrateResolvedAccountLogos(rows);

  return {
    rows: mapTransactionRowsForUi(hydratedRows, "getCategorySpendingTransactionsPage"),
    totalCount: data.total_count,
    page: data.page,
    pageSize: data.page_size,
  };
}
