"use client";
import { t as translate } from "@/i18n/translate";

import { useRef, useState, useEffect, useMemo } from "react";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ChartConfig, ChartContainer } from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSpring, useMotionValueEvent } from "motion/react";
import {
  format,
  parseISO,
  subDays,
  subMonths,
  subYears,
  startOfMonth,
  eachDayOfInterval,
  differenceInDays,
  differenceInMonths,
  differenceInYears,
  isBefore,
  startOfDay,
} from "date-fns";
import type { BalanceHistoryPoint } from "@/features/accounts/public";
import { useHideBalances } from "@/components/hide-balances/hide-balances-provider";

type Horizon = "7D" | "LM" | "30D" | "90D" | "6M" | "1Y" | "5Y" | "ALL";

const horizonOptions: { value: Horizon; label: string; description: string }[] =
  [
    {
      value: "7D",
      label: translate("message7d"),
      description: translate("last7Days"),
    },
    {
      value: "LM",
      label: translate("lm"),
      description: translate("lastMonth"),
    },
    {
      value: "30D",
      label: translate("message30d"),
      description: translate("last30Days"),
    },
    {
      value: "90D",
      label: translate("message90d"),
      description: translate("last90Days"),
    },
    {
      value: "6M",
      label: translate("message6m"),
      description: translate("last6Months"),
    },
    {
      value: "1Y",
      label: translate("message1y"),
      description: translate("last1Year"),
    },
    {
      value: "5Y",
      label: translate("message5y"),
      description: translate("message5Years"),
    },
    {
      value: "ALL",
      label: translate("all"),
      description: translate("allTime"),
    },
  ];

const horizonValueSet = new Set<Horizon>(
  horizonOptions.map((option) => option.value),
);

// Get appropriate date format based on the data range
function getDateFormat(startDate: Date, endDate: Date): string {
  const days = differenceInDays(endDate, startDate);
  const months = differenceInMonths(endDate, startDate);
  const years = differenceInYears(endDate, startDate);

  if (years >= 2) {
    return "yyyy"; // Just year: 2023, 2024
  } else if (months >= 6) {
    return "MMM yyyy"; // Month and year: Jan 2024
  } else if (days > 30) {
    return "MMM d"; // Month and day: Jan 15
  } else if (days > 7) {
    return "MMM d"; // Month and day: Jan 15
  } else {
    return "EEE"; // Day name: Mon, Tue
  }
}

interface AccountBalanceChartProps {
  data: BalanceHistoryPoint[];
  currency: string;
  storageKey?: string;
}

const chartConfig = {
  balance: {
    label: translate("balance"),
    color: "#10B981",
  },
} satisfies ChartConfig;

function getHorizonCutoffDate(horizon: Horizon): Date | null {
  const now = new Date();
  switch (horizon) {
    case "7D":
      return subDays(now, 7);
    case "LM":
      return startOfMonth(subMonths(now, 1));
    case "30D":
      return subDays(now, 30);
    case "90D":
      return subDays(now, 90);
    case "6M":
      return subMonths(now, 6);
    case "1Y":
      return subYears(now, 1);
    case "5Y":
      return subYears(now, 5);
    case "ALL":
      return null;
  }
}

