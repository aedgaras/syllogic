"use client";
import { t as translate } from "@/i18n/translate";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, ComposedChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  ChartContainer,
  ChartConfig,
  ChartTooltip,
} from "@/components/ui/chart";
import { formatCurrency, cn } from "@/lib/utils";
import { getCashflowForecast } from "@/lib/forecast/api";

const HORIZONS = [7, 30, 90, 180] as const;
type Horizon = (typeof HORIZONS)[number];

const HORIZON_LABEL: Record<Horizon, string> = {
  7: translate("forecastHorizon7d"),
  30: translate("forecastHorizon30d"),
  90: translate("forecastHorizon90d"),
  180: translate("forecastHorizon180d"),
};

const chartConfig = {
  projectedBalance: {
    label: translate("projectedBalance"),
    theme: {
      light: "oklch(0.147 0.004 49.25)",
      dark: "oklch(0.985 0.001 106.423)",
    },
  },
  band: {
    label: translate("projectedRange"),
    theme: {
      light: "oklch(0.147 0.004 49.25)",
      dark: "oklch(0.985 0.001 106.423)",
    },
  },
} satisfies ChartConfig;

function formatCompactNumber(value: number): string {
  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toFixed(0)}k`;
  }
  return value.toString();
}

function ForecastChartSkeleton() {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-[240px] w-full" />
      </CardContent>
    </Card>
  );
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; payload: { date: string; low: number; high: number } }>;
  currency: string;
}

function CustomTooltip({ active, payload, currency }: CustomTooltipProps) {
  if (!active || !payload?.length) {
    return null;
  }
  const point = payload[0];
  return (
    <div className="border-border/50 bg-background min-w-[160px] border px-3 py-2.5 text-xs shadow-xl">
      <div className="mb-1.5 font-medium">{point.payload.date}</div>
      <div className="flex items-center justify-between gap-8">
        <span className="text-muted-foreground">
          {translate("projectedBalance")}
        </span>
        <span className="font-mono font-medium tabular-nums">
          {formatCurrency(point.value, currency)}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-8">
        <span className="text-muted-foreground">{translate("projectedRange")}</span>
        <span className="font-mono text-muted-foreground tabular-nums">
          {formatCurrency(point.payload.low, currency)} – {formatCurrency(point.payload.high, currency)}
        </span>
      </div>
    </div>
  );
}

interface ForecastChartProps {
  currency: string;
  accountIds?: string[];
}

export function ForecastChart({ currency, accountIds }: ForecastChartProps) {
  const [horizon, setHorizon] = React.useState<Horizon>(30);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["forecast", "cashflow", horizon, accountIds],
    queryFn: () => getCashflowForecast({ horizonDays: horizon, accountIds }),
  });

  if (isLoading) {
    return <ForecastChartSkeleton />;
  }

  if (isError || !data) {
    return null;
  }

  const netChange = data.projectedNetCashFlow;
  const growthChange = data.growthProjectedChange;
  const hasGrowthLeg = data.growthStartingBalance !== 0 || growthChange !== 0;
  const chartData = data.series.map((p) => ({
    ...p,
    band: [p.low, p.high] as [number, number],
  }));

  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <div className="space-y-1">
          <CardTitle className="text-sm font-medium">
            {translate("cashFlowForecast")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {translate("netProjectedChange")}:{" "}
            <span
              className={cn(
                "font-mono font-medium tabular-nums",
                netChange >= 0 ? "text-emerald-500" : "text-red-500",
              )}
            >
              {netChange >= 0 ? "+" : ""}
              {formatCurrency(netChange, currency)}
            </span>
          </p>
          {hasGrowthLeg && (
            <p className="text-xs text-muted-foreground">
              {translate("cashVsGrowth")}:{" "}
              <span className="font-mono tabular-nums">
                {formatCurrency(netChange - growthChange, currency)}
              </span>{" "}
              {translate("cash")} / {" "}
              <span className="font-mono tabular-nums">
                {formatCurrency(growthChange, currency)}
              </span>{" "}
              {translate("growth")}
            </p>
          )}
        </div>
        <ToggleGroup
          multiple={false}
          value={[String(horizon)]}
          onValueChange={(v) => v[0] && setHorizon(Number(v[0]) as Horizon)}
          variant="outline"
          size="sm"
        >
          {HORIZONS.map((h) => (
            <ToggleGroupItem key={h} value={String(h)}>
              {HORIZON_LABEL[h]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </CardHeader>
      <CardContent className="min-w-0 px-2 pt-0 sm:px-4">
        <ChartContainer
          config={chartConfig}
          className="h-[240px] min-w-0 w-full sm:h-[300px]"
        >
          <ComposedChart
            data={chartData}
            margin={{ top: 20, right: 8, left: -8, bottom: 20 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border)"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
              tickMargin={10}
              minTickGap={24}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
              tickFormatter={(value) => formatCompactNumber(value)}
              tickMargin={8}
              width={42}
            />
            <ChartTooltip content={<CustomTooltip currency={currency} />} />
            <Area
              dataKey="band"
              stroke="none"
              fill="var(--color-band)"
              fillOpacity={0.12}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="projectedBalance"
              stroke="var(--color-projectedBalance)"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
