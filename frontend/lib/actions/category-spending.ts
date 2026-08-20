"use server";

import { getAuthenticatedSession } from "@/lib/auth-helpers";
import type { SupportedHorizon } from "@/lib/dashboard/query-params";
import type { TransactionWithRelations } from "@/features/transactions/public";
import type {
  CategorySpendingSortField,
  CategorySpendingSortOrder,
} from "@/lib/category-spending/query-params";
import { formatIsoDate } from "@/lib/category-spending/helpers";
import {
  getCategorySpendingDataViaBackend,
  getCategorySpendingTransactionsPageViaBackend,
} from "@/lib/actions/category-spending.gateway";

export interface CategorySpendingFilters {
  accountIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  horizon?: SupportedHorizon;
}

export interface CategorySpendingTransactionsFilters extends CategorySpendingFilters {
  categoryIds?: string[];
  page?: number;
  pageSize?: number;
  sort?: CategorySpendingSortField;
  order?: CategorySpendingSortOrder;
}

export interface CategorySpendingCategory {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  fill: string;
  amount: number;
  sharePct: number;
  deltaAmount: number;
  deltaPct: number;
  averageMonthlyAmount: number;
}

export interface CategorySpendingSummary {
  totalSpend: number;
  averageMonthlySpend: number;
  topCategory: {
    id: string;
    name: string;
    amount: number;
  } | null;
}

export interface CategorySpendingData {
  currency: string;
  categories: CategorySpendingCategory[];
  summary: CategorySpendingSummary;
  range: {
    startDate: string;
    endDate: string;
    comparisonStartDate: string;
    comparisonEndDate: string;
    monthCount: number;
    referenceDate: string;
  };
}

export interface CategorySpendingTransactionsPageResult {
  rows: TransactionWithRelations[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export async function getCategorySpendingData(
  filters: CategorySpendingFilters = {},
): Promise<CategorySpendingData> {
  const session = await getAuthenticatedSession();

  if (!session?.user?.id) {
    return {
      currency: "EUR",
      categories: [],
      summary: {
        totalSpend: 0,
        averageMonthlySpend: 0,
        topCategory: null,
      },
      range: {
        startDate: formatIsoDate(new Date()),
        endDate: formatIsoDate(new Date()),
        comparisonStartDate: formatIsoDate(new Date()),
        comparisonEndDate: formatIsoDate(new Date()),
        monthCount: 1,
        referenceDate: formatIsoDate(new Date()),
      },
    };
  }

  return getCategorySpendingDataViaBackend(session.user.id, filters);
}

export async function getCategorySpendingTransactionsPage(
  filters: CategorySpendingTransactionsFilters = {},
): Promise<CategorySpendingTransactionsPageResult> {
  const session = await getAuthenticatedSession();

  if (!session?.user?.id) {
    return {
      rows: [],
      totalCount: 0,
      page: filters.page ?? 1,
      pageSize: filters.pageSize ?? 20,
    };
  }

  return getCategorySpendingTransactionsPageViaBackend(session.user.id, filters);
}
