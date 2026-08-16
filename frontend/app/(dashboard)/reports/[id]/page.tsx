"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getReport, listAccounts } from "@/lib/reports/api";
import { Header } from "@/components/layout/header";
import { ReportForm } from "@/components/reports/ReportForm";

export default function EditReportPage() {
  const params = useParams<{ id: string }>();
  const {
    data: report,
    isLoading: reportLoading,
    isError: reportError,
  } = useQuery({ queryKey: ["reports", params.id], queryFn: () => getReport(params.id) });
  const {
    data: accounts,
    isLoading: accountsLoading,
    isError: accountsError,
  } = useQuery({ queryKey: ["accounts"], queryFn: listAccounts });

  if (reportLoading) {
    return (
      <>
        <Header title="Edit report" />
        <div className="p-4 pt-0 text-sm text-muted-foreground">Loading…</div>
      </>
    );
  }

  if (reportError || !report) {
    return (
      <>
        <Header title="Edit report" />
        <div className="p-4 pt-0 text-sm text-muted-foreground">
          Report not found or failed to load.{" "}
          <Link href="/reports" className="text-foreground underline underline-offset-4">
            Back to reports
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Edit report" />
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0 text-foreground">
        <ReportForm
          report={report}
          availableAccounts={accounts ?? []}
          accountsLoading={accountsLoading}
          accountsError={accountsError}
        />
      </div>
    </>
  );
}