export function AccountBalanceChart({
  data,
  currency,
  storageKey,
}: AccountBalanceChartProps) {
  const { hideBalances } = useHideBalances();
  const chartRef = useRef<HTMLDivElement>(null);
  const [axis, setAxis] = useState(0);
  const [isInitialized, setIsInitialized] = useState(false);
  const [currentDate, setCurrentDate] = useState<string | null>(null);
  const [horizon, setHorizon] = useState<Horizon>("90D");
  const skipPersistRef = useRef(true);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored && horizonValueSet.has(stored as Horizon)) {
        setHorizon(stored as Horizon);
      }
    } catch {
      // Ignore storage errors
    }
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }
    try {
      localStorage.setItem(storageKey, horizon);
    } catch {
      // Ignore storage errors
    }
  }, [storageKey, horizon]);

  const { chartData, dateFormat, yearTicks } = useMemo(() => {
    if (data.length === 0) {
      return { chartData: [], dateFormat: "MMM d", yearTicks: undefined };
    }

    const now = startOfDay(new Date());
    const cutoff = getHorizonCutoffDate(horizon);
    const horizonStart = cutoff ? startOfDay(cutoff) : null;

    // Find earliest data point
    const sortedData = [...data].sort(
      (a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime(),
    );
    const earliestDataDate = startOfDay(parseISO(sortedData[0].date));

    // Determine the actual start date for the chart
    let chartStartDate: Date;
    if (horizon === "ALL") {
      chartStartDate = earliestDataDate;
    } else if (horizonStart && isBefore(horizonStart, earliestDataDate)) {
      // Horizon extends before our data - clamp to earliest data
      chartStartDate = earliestDataDate;
    } else {
      // Use horizon start or earliest data, whichever is later
      chartStartDate = horizonStart || earliestDataDate;
    }

    // Create a map of existing data by date string
    const dataMap = new Map<string, number>();
    for (const point of data) {
      const dateKey = format(parseISO(point.date), "yyyy-MM-dd");
      dataMap.set(dateKey, point.balance);
    }

    // Generate all dates in the range
    const allDates = eachDayOfInterval({ start: chartStartDate, end: now });

    // Build chart data, filling zeros for dates before earliest data
    const filledData: BalanceHistoryPoint[] = allDates.map((date) => {
      const dateKey = format(date, "yyyy-MM-dd");
      const existingBalance = dataMap.get(dateKey);

      if (existingBalance !== undefined) {
        return { date: dateKey, balance: existingBalance };
      }

      // If date is before earliest data, use 0
      if (isBefore(date, earliestDataDate)) {
        return { date: dateKey, balance: 0 };
      }

      // For gaps in data after earliest date, find the most recent balance
      let lastBalance = 0;
      for (let i = allDates.indexOf(date) - 1; i >= 0; i--) {
        const prevKey = format(allDates[i], "yyyy-MM-dd");
        const prevBalance = dataMap.get(prevKey);
        if (prevBalance !== undefined) {
          lastBalance = prevBalance;
          break;
        }
      }
      return { date: dateKey, balance: lastBalance };
    });

    // Determine date format based on range
    const fmt = getDateFormat(chartStartDate, now);

    // For year format, compute unique year ticks to avoid duplicates
    let yearTicks: string[] | undefined;
    if (fmt === "yyyy") {
      const seenYears = new Set<string>();
      yearTicks = [];
      for (const point of filledData) {
        const year = format(parseISO(point.date), "yyyy");
        if (!seenYears.has(year)) {
          seenYears.add(year);
          // Find the first date of this year in our data
          const firstOfYear = filledData.find(
            (p) => format(parseISO(p.date), "yyyy") === year,
          );
          if (firstOfYear) {
            yearTicks.push(firstOfYear.date);
          }
        }
      }
    }

    return { chartData: filledData, dateFormat: fmt, yearTicks };
  }, [data, horizon]);

  const currentHorizonOption = horizonOptions.find((o) => o.value === horizon);

  const springX = useSpring(0, {
    damping: 30,
    stiffness: 100,
  });
  const springY = useSpring(0, {
    damping: 30,
    stiffness: 100,
  });

  useMotionValueEvent(springX, "change", (latest) => {
    setAxis(latest);
  });

  // Initialize to full width on mount or when filtered data changes
  useEffect(() => {
    if (chartRef.current && chartData.length > 0) {
      const width = chartRef.current.getBoundingClientRect().width;
      springX.jump(width);
      springY.jump(chartData[chartData.length - 1].balance);
      setCurrentDate(chartData[chartData.length - 1].date);
      setIsInitialized(true);
    }
  }, [chartData, springX, springY]);

  const formatCurrencyValue = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "EUR",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">{translate("balance")}</h3>
            <p className="text-sm text-muted-foreground">
              {translate("noDataAvailable")}
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            {translate("balanceHistoryWillAppearOnceTransactionsAreRecorded")}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{translate("balance")}</h3>
          <p className="text-sm text-muted-foreground">
            {currentHorizonOption?.description}
          </p>
        </div>
        <Select value={horizon} onValueChange={(v) => setHorizon(v as Horizon)}>
          <SelectTrigger className="w-fit gap-1.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false} className="min-w-0">
            {horizonOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            {translate("noDataAvailableForThisPeriod")}
          </div>
        ) : (
          <div className="relative">
            {/* Floating badge and vertical line */}
            {isInitialized && (
              <>
                {/* Vertical line */}
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left: axis,
                    top: 29,
                    bottom: 30,
                    width: 1,
                    borderLeft: "1px dashed #10B981",
                    opacity: 0.5,
                  }}
                />
                {/* Badge */}
                <div
                  className="absolute z-10 pointer-events-none"
                  style={{
                    left: axis,
                    top: 8,
                    transform: "translateX(-98%)",
                  }}
                >
                  <div
                    className="text-white text-xs font-semibold px-2 py-1 font-mono min-w-16 text-right"
                    style={{ backgroundColor: "#047857" }}
                  >
                    {hideBalances ? "••••" : formatCurrencyValue(springY.get())}
                  </div>
                  {currentDate && (
                    <div className="text-2xs text-muted-foreground mt-0.5">
                      {format(parseISO(currentDate), "MMM d")}
                    </div>
                  )}
                </div>
              </>
            )}

            <ChartContainer
              ref={chartRef}
              className="h-64 w-full"
              config={chartConfig}
            >
              <AreaChart
                accessibilityLayer
                data={chartData}
                onMouseMove={(state) => {
                  const x = state.activeCoordinate?.x;
                  const dataValue = state.activePayload?.[0]?.value;
                  const dataDate = state.activePayload?.[0]?.payload?.date;
                  if (x && dataValue !== undefined) {
                    springX.set(x);
                    springY.set(dataValue as number);
                    if (dataDate) setCurrentDate(dataDate);
                  }
                }}
                onMouseLeave={() => {
                  if (chartRef.current && chartData.length > 0) {
                    springX.set(chartRef.current.getBoundingClientRect().width);
                    springY.jump(chartData[chartData.length - 1].balance);
                    setCurrentDate(chartData[chartData.length - 1].date);
                  }
                }}
                margin={{ top: 30, right: 0, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient
                    id="gradient-clipped-area-balance"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  vertical={false}
                  strokeDasharray="3 3"
                  horizontalCoordinatesGenerator={(props) => {
                    const { height } = props;
                    return [0, height - 30];
                  }}
                />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={50}
                  ticks={yearTicks}
                  tickFormatter={(value) => format(parseISO(value), dateFormat)}
                />
                {/* Ghost line behind the graph */}
                <Area
                  dataKey="balance"
                  type="monotone"
                  fill="none"
                  stroke="#10B981"
                  strokeOpacity={0.15}
                  strokeWidth={2}
                />
                {/* Main animated area */}
                <Area
                  dataKey="balance"
                  type="monotone"
                  fill="url(#gradient-clipped-area-balance)"
                  fillOpacity={1}
                  stroke="#10B981"
                  strokeWidth={2}
                  style={{
                    clipPath: `inset(0 ${
                      Number(
                        chartRef.current?.getBoundingClientRect().width || 0,
                      ) - axis
                    }px 0 0)`,
                  }}
                />
              </AreaChart>
            </ChartContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
