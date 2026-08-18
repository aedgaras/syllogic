"use client";
import { t as translate } from "@/i18n/translate";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { BudgetViewModel } from "@/features/budgets/public";

interface DeleteBudgetDialogProps {
  budget: BudgetViewModel | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (budget: BudgetViewModel) => void;
}

export function DeleteBudgetDialog({
  budget,
  onOpenChange,
  onConfirm,
}: DeleteBudgetDialogProps) {
  return (
    <AlertDialog open={!!budget} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{translate("deleteBudget")}</AlertDialogTitle>
          <AlertDialogDescription>
            {budget &&
              translate("confirmDeleteBudget", { value1: budget.name })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{translate("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => budget && onConfirm(budget)}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {translate("delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
