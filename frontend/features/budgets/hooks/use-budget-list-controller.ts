"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  deleteBudget,
  toggleBudgetActive,
} from "../client/actions";
import type { BudgetViewModel } from "../public";

export type BudgetDialogState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; budget: BudgetViewModel }
  | { mode: "delete"; budget: BudgetViewModel };

export function useBudgetListController(initialBudgets: BudgetViewModel[]) {
  const [budgetList, setBudgetList] = useState(initialBudgets);
  const [dialog, setDialog] = useState<BudgetDialogState>({ mode: "closed" });

  function openCreate() {
    setDialog({ mode: "create" });
  }

  function openEdit(budget: BudgetViewModel) {
    setDialog({ mode: "edit", budget });
  }

  function openDelete(budget: BudgetViewModel) {
    setDialog({ mode: "delete", budget });
  }

  function closeDialog() {
    setDialog({ mode: "closed" });
  }

  function upsert(budget: BudgetViewModel) {
    setBudgetList((prev) => {
      const index = prev.findIndex((b) => b.id === budget.id);
      if (index === -1) return [budget, ...prev];
      const next = [...prev];
      next[index] = budget;
      return next;
    });
    closeDialog();
  }

  async function remove(budget: BudgetViewModel) {
    const result = await deleteBudget(budget.id);
    if (!result.success) {
      toast.error(result.error || "Failed to delete budget");
      return;
    }
    setBudgetList((prev) => prev.filter((b) => b.id !== budget.id));
    toast.success("Budget deleted");
    closeDialog();
  }

  async function toggle(budget: BudgetViewModel) {
    const isActive = !budget.isActive;
    const result = await toggleBudgetActive(budget.id, isActive);
    if (!result.success) {
      toast.error(result.error || "Failed to update status");
      return;
    }
    setBudgetList((prev) =>
      prev.map((b) => (b.id === budget.id ? { ...b, isActive } : b)),
    );
    toast.success(isActive ? "Budget resumed" : "Budget paused");
  }

  return {
    budgets: budgetList,
    dialog,
    openCreate,
    openEdit,
    openDelete,
    closeDialog,
    upsert,
    remove,
    toggle,
  };
}
