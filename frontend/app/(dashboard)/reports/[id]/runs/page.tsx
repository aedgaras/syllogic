"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getReport, listReportRuns } from "@/lib/reports/api";
import { Header } from "@/components/layout/header";
import { ReportRunsTable } from "@/components/reports/ReportRunsTable";

export default function ReportRunsPage() {
  const params = useParams<{ id: string }>();
  const { data: report } = useQuery({ queryKey: ["reports", params.id], queryFn: () => getReport(params.id) });
  const {
    data: runs,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["reports", params.id, "runs"],
    queryFn: () => listReportRuns(params.id),
    refetchInterval: 10_000,
  });

  return (
    <>
      <Header title={report ? `${report.name} - Runs` : "Runs"} />
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0 text-foreground">
        <p className="text-sm text-muted-foreground">Scheduled and executed sends for this report.</p>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : isError && !(runs && runs.length > 0) ? (
          // Only show the error state when there's no cached data to fall
          // back on — with refetchInterval polling, a single transient
          // background refetch failure would otherwise hide a previously
          // loaded, still-valid run history behind an error message.
          <p className="text-sm text-destructive">Failed to load runs. Please try again.</p>
        ) : runs && runs.length > 0 ? (
          <ReportRunsTable runs={runs} />
        ) : (
          <p className="text-sm text-muted-foreground">No runs yet.</p>
        )}
      </div>
    </>
  );
}
