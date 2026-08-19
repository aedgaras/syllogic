import { describe, expect, it } from "vitest";
import { projectBudgetPace } from "./pace";

describe("projectBudgetPace", () => {
  it("extrapolates a flat daily rate to the full period", () => {
    // 100 spent in 10 days = 10/day, over a 30-day period = 300 projected.
    const pace = projectBudgetPace(100, 10, 30, 500);
    expect(pace.projectedSpend).toBe(300);
    expect(pace.projectedStatus).toBe("on_track");
  });

  it("flags projected over-budget before the limit is actually hit", () => {
    // 80 spent in 5 days = 16/day, over 30 days = 480 projected against a 400 limit.
    const pace = projectBudgetPace(80, 5, 30, 400);
    expect(pace.projectedSpend).toBe(480);
    expect(pace.projectedStatus).toBe("over_budget");
  });

  it("falls back to current spend when no days have elapsed yet", () => {
    const pace = projectBudgetPace(0, 0, 30, 100);
    expect(pace.projectedSpend).toBe(0);
    expect(pace.projectedStatus).toBe("on_track");
  });

  it("falls back to current spend for a zero-length period", () => {
    const pace = projectBudgetPace(50, 1, 0, 100);
    expect(pace.projectedSpend).toBe(50);
  });
});
