"use client";
import { t as translate } from "@/i18n/translate";

import * as React from "react";
import {
  Bar,
  ComposedChart,
  ReferenceLine,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChartContainer,
  ChartConfig,
  ChartTooltip,
} from "@/components/ui/chart";
import { formatCurrency, cn } from "@/lib/utils";

interface IncomeExpenseDataPoint {
  month: string;
  monthDate: string;
  income: number;
  expenses: number;
  tooltipLabel?: string;
}

interface ProfitLossChartProps {
  data: IncomeExpenseDataPoint[];
  currency: string;
  average?: number;
  isLoading?: boolean;
}

function formatCompactNumber(value: number): string {
  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toFixed(0)}k`;
  }
  return value.toString();
}

const chartConfig = {
  income: {
    label: translate("income1c89b1"),
    theme: {
      light: "oklch(0.147 0.004 49.25)", // near black in light mode
      dark: "oklch(0.985 0.001 106.423)", // near white in dark mode
    },
  },
  expenses: {
    label: translate("expenses"),
    theme: {
      light: "oklch(0.553 0.013 58.071)", // muted gray in light mode
      dark: "oklch(0.553 0.013 58.071)", // muted gray in dark mode
    },
  },
} satisfies ChartConfig;

function ProfitLossChartSkeleton() {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <Skeleton className="h-5 w-32" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-[300px] w-full" />
      </CardContent>
    </Card>
  );
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    dataKey: string;
    payload: IncomeExpenseDataPoint;
    color?: string;
  }>;
  label?: string;
  currency: string;
}

function CustomTooltip({
  active,
  payload,
  label,
  currency,
}: CustomTooltipProps) {
  if (!active || !payload?.length) {
    return null;
  }

  const monthLabel = payload[0]?.payload.tooltipLabel ?? label ?? "";
  const income = payload.find((p) => p.dataKey === "income")?.value ?? 0;
  const expenses = payload.find((p) => p.dataKey === "expenses")?.value ?? 0;
  const net = income - expenses;

  return (
    <div className="border-border/50 bg-background min-w-[180px] border px-3 py-2.5 text-xs shadow-xl">
      <div className="mb-2 font-medium">{monthLabel}</div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-8">
          <div className="flex items-center gap-2">
            <div
              className="h-3 w-1 shrink-0"
              style={{ backgroundColor: "var(--color-income)" }}
            />
            <span className="text-muted-foreground">
              {translate("income1c89b1")}
            </span>
          </div>
          <span className="font-mono font-medium tabular-nums">
            {formatCurrency(income, currency)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-8">
          <div className="flex items-center gap-2">
            <div
              className="h-3 w-1 shrink-0"
              style={{ backgroundColor: "var(--color-expenses)" }}
            />
            <span className="text-muted-foreground">
              {translate("expenses")}
            </span>
          </div>
          <span className="font-mono font-medium tabular-nums">
            {formatCurrency(expenses, currency)}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-8 border-t border-border/50 pt-2">
          <span className="text-muted-foreground">{translate("net")}</span>
          <span
            className={cn(
              "font-mono font-medium tabular-nums",
              net >= 0 ? "text-emerald-500" : "text-red-500",
            )}
          >
            {net >= 0 ? "+" : ""}
            {formatCurrency(net, currency)}
          </span>
        </div>
      </div>
    </div>
  );
}

export function ProfitLossChart({
  data,
  currency,
  average,
  isLoading = false,
}: ProfitLossChartProps) {
  if (isLoading) {
    return <ProfitLossChartSkeleton />;
  }

  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm font-medium">
          {translate("incomeVsExpenses")}
        </CardTitle>
      </CardHeader>
      <CardContent className="min-w-0 px-2 pt-0 sm:px-4">
        <ChartContainer
          config={chartConfig}
          className="h-[240px] min-w-0 w-full sm:h-[300px]"
        >
          <ComposedChart
            data={data}
            margin={{ top: 20, right: 8, left: -8, bottom: 20 }}
            barCategoryGap="20%"
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border)"
              vertical={false}
            />
            <XAxis
              dataKey="month"
              axisLine={false}
              tickLine={false}
              tick={({ x, y, payload }) => {
                const axisLabel =
                  typeof payload.value === "string"
                    ? payload.value
                    : String(payload.value);
                return (
                  <g transform={`translate(${x},${y})`}>
                    <text
                      x={0}
                      y={0}
                      dy={18}
                      textAnchor="middle"
                      className="fill-muted-foreground"
                      fontSize={12}
                    >
                      <tspan x="0">{axisLabel}</tspan>
                    </text>
                  </g>
                );
              }}
              tickMargin={10}
              minTickGap={16}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
              tickFormatter={(value) => formatCompactNumber(value)}
              tickMargin={8}
              width={42}
            />
            <ChartTooltip
              content={<CustomTooltip currency={currency} />}
              cursor={{ fill: "var(--muted)", opacity: 0.3 }}
            />
            <Legend
              verticalAlign="top"
              align="right"
              wrapperStyle={{ paddingBottom: 20 }}
              formatter={(value) => (
                <span className="text-xs text-muted-foreground">{value}</span>
              )}
            />
            {average !== undefined && (
              <ReferenceLine
                y={average}
                stroke="var(--muted-foreground)"
                strokeDasharray="5 5"
                strokeWidth={1}
                label={{
                  value: translate("avg", {
                    value1: formatCompactNumber(average),
                  }),
                  position: "right",
                  fill: "var(--muted-foreground)",
                  fontSize: 11,
                }}
              />
            )}
            <Bar
              dataKey="income"
              fill="var(--color-income)"
              radius={[0, 0, 0, 0]}
              maxBarSize={40}
            />
            <Bar
              dataKey="expenses"
              fill="var(--color-expenses)"
              radius={[0, 0, 0, 0]}
              maxBarSize={40}
            />
          </ComposedChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
