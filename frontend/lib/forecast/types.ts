export interface ForecastPoint {
  date: string;
  projectedBalance: number;
  low: number;
  high: number;
}

export interface CashflowForecast {
  startingBalance: number;
  cashStartingBalance: number;
  growthStartingBalance: number;
  projectedBalanceAtHorizon: number;
  projectedBalanceLowAtHorizon: number;
  projectedBalanceHighAtHorizon: number;
  projectedNetCashFlow: number;
  projectedIncome: number;
  projectedExpenses: number;
  growthProjectedChange: number;
  series: ForecastPoint[];
}
