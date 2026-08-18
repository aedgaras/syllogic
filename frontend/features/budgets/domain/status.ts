import type { BudgetStatus } from "./contracts";

export const BUDGET_NEAR_LIMIT_THRESHOLD = 80;
export const BUDGET_OVER_THRESHOLD = 100;

export function computeBudgetStatus(
  spent: number,
  amount: number,
): BudgetStatus {
  const percentage = amount > 0 ? (spent / amount) * 100 : 0;
  if (percentage > BUDGET_OVER_THRESHOLD) return "over_budget";
  if (percentage >= BUDGET_NEAR_LIMIT_THRESHOLD) return "near_limit";
  return "on_track";
}
