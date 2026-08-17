"use client";
import { t as translate } from "@/i18n/translate";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RiArrowLeftLine, RiEditLine } from "@remixicon/react";
import {
  fetchHoldingHistoryRange,
  type Range,
} from "@/lib/actions/investments";
import {
  type Holding,
  type HoldingLot,
  type HoldingTrade,
  type PortfolioSummary,
  type ValuationPoint,
} from "@/lib/api/investments";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { currencySymbol } from "@/lib/utils/currency";
import { PortfolioChart } from "./PortfolioChart";
import { TypeBadge } from "./HoldingsTableHF";
import { EditHoldingDialog } from "./EditHoldingDialog";

const RANGES: Range[] = ["1W", "1M", "3M", "1Y", "ALL"];

function fmt(n: number, digits = 2) {
  return n.toLocaleString("en", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function HoldingDetailView({
  holding,
  portfolio,
  initialHistory,
  trades = [],
  lots = [],
  isDemoRestricted = false,
}: {
  holding: Holding;
  portfolio: PortfolioSummary;
  initialHistory: ValuationPoint[];
  trades?: HoldingTrade[];
  lots?: HoldingLot[];
  isDemoRestricted?: boolean;
}) {
  const router = useRouter();
  const [range, setRange] = useState<Range>("1M");
  const [history, setHistory] = useState<ValuationPoint[]>(initialHistory);
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [chartErr, setChartErr] = useState<string | null>(null);
  const activeRangeRef = useRef<Range>("1M");

  const series = history
    .map((p) => Number(p.value))
    .filter((v) => Number.isFinite(v));

  const portfolioCurrSym = currencySymbol(portfolio.currency);
  const holdingCurrSym = currencySymbol(holding.currency);
  const marketValue = Number(holding.current_value_user_currency ?? 0);
  const totalValue = Number(portfolio.total_value);
  const weight = totalValue > 0 ? (marketValue / totalValue) * 100 : 0;
  const costBasis =
    holding.cost_basis_user_currency != null
      ? Number(holding.cost_basis_user_currency)
      : null;
  const totalReturn =
    costBasis != null && costBasis > 0
      ? ((marketValue - costBasis) / costBasis) * 100
      : null;

  const accountName =
    portfolio.accounts.find((a) => a.id === holding.account_id)?.name ??
    holding.account_id;

  const onRangeChange = (r: Range) => {
    const prev = range;
    setRange(r);
    setChartErr(null);
    activeRangeRef.current = r;
    startTransition(async () => {
      try {
        const next = await fetchHoldingHistoryRange(holding.id, r);
        if (activeRangeRef.current === r) setHistory(next);
      } catch {
        if (activeRangeRef.current === r) {
          activeRangeRef.current = prev;
          setRange(prev);
          setChartErr(translate("couldNotLoadHistory"));
        }
      }
    });
  };

  const stats: {
    label: string;
    value: string;
    tone?: "positive" | "negative";
  }[] = [
    {
      label: translate("currentPrice"),
      value: holding.current_price
        ? `${holdingCurrSym} ${fmt(Number(holding.current_price))}`
        : "—",
    },
    {
      label: translate("marketValue"),
      value: `${portfolioCurrSym} ${fmt(marketValue)}`,
    },
    {
      label: translate("totalReturn"),
      value:
        totalReturn != null
          ? `${totalReturn >= 0 ? "+" : ""}${fmt(totalReturn)}%`
          : "—",
      tone:
        totalReturn == null
          ? undefined
          : totalReturn >= 0
            ? "positive"
            : "negative",
    },
    {
      label: translate("avgCostShare"),
      value: holding.avg_cost
        ? `${holdingCurrSym} ${fmt(Number(holding.avg_cost))}`
        : "—",
    },
    {
      label: translate("portfolioWeight"),
      value: `${fmt(weight, 1)}%`,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={() => router.push("/investments")}
      >
        <RiArrowLeftLine className="size-4" />
        {translate("allHoldings")}
      </Button>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <span className="text-2xl font-bold tracking-tight">
            {holding.symbol}
          </span>
          <TypeBadge type={holding.instrument_type} />
          {holding.name && (
            <span className="text-sm text-muted-foreground">
              {holding.name}
            </span>
          )}
          {holding.is_stale && (
            <span
              title={translate("priceMayBeStale")}
              className="size-2 rounded-full bg-amber-500"
            />
          )}
          <Badge variant="outline" className="ml-auto">
            {accountName}
          </Badge>
          {!isDemoRestricted && holding.source === "manual" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditOpen(true)}
            >
              <RiEditLine className="size-4" />
              {translate("edit")}
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-5">
        {stats.map(({ label, value, tone }) => (
          <Card key={label}>
            <CardContent className="flex flex-col gap-1 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {label}
              </div>
              <div
                className={`text-sm font-semibold tabular-nums ${
                  tone === "positive"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : tone === "negative"
                      ? "text-destructive"
                      : ""
                }`}
              >
                {value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card
        className={
          pending ? "opacity-70 transition-opacity" : "transition-opacity"
        }
      >
        <CardHeader className="flex flex-row items-center justify-end pb-0">
          <ToggleGroup
            multiple={false}
            value={[range]}
            onValueChange={(v) => v[0] && onRangeChange(v[0] as Range)}
            variant="outline"
            size="sm"
          >
            {RANGES.map((r) => (
              <ToggleGroupItem
                key={r}
                value={r}
                aria-label={translate("range", { r: r })}
              >
                {r}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </CardHeader>
        <CardContent>
          {chartErr && (
            <p className="text-xs text-destructive mb-2">{chartErr}</p>
          )}
          <PortfolioChart data={series} currencySymbol={portfolioCurrSym} />
        </CardContent>
      </Card>

      <Tabs defaultValue="overview">
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="overview">{translate("overview")}</TabsTrigger>
          <TabsTrigger value="transactions">
            {translate("transactions")}
          </TabsTrigger>
          <TabsTrigger value="about">{translate("about")}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <Card>
            <CardContent className="p-4">
              {lots.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {translate("noOpenLots")}{" "}
                  {holding.source === "trade_import"
                    ? translate("allSharesForThisPositionHaveBeenSold")
                    : translate(
                        "positionMetadataCostBasisBreakdownAndLotsWillAppear",
                      )}
                </p>
              ) : (
                <>
                  <div className="space-y-2 md:hidden">
                    {lots.map((lot, idx) => {
                      const qty = Number(lot.quantity_remaining);
                      const cps = Number(lot.cost_per_share_native);
                      const px = Number(holding.current_price ?? 0);
                      const lotValue = px > 0 ? qty * px : NaN;
                      return (
                        <article
                          key={`${lot.open_date}-${lot.cost_per_share_native}-${idx}`}
                          className="rounded border p-3 text-sm"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-xs text-muted-foreground">
                                {translate("openDate")}
                              </div>
                              <div className="tabular-nums">
                                {lot.open_date}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs text-muted-foreground">
                                {translate("lotValue")}
                              </div>
                              <div className="tabular-nums font-medium">
                                {Number.isFinite(lotValue)
                                  ? translate("messagea2c07b", {
                                      holdingCurrSym: holdingCurrSym,
                                      value2: fmt(lotValue),
                                    })
                                  : "—"}
                              </div>
                            </div>
                          </div>
                          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                            <div>
                              <div className="text-muted-foreground">
                                {translate("qty")}
                              </div>
                              <div className="tabular-nums">
                                {fmt(qty, qty < 1 ? 4 : 2)}
                              </div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">
                                {translate("costShare")}
                              </div>
                              <div className="tabular-nums">{fmt(cps, 4)}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-muted-foreground">
                                {translate("age")}
                              </div>
                              <div className="tabular-nums">
                                {lot.age_days}d
                              </div>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                          <th className="py-2 pr-4">{translate("openDate")}</th>
                          <th className="py-2 pr-4 text-right">
                            {translate("quantity")}
                          </th>
                          <th className="py-2 pr-4 text-right">
                            {translate("costShare8a5175")}
                            {holding.currency})
                          </th>
                          <th className="py-2 pr-4 text-right">
                            {translate("lotValuea4ca2f")}
                            {holdingCurrSym})
                          </th>
                          <th className="py-2 pr-4 text-right">
                            {translate("age")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {lots.map((lot, idx) => {
                          const qty = Number(lot.quantity_remaining);
                          const cps = Number(lot.cost_per_share_native);
                          const px = Number(holding.current_price ?? 0);
                          const lotValue = px > 0 ? qty * px : NaN;
                          return (
                            <tr
                              key={`${lot.open_date}-${lot.cost_per_share_native}-${idx}`}
                              className="border-b last:border-b-0"
                            >
                              <td className="py-2 pr-4 tabular-nums">
                                {lot.open_date}
                              </td>
                              <td className="py-2 pr-4 text-right tabular-nums">
                                {fmt(qty, qty < 1 ? 4 : 2)}
                              </td>
                              <td className="py-2 pr-4 text-right tabular-nums">
                                {fmt(cps, 4)}
                              </td>
                              <td className="py-2 pr-4 text-right tabular-nums">
                                {Number.isFinite(lotValue)
                                  ? translate("messagea2c07b", {
                                      holdingCurrSym: holdingCurrSym,
                                      value2: fmt(lotValue),
                                    })
                                  : "—"}
                              </td>
                              <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                                {lot.age_days}d
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="transactions">
          <Card>
            <CardContent className="p-4">
              {trades.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {translate("noTradesRecordedForThisHoldingYet")}
                </p>
              ) : (
                <>
                  <div className="space-y-2 md:hidden">
                    {trades.map((t) => {
                      const total =
                        t.side === "buy"
                          ? Number(t.cost_native ?? 0)
                          : Number(t.proceeds_native ?? 0);
                      return (
                        <article
                          key={t.id}
                          className="rounded border p-3 text-sm"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-xs text-muted-foreground">
                                {translate("date")}
                              </div>
                              <div className="tabular-nums">{t.trade_date}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs text-muted-foreground">
                                {translate("totalb25928")}
                              </div>
                              <div className="tabular-nums font-medium">
                                {holdingCurrSym} {fmt(total)}
                              </div>
                            </div>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2 text-xs min-[420px]:grid-cols-4">
                            <div>
                              <div className="text-muted-foreground">
                                {translate("side")}
                              </div>
                              <div
                                className={
                                  t.side === "buy"
                                    ? "capitalize text-emerald-600 dark:text-emerald-400"
                                    : "capitalize text-destructive"
                                }
                              >
                                {t.side}
                              </div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">
                                {translate("qty")}
                              </div>
                              <div className="tabular-nums">
                                {fmt(Number(t.quantity), 4)}
                              </div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">
                                {translate("price")}
                              </div>
                              <div className="tabular-nums">
                                {fmt(Number(t.price), 4)}
                              </div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">
                                {translate("fees")}
                              </div>
                              <div className="tabular-nums">
                                {Number(t.fees) > 0
                                  ? fmt(Number(t.fees), 2)
                                  : "—"}
                              </div>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                          <th className="py-2 pr-4">{translate("date")}</th>
                          <th className="py-2 pr-4">{translate("side")}</th>
                          <th className="py-2 pr-4 text-right">
                            {translate("qty")}
                          </th>
                          <th className="py-2 pr-4 text-right">
                            {translate("price40f8de")}
                            {holding.currency})
                          </th>
                          <th className="py-2 pr-4 text-right">
                            {translate("fees")}
                          </th>
                          <th className="py-2 pr-4 text-right">
                            {translate("totalb25928")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {trades.map((t) => {
                          const total =
                            t.side === "buy"
                              ? Number(t.cost_native ?? 0)
                              : Number(t.proceeds_native ?? 0);
                          return (
                            <tr key={t.id} className="border-b last:border-b-0">
                              <td className="py-2 pr-4 tabular-nums">
                                {t.trade_date}
                              </td>
                              <td className="py-2 pr-4 capitalize">
                                <span
                                  className={
                                    t.side === "buy"
                                      ? "text-emerald-600 dark:text-emerald-400"
                                      : "text-destructive"
                                  }
                                >
                                  {t.side}
                                </span>
                              </td>
                              <td className="py-2 pr-4 text-right tabular-nums">
                                {fmt(Number(t.quantity), 4)}
                              </td>
                              <td className="py-2 pr-4 text-right tabular-nums">
                                {fmt(Number(t.price), 4)}
                              </td>
                              <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                                {Number(t.fees) > 0
                                  ? fmt(Number(t.fees), 2)
                                  : "—"}
                              </td>
                              <td className="py-2 pr-4 text-right tabular-nums">
                                {holdingCurrSym} {fmt(total)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="about">
          <Card>
            <CardContent className="p-4 text-sm">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                <dt className="text-muted-foreground">{translate("symbol")}</dt>
                <dd className="break-words">{holding.symbol}</dd>
                <dt className="text-muted-foreground">
                  {translate("instrumentType")}
                </dt>
                <dd className="capitalize">{holding.instrument_type}</dd>
                <dt className="text-muted-foreground">
                  {translate("currency")}
                </dt>
                <dd className="break-words">{holding.currency}</dd>
                <dt className="text-muted-foreground">{translate("source")}</dt>
                <dd className="capitalize">{holding.source}</dd>
                <dt className="text-muted-foreground">
                  {translate("account85dfa3")}
                </dt>
                <dd className="break-words">{accountName}</dd>
              </dl>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {!isDemoRestricted && holding.source === "manual" && (
        <EditHoldingDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          holding={holding}
        />
      )}
    </div>
  );
}
