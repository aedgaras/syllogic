import type { BalanceHistoryPoint } from "./contracts";

export interface DailyBalanceChange {
  date: string;
  amount: number;
}

function toCalendarDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function calculateStartingBalance(
  knownCurrentBalance: number,
  transactionSum: number,
): number {
  return knownCurrentBalance - transactionSum;
}

export function calculateBalance(
  startingBalance: number,
  transactionSum: number,
): number {
  return startingBalance + transactionSum;
}

export function buildBalanceHistory(
  startDate: Date,
  endDate: Date,
  openingBalance: number,
  dailyChanges: DailyBalanceChange[],
): BalanceHistoryPoint[] {
  const changes = new Map(dailyChanges.map((item) => [item.date, item.amount]));
  const points: BalanceHistoryPoint[] = [];
  const cursor = new Date(startDate);
  cursor.setHours(0, 0, 0, 0);
  const lastDate = new Date(endDate);
  lastDate.setHours(23, 59, 59, 999);
  let balance = openingBalance;

  while (cursor <= lastDate) {
    const date = toCalendarDate(cursor);
    balance += changes.get(date) ?? 0;
    points.push({ date, balance });
    cursor.setDate(cursor.getDate() + 1);
  }

  return points;
}
