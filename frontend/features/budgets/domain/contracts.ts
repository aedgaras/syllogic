export type BudgetStatus = "on_track" | "near_limit" | "over_budget";

export const budgetPeriods = ["monthly", "weekly", "yearly"] as const;
export type BudgetPeriod = (typeof budgetPeriods)[number];

export interface BudgetCategoryRef {
  id: string;
  name: string;
  color: string | null;
}

export interface BudgetViewModel {
  id: string;
  name: string;
  amount: number;
  currency: string;
  period: BudgetPeriod;
  isActive: boolean;
  categories: BudgetCategoryRef[];
  spent: number;
  status: BudgetStatus;
  percentage: number;
}

export interface BudgetCreateInput {
  name: string;
  amount: number;
  currency: string;
  period: BudgetPeriod;
  categoryIds: string[];
}

export interface BudgetUpdateInput {
  name?: string;
  amount?: number;
  currency?: string;
  period?: BudgetPeriod;
  categoryIds?: string[];
  isActive?: boolean;
}

export interface BudgetKpis {
  totalBudgeted: number;
  totalSpent: number;
  overBudgetCount: number;
  activeCount: number;
  currency: string;
}
