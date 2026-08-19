export type BudgetStatus = "on_track" | "near_limit" | "over_budget";

export const budgetPeriods = ["monthly", "weekly", "yearly"] as const;
export type BudgetPeriod = (typeof budgetPeriods)[number];

export interface BudgetCategoryRef {
  id: string;
  name: string;
  color: string | null;
  subLimit: number | null;
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
  projectedSpend: number;
  projectedStatus: BudgetStatus;
}

export interface BudgetCategoryInput {
  categoryId: string;
  subLimit: number | null;
}

export interface BudgetCreateInput {
  name: string;
  amount: number;
  currency: string;
  period: BudgetPeriod;
  categories: BudgetCategoryInput[];
}

export interface BudgetUpdateInput {
  name?: string;
  amount?: number;
  currency?: string;
  period?: BudgetPeriod;
  categories?: BudgetCategoryInput[];
  isActive?: boolean;
}

export interface BudgetCategoryDetail extends BudgetCategoryRef {
  spent: number;
  status: BudgetStatus | "no_limit";
  percentage: number;
  // Share of the overall budget amount this sub-budget's subLimit represents.
  // Null when the category has no subLimit set.
  weight: number | null;
}

export interface BudgetDetailViewModel extends Omit<
  BudgetViewModel,
  "categories"
> {
  categories: BudgetCategoryDetail[];
}

export interface BudgetKpis {
  totalBudgeted: number;
  totalSpent: number;
  overBudgetCount: number;
  activeCount: number;
  currency: string;
}
