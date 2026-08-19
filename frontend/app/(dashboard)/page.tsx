import { t as translate } from "@/i18n/translate";
import { Suspense } from "react";
import { Header } from "@/components/layout/header";
import { KpiSparkCard } from "@/components/charts/kpi-spark-card";
import { ProfitLossChart } from "@/components/charts/profit-loss-chart";
import { SpendingByCategoryChart } from "@/components/charts/spending-by-category-chart";
import { SankeyFlowChart } from "@/components/charts/sankey-flow-chart";
import { ForecastChart } from "@/components/charts/forecast-chart";
import { ProjectedBalanceKpiCard } from "@/components/charts/projected-balance-kpi-card";
import { AssetsOverviewCard } from "@/components/assets";
import { PortfolioSummaryCard } from "@/components/investments/PortfolioSummaryCard";
import { DashboardFilters } from "@/components/dashboard/dashboard-filters";
import { SearchButton } from "@/components/dashboard/search-button";
import { AiSummaryCard } from "@/components/dashboard/ai-summary-card";
import {
  getDashboardData,
  getUserAccounts,
  type DashboardFilters as DashboardFiltersType,
} from "@/lib/actions/dashboard";
import { isAiSummaryEnabled } from "@/lib/actions/settings";
import { parseDashboardSearchParams } from "@/lib/dashboard/query-params";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";

interface PageProps {
  searchParams: Promise<{
    [key: string]: string | string[] | undefined;
  }>;
}

export default async function HomePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const parsedParams = parseDashboardSearchParams(params);

  return (
    <>
      <Header title={translate("dashboard")} />
      {/* The heavy data fetch lives inside this boundary, so the shell paints
          immediately and the charts stream in once their queries resolve,
          rather than blocking the whole navigation. */}
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent parsedParams={parsedParams} />
      </Suspense>
    </>
  );
}

async function DashboardContent({
  parsedParams,
}: {
  parsedParams: ReturnType<typeof parseDashboardSearchParams>;
}) {
  const accountIds = parsedParams.accountIds;
  const dateFromParam = parsedParams.dateFrom;
  const dateToParam = parsedParams.dateTo;
  const horizonValue = parsedParams.horizon;
  const effectiveHorizon = parsedParams.effectiveHorizon;

  // Parse filters from URL search params
  const filters: DashboardFiltersType = {};

  if (accountIds?.length) {
    filters.accountIds = accountIds;
  }

  if (dateFromParam) {
    filters.dateFrom = new Date(dateFromParam);
  }

  if (dateToParam) {
    filters.dateTo = new Date(dateToParam);
  }

  filters.horizon = horizonValue;

  // Fetch data in parallel
  const [data, accounts, aiSummaryEnabled] = await Promise.all([
    getDashboardData(filters),
    getUserAccounts(),
    isAiSummaryEnabled(),
  ]);

  const accountSubtitle = !accountIds?.length
    ? translate("acrossAllAccounts")
    : accountIds.length === 1
      ? translate("selectedAccount")
      : translate("selectedAccounts");

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      {/* Filters Row */}
      <div
        className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
        data-walkthrough="walkthrough-filters"
      >
        <Suspense fallback={null}>
          <DashboardFilters accounts={accounts} />
        </Suspense>
        <SearchButton />
      </div>

      {aiSummaryEnabled && <AiSummaryCard filters={filters} />}

      {/* Row 1: KPI Cards */}
      <div className="grid gap-4 md:grid-cols-5">
        <div data-walkthrough="walkthrough-balance">
          <KpiSparkCard
            title={translate("totalBalance")}
            value={data.balance.total}
            currency={data.balance.currency}
            subtitle={accountSubtitle}
            sparkData={data.balanceHistory}
          />
        </div>
        <div data-walkthrough="walkthrough-spending">
          <KpiSparkCard
            title={translate("spending", { value1: data.periodLabel.title })}
            value={data.periodSpending.total}
            currency={data.periodSpending.currency}
            subtitle={data.periodLabel.subtitle}
            sparkData={data.spendingHistory}
          />
        </div>
        <div data-walkthrough="walkthrough-income">
          <KpiSparkCard
            title={translate("income", { value1: data.periodLabel.title })}
            value={data.periodIncome.total}
            currency={data.periodIncome.currency}
            subtitle={data.periodLabel.subtitle}
            sparkData={data.incomeHistory}
          />
        </div>
        <div data-walkthrough="walkthrough-savings">
          <KpiSparkCard
            title={translate("savingsRate")}
            value={data.savingsRate.amount}
            currency={data.savingsRate.currency}
            subtitle={data.periodLabel.subtitle}
            sparkData={[]}
            showSign
            trend={
              data.savingsRate.amount !== 0
                ? {
                    value: Math.abs(data.savingsRate.percentage),
                    isPositive: data.savingsRate.amount > 0,
                  }
                : undefined
            }
          />
        </div>
        <div>
          <ProjectedBalanceKpiCard
            currency={data.balance.currency}
            accountIds={accountIds}
          />
        </div>
      </div>

      {/* Row 2: Charts */}
      <div className="grid min-w-0 gap-4 xl:grid-cols-5">
        <div
          data-walkthrough="walkthrough-profit-loss"
          className="min-w-0 xl:col-span-3"
        >
          <ProfitLossChart
            data={data.incomeExpense}
            currency={data.balance.currency}
          />
        </div>
        <div
          data-walkthrough="walkthrough-category"
          className="min-w-0 xl:col-span-2"
        >
          <SpendingByCategoryChart
            data={data.spendingByCategory.categories}
            total={data.spendingByCategory.total}
            currency={data.balance.currency}
            limit={4}
            periodTitle={data.periodLabel.title}
            accountIds={accountIds}
            dateFrom={dateFromParam}
            dateTo={dateToParam}
            horizon={effectiveHorizon}
          />
        </div>
      </div>

      {/* Row 2.5: Cash Flow Forecast */}
      <div className="grid gap-4">
        <ForecastChart
          currency={data.balance.currency}
          accountIds={accountIds}
        />
      </div>

      {/* Row 3: Cash Flow Sankey */}
      <div className="grid gap-4">
        <div data-walkthrough="walkthrough-cash-flow">
          <SankeyFlowChart
            data={data.sankeyData}
            currency={data.balance.currency}
            subtitle={data.periodLabel.subtitle}
            accountIds={accountIds}
            dateFrom={dateFromParam}
            dateTo={dateToParam}
            horizon={effectiveHorizon}
          />
        </div>
      </div>

      {/* Row 4: Assets Overview */}
      <div className="grid gap-4">
        <AssetsOverviewCard data={data.assetsOverview} />
      </div>

      {/* Row 5: Investments Summary */}
      <div className="grid gap-4">
        <PortfolioSummaryCard />
      </div>
    </div>
  );
}
