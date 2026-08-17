import { describe, expect, it } from "vitest";
import {
  buildBalanceHistory,
  calculateBalance,
  calculateStartingBalance,
} from "./balance-history";

describe("account balance rules", () => {
  it("derives a starting balance from a known current balance", () => {
    expect(calculateStartingBalance(125, 25)).toBe(100);
  });

  it("derives a balance from a starting balance and transaction sum", () => {
    expect(calculateBalance(100, -12.5)).toBe(87.5);
  });

  it("fills missing dates while carrying the latest balance", () => {
    expect(
      buildBalanceHistory(
        new Date("2026-08-14T00:00:00Z"),
        new Date("2026-08-16T00:00:00Z"),
        100,
        [
          { date: "2026-08-14", amount: 20 },
          { date: "2026-08-16", amount: -5 },
        ],
      ),
    ).toEqual([
      { date: "2026-08-14", balance: 120 },
      { date: "2026-08-15", balance: 120 },
      { date: "2026-08-16", balance: 115 },
    ]);
  });
});
