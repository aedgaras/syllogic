"use client";
import { t as translate } from "@/i18n/translate";


import { Bar, BarChart, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import { format, parseISO } from "date-fns";

interface TransactionSummaryData {
  date: string;
  income: number;
  expenses: number;
}

interface TransactionSummaryChartProps {
  data: TransactionSummaryData[];
}

const chartConfig = {
  income: {
    label: translate("income1c89b1"),
    color: "var(--chart-2)",
  },
  expenses: {
    label: translate("expenses"),
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

export function TransactionSummaryChart({ data }: TransactionSummaryChartProps) {
  const chartData = data.map((item) => ({
    ...item,
    date: item.date,
  }));

  const yearChangeDates = new Set<string>();
  const seenYears = new Set<string>();
  for (const item of chartData) {
    const currentYear = format(parseISO(item.date), "yyyy");
    if (!seenYears.has(currentYear)) {
      seenYears.add(currentYear);
      yearChangeDates.add(item.date);
    }
  }

  const hasData = data.length > 0 && data.some((d) => d.income > 0 || d.expenses > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{translate("transactionSummary")}</CardTitle>
        <CardDescription>{translate("dailyIncomeVsExpensesLast30Days")}</CardDescription>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <ChartContainer config={chartConfig} className="h-[300px] w-full">
            <BarChart data={chartData} accessibilityLayer>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                tickMargin={10}
                axisLine={false}
                tick={({ x, y, payload }) => {
                  const date = parseISO(payload.value);
                  const monthDay = format(date, "MMM d");
                  const year = format(date, "yyyy");
                  const showYear = yearChangeDates.has(payload.value);
                  return (
                    <g transform={`translate(${x},${y})`}>
                      <text
                        x={0}
                        y={0}
                        dy={16}
                        textAnchor="middle"
                        className="fill-muted-foreground"
                      >
                        <tspan x="0">{monthDay}</tspan>
                        {showYear && <tspan x="0" dy="12">{year}</tspan>}
                      </text>
                    </g>
                  );
                }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => `${value}`}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    indicator="dashed"
                    labelFormatter={(_, payload) => {
                      const rawDate = payload?.[0]?.payload?.date;
                      return rawDate ? format(parseISO(rawDate), "MMMM d, yyyy") : "";
                    }}
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar dataKey="income" fill="var(--color-income)" radius={0} />
              <Bar dataKey="expenses" fill="var(--color-expenses)" radius={0} />
            </BarChart>
          </ChartContainer>
        ) : (
          <div className="flex h-[300px] items-center justify-center text-muted-foreground">
            <p>{translate("noTransactionDataAvailable")}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
