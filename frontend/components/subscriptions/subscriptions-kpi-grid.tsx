"use client";

import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import type { SubscriptionKpis } from "@/features/subscriptions/public";

interface SubscriptionsKpiGridProps {
  kpis: SubscriptionKpis;
}

export function SubscriptionsKpiGrid({ kpis }: SubscriptionsKpiGridProps) {
  return (
    <div className="grid gap-4 md:grid-cols-3" data-walkthrough="walkthrough-kpis">
      <Card>
        <CardContent className="flex items-center justify-between gap-3 p-4 sm:p-6">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              Active Subscriptions
            </p>
            <p className="break-words font-mono text-xl font-semibold tracking-tight sm:text-2xl">
              {kpis.activeCount}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-center justify-between gap-3 p-4 sm:p-6">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              Total Monthly
            </p>
            <p className="break-words font-mono text-xl font-semibold tracking-tight sm:text-2xl">
              {formatCurrency(kpis.monthlyTotal, kpis.currency, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-center justify-between gap-3 p-4 sm:p-6">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              All Time Total
            </p>
            <p className="break-words font-mono text-xl font-semibold tracking-tight sm:text-2xl">
              {formatCurrency(kpis.allTimeTotal, kpis.currency, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
