export interface ForecastPoint {
  date: string;
  projectedBalance: number;
}

export interface CashflowForecast {
  startingBalance: number;
  projectedBalanceAtHorizon: number;
  projectedNetCashFlow: number;
  projectedIncome: number;
  projectedExpenses: number;
  series: ForecastPoint[];
}
