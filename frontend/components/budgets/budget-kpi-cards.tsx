"use client";
import { t as translate } from "@/i18n/translate";

import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { MaskableAmount } from "@/components/hide-balances/maskable-amount";
import type { BudgetKpis } from "@/features/budgets/public";

interface BudgetKpiCardsProps {
  kpis: BudgetKpis;
}

export function BudgetKpiCards({ kpis }: BudgetKpiCardsProps) {
  const cards = [
    {
      label: translate("totalBudgeted"),
      value: formatCurrency(kpis.totalBudgeted, kpis.currency, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      sensitive: true,
    },
    {
      label: translate("totalSpent"),
      value: formatCurrency(kpis.totalSpent, kpis.currency, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      sensitive: true,
    },
    {
      label: translate("budgetsOverLimit"),
      value: String(kpis.overBudgetCount),
      sensitive: false,
    },
    {
      label: translate("activeBudgets"),
      value: String(kpis.activeCount),
      sensitive: false,
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardContent className="flex items-center justify-between gap-3 p-4 sm:p-6">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                {card.label}
              </p>
              <p className="break-words font-mono text-xl font-semibold tracking-tight sm:text-2xl">
                {card.sensitive ? (
                  <MaskableAmount value={card.value} />
                ) : (
                  card.value
                )}
              </p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
