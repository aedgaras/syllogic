import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { BudgetKpiCards } from "./budget-kpi-cards";
import type { BudgetKpis } from "@/features/budgets/public";

const KPIS: BudgetKpis = {
  totalBudgeted: 1000,
  totalSpent: 750.5,
  overBudgetCount: 2,
  activeCount: 5,
  currency: "USD",
};

describe("BudgetKpiCards", () => {
  it("formats the budgeted and spent amounts as currency", () => {
    render(<BudgetKpiCards kpis={KPIS} />);
    expect(screen.getByText("$1,000.00")).toBeTruthy();
    expect(screen.getByText("$750.50")).toBeTruthy();
  });

  it("renders the raw counts for over-budget and active budgets", () => {
    render(<BudgetKpiCards kpis={KPIS} />);
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
  });

  it("renders all four labels", () => {
    render(<BudgetKpiCards kpis={KPIS} />);
    expect(screen.getByText(/total budgeted/i)).toBeTruthy();
    expect(screen.getByText(/total spent/i)).toBeTruthy();
    expect(screen.getByText(/over limit/i)).toBeTruthy();
    expect(screen.getByText(/active budgets/i)).toBeTruthy();
  });
});
