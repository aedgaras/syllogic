"use client";
import { t as translate } from "@/i18n/translate";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RiAddLine } from "@remixicon/react";
import { useBudgetListController } from "@/features/budgets/hooks/use-budget-list-controller";
import { createBudget, updateBudget } from "@/features/budgets/client/actions";
import type {
  BudgetEditFormValues,
  BudgetKpis,
  BudgetViewModel,
} from "@/features/budgets/public";
import { BudgetKpiCards } from "./budget-kpi-cards";
import { BudgetProgressRow } from "./budget-progress-row";
import { BudgetEditForm } from "./budget-edit-form";
import { DeleteBudgetDialog } from "./delete-budget-dialog";

interface BudgetsClientProps {
  initialBudgets: BudgetViewModel[];
  categories: Array<{ id: string; name: string; color: string | null }>;
  kpis: BudgetKpis;
}

export function BudgetsClient({
  initialBudgets,
  categories,
  kpis,
}: BudgetsClientProps) {
  const {
    budgets,
    dialog,
    openCreate,
    openEdit,
    openDelete,
    closeDialog,
    upsert,
    remove,
    toggle,
  } = useBudgetListController(initialBudgets);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isFormOpen = dialog.mode === "create" || dialog.mode === "edit";
  const editingBudget = dialog.mode === "edit" ? dialog.budget : null;
  const deletingBudget = dialog.mode === "delete" ? dialog.budget : null;

  async function handleSubmit(values: BudgetEditFormValues) {
    setIsSubmitting(true);
    try {
      if (editingBudget) {
        const result = await updateBudget(editingBudget.id, values);
        if (!result.success || !result.budget) {
          toast.error(result.error || translate("failedToUpdate"));
          return;
        }
        upsert(result.budget);
        toast.success(translate("budgetUpdated"));
      } else {
        const result = await createBudget(values);
        if (!result.success || !result.budget) {
          toast.error(result.error || translate("failedToCreate"));
          return;
        }
        upsert(result.budget);
        toast.success(translate("budgetCreated"));
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  const defaultCurrency = kpis.currency;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold">{translate("budgets")}</h2>
        <Button onClick={openCreate}>
          <RiAddLine className="mr-2 h-4 w-4" />
          {translate("createBudget")}
        </Button>
      </div>

      <BudgetKpiCards kpis={kpis} />

      {budgets.length > 0 ? (
        <div className="divide-y border border-border rounded-sm overflow-hidden">
          {budgets.map((budget) => (
            <BudgetProgressRow
              key={budget.id}
              budget={budget}
              onEdit={openEdit}
              onDelete={openDelete}
              onToggleActive={toggle}
            />
          ))}
        </div>
      ) : (
        <div className="flex h-48 flex-col items-center justify-center gap-3 border border-dashed rounded-sm text-center">
          <p className="text-sm text-muted-foreground">
            {translate("noBudgetsYet")}
          </p>
          <Button onClick={openCreate}>
            <RiAddLine className="mr-2 h-4 w-4" />
            {translate("createYourFirstBudget")}
          </Button>
        </div>
      )}

      <BudgetEditForm
        open={isFormOpen}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
        budget={editingBudget}
        categories={categories}
        defaultCurrency={defaultCurrency}
        pending={isSubmitting}
        onSubmit={handleSubmit}
      />

      <DeleteBudgetDialog
        budget={deletingBudget}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
        onConfirm={remove}
      />
    </div>
  );
}
