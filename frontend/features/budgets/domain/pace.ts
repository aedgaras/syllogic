import type { BudgetStatus } from "./contracts";
import { computeBudgetStatus } from "./status";

export interface BudgetPace {
  projectedSpend: number;
  projectedStatus: BudgetStatus;
}

/**
 * Extrapolates today's spend rate to the end of the period: if spend keeps
 * accruing at the same daily pace as it has so far, what will the total be
 * by the time the period ends? Lets a budget card flag "on track to bust
 * this" before the limit is actually hit.
 */
export function projectBudgetPace(
  spentSoFar: number,
  daysElapsed: number,
  daysInPeriod: number,
  amount: number,
): BudgetPace {
  if (daysElapsed <= 0 || daysInPeriod <= 0) {
    return {
      projectedSpend: spentSoFar,
      projectedStatus: computeBudgetStatus(spentSoFar, amount),
    };
  }

  const dailyRate = spentSoFar / daysElapsed;
  const projectedSpend = dailyRate * daysInPeriod;

  return {
    projectedSpend,
    projectedStatus: computeBudgetStatus(projectedSpend, amount),
  };
}
