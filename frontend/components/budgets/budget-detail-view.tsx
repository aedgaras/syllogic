"use client";
import { t as translate } from "@/i18n/translate";

import Link from "next/link";
import { WeightBarVisualizer } from "@/components/assets/weight-bar-visualizer";
import { RiArrowLeftLine } from "@remixicon/react";
import { formatCurrency, cn } from "@/lib/utils";
import type { BudgetDetailViewModel } from "@/features/budgets/public";
import {
  statusClasses,
  statusHexColors,
  statusLabels,
  categoryStatusClasses,
  categoryStatusLabels,
  categoryStatusHexColors,
} from "./status-styles";

interface BudgetDetailViewProps {
  budget: BudgetDetailViewModel;
}

export function BudgetDetailView({ budget }: BudgetDetailViewProps) {
  const clampedOverall = Math.min(budget.percentage, 100);

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/budgets"
        className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <RiArrowLeftLine className="h-4 w-4" />
        {translate("backToBudgets")}
      </Link>

      <div className="flex flex-col gap-3 border border-border rounded-sm p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">
              {translate("overallProgress")}
            </h2>
            <span
              className={cn(
                "text-xs font-medium",
                statusClasses[budget.status],
              )}
            >
              {statusLabels[budget.status]}
            </span>
          </div>
          <span className="whitespace-nowrap font-mono text-sm">
            {formatCurrency(budget.spent, budget.currency, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{" "}
            /{" "}
            {formatCurrency(budget.amount, budget.currency, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <WeightBarVisualizer
            percentage={clampedOverall}
            color={statusHexColors[budget.status]}
          />
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

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">
          {translate("categoryBreakdown")}
        </h2>

        {budget.categories.length > 0 ? (
          <div className="divide-y border border-border rounded-sm overflow-hidden">
            {budget.categories.map((category) => {
              const clamped = Math.min(category.percentage, 100);
              return (
                <div
                  key={category.id}
                  className="flex flex-col gap-3 px-4 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-flex items-center truncate px-1.5 py-0.5 text-xs text-white"
                        style={{ backgroundColor: category.color || "#6B7280" }}
                      >
                        {category.name}
                      </span>
                      <span
                        className={cn(
                          "text-xs font-medium",
                          categoryStatusClasses[category.status],
                        )}
                      >
                        {categoryStatusLabels[category.status]}
                      </span>
                      {category.weight != null && (
                        <span className="text-xs text-muted-foreground">
                          {translate("weight")}: {Math.round(category.weight)}%
                        </span>
                      )}
                    </div>
                    <span className="whitespace-nowrap font-mono text-sm">
                      {category.subLimit == null
                        ? formatCurrency(category.spent, budget.currency, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })
                        : `${formatCurrency(category.spent, budget.currency, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })} / ${formatCurrency(
                            category.subLimit,
                            budget.currency,
                            {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            },
                          )}`}
                    </span>
                  </div>
                  {category.subLimit != null && (
                    <div className="flex items-center gap-3">
                      <WeightBarVisualizer
                        percentage={clamped}
                        color={categoryStatusHexColors[category.status]}
                      />
                      <span
                        className={cn(
                          "w-12 shrink-0 text-right font-mono text-xs",
                          categoryStatusClasses[category.status],
                        )}
                      >
                        {Math.round(category.percentage)}%
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex h-32 flex-col items-center justify-center gap-1 border border-dashed rounded-sm text-center">
            <p className="text-sm text-muted-foreground">
              {translate("noCategoriesAssignedToBudget")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
