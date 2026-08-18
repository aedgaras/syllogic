import { t as translate } from "@/i18n/translate";
import type { BudgetStatus } from "@/features/budgets/public";

export type CategoryBudgetStatus = BudgetStatus | "no_limit";

export const statusClasses: Record<BudgetStatus, string> = {
  on_track: "text-emerald-600 dark:text-emerald-500",
  near_limit: "text-amber-600 dark:text-amber-500",
  over_budget: "text-red-600 dark:text-red-500",
};

export const indicatorClasses: Record<BudgetStatus, string> = {
  on_track: "bg-emerald-600 dark:bg-emerald-500",
  near_limit: "bg-amber-600 dark:bg-amber-500",
  over_budget: "bg-red-600 dark:bg-red-500",
};

export const statusLabels: Record<BudgetStatus, string> = {
  on_track: translate("onTrack"),
  near_limit: translate("nearLimit"),
  over_budget: translate("overBudget"),
};

export const categoryStatusClasses: Record<CategoryBudgetStatus, string> = {
  ...statusClasses,
  no_limit: "text-muted-foreground",
};

export const categoryStatusLabels: Record<CategoryBudgetStatus, string> = {
  ...statusLabels,
  no_limit: translate("noSubBudgetSet"),
};
