"use client";
import { t as translate } from "@/i18n/translate";

import { useQuery } from "@tanstack/react-query";
import { KpiSparkCard } from "@/components/charts/kpi-spark-card";
import { getCashflowForecast } from "@/lib/forecast/api";

interface ProjectedBalanceKpiCardProps {
  currency: string;
  accountIds?: string[];
}

// Shares its react-query cache key with ForecastChart's default (30-day)
// horizon, so when both are visible at once this issues a single request.
export function ProjectedBalanceKpiCard({
  currency,
  accountIds,
}: ProjectedBalanceKpiCardProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["forecast", "cashflow", 30, accountIds],
    queryFn: () => getCashflowForecast({ horizonDays: 30, accountIds }),
  });

  return (
    <KpiSparkCard
      title={translate("projectedBalanceIn30Days")}
      value={data?.projectedBalanceAtHorizon ?? 0}
      currency={currency}
      subtitle={translate("basedOnRecurringAndTrend", { value1: 30 })}
      sparkData={
        data
          ? data.series.map((p) => ({
              date: p.date,
              value: p.projectedBalance,
            }))
          : []
      }
      isLoading={isLoading}
      sensitive
    />
  );
}
