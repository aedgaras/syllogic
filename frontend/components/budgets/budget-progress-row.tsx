"use client";
import { t as translate } from "@/i18n/translate";

import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import { ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatCurrency, cn } from "@/lib/utils";
import {
  RiDeleteBinLine,
  RiEditLine,
  RiMoreLine,
  RiPauseLine,
  RiPlayLine,
} from "@remixicon/react";
import type { BudgetViewModel } from "@/features/budgets/public";

interface BudgetProgressRowProps {
  budget: BudgetViewModel;
  onEdit: (budget: BudgetViewModel) => void;
  onDelete: (budget: BudgetViewModel) => void;
  onToggleActive: (budget: BudgetViewModel) => void;
}

const statusClasses: Record<BudgetViewModel["status"], string> = {
  on_track: "text-emerald-600 dark:text-emerald-500",
  near_limit: "text-amber-600 dark:text-amber-500",
  over_budget: "text-red-600 dark:text-red-500",
};

const indicatorClasses: Record<BudgetViewModel["status"], string> = {
  on_track: "bg-emerald-600 dark:bg-emerald-500",
  near_limit: "bg-amber-600 dark:bg-amber-500",
  over_budget: "bg-red-600 dark:bg-red-500",
};

const statusLabels: Record<BudgetViewModel["status"], string> = {
  on_track: translate("onTrack"),
  near_limit: translate("nearLimit"),
  over_budget: translate("overBudget"),
};

export function BudgetProgressRow({
  budget,
  onEdit,
  onDelete,
  onToggleActive,
}: BudgetProgressRowProps) {
  const clampedValue = Math.min(budget.percentage, 100);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 px-4 py-3 hover:bg-muted/40",
        !budget.isActive && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{budget.name}</span>
            <span className={cn("text-xs font-medium", statusClasses[budget.status])}>
              {statusLabels[budget.status]}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {budget.categories.map((category) => (
              <span
                key={category.id}
                className="inline-flex items-center truncate px-1.5 py-0.5 text-xs text-white"
                style={{ backgroundColor: category.color || "#6B7280" }}
              >
                {category.name}
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="whitespace-nowrap font-mono text-sm">
            {formatCurrency(budget.spent, budget.currency, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{" "}
            / {" "}
            {formatCurrency(budget.amount, budget.currency, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <RiMoreLine className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(budget)}>
                <RiEditLine className="mr-2 h-4 w-4" />
                {translate("edit")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onToggleActive(budget)}>
                {budget.isActive ? (
                  <>
                    <RiPauseLine className="mr-2 h-4 w-4" />
                    {translate("pauseBudget")}
                  </>
                ) : (
                  <>
                    <RiPlayLine className="mr-2 h-4 w-4" />
                    {translate("resumeBudget")}
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onDelete(budget)}
                className="text-destructive"
              >
                <RiDeleteBinLine className="mr-2 h-4 w-4" />
                {translate("delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <ProgressPrimitive.Root value={clampedValue} className="flex-1">
          <ProgressTrack>
            <ProgressIndicator className={indicatorClasses[budget.status]} />
          </ProgressTrack>
        </ProgressPrimitive.Root>
        <span
          className={cn(
            "w-12 shrink-0 text-right font-mono text-xs",
            statusClasses[budget.status],
          )}
        >
          {Math.round(budget.percentage)}%
        </span>
      </div>
    </div>
  );
}
