import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DeleteBudgetDialog } from "./delete-budget-dialog";
import type { BudgetViewModel } from "@/features/budgets/public";

const BUDGET = { id: "b1", name: "Groceries" } as unknown as BudgetViewModel;

describe("DeleteBudgetDialog", () => {
  it("is closed when budget is null", () => {
    render(
      <DeleteBudgetDialog budget={null} onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(screen.queryByText(/delete budget/i)).toBeNull();
  });

  it("shows the budget name in the confirmation message when open", () => {
    render(
      <DeleteBudgetDialog budget={BUDGET} onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(screen.getByText(/groceries/i)).toBeTruthy();
  });

  it("calls onConfirm with the budget when Delete is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <DeleteBudgetDialog budget={BUDGET} onOpenChange={vi.fn()} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(onConfirm).toHaveBeenCalledWith(BUDGET);
  });
});
