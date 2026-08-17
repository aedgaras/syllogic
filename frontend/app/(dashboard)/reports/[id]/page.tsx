"use client";
import { t as translate } from "@/i18n/translate";


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
        <Header title={translate("editReport")} />
        <div className="p-4 pt-0 text-sm text-muted-foreground">{translate("loading")}</div>
      </>
    );
  }

  if (reportError || !report) {
    return (
      <>
        <Header title={translate("editReport")} />
        <div className="p-4 pt-0 text-sm text-muted-foreground">
          {translate("reportNotFoundOrFailedToLoad")}{" "}
          <Link href="/reports" className="text-foreground underline underline-offset-4">
            {translate("backToReports")}
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title={translate("editReport")} />
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
