"use client";
import { t as translate } from "@/i18n/translate";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteReport, listReports } from "@/lib/reports/api";
import { Header } from "@/components/layout/header";
import { buttonVariants } from "@/components/ui/button";
import { ReportList } from "@/components/reports/ReportList";

export default function ReportsPage() {
  const queryClient = useQueryClient();
  const {
    data: reports,
    isLoading,
    isError,
    refetch,
  } = useQuery({ queryKey: ["reports"], queryFn: listReports });
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete(id: string) {
    if (!window.confirm(translate("deleteThisReportThisCannotBeUndone")))
      return;
    setDeleteError(null);
    try {
      await deleteReport(id);
      queryClient.invalidateQueries({ queryKey: ["reports"] });
    } catch (err) {
      setDeleteError(
        err instanceof Error
          ? err.message
          : translate("failedToDeleteReportPleaseTryAgain"),
      );
    }
  }

  return (
    <>
      <Header
        title={translate("reports")}
        action={
          <Link href="/reports/new" className={buttonVariants({ size: "sm" })}>
            {translate("newReport")}
          </Link>
        }
      />

      <div className="flex flex-1 flex-col gap-4 p-4 pt-0 text-foreground">
        {deleteError && (
          <p className="text-xs text-destructive">{deleteError}</p>
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">
            {translate("loading")}
          </p>
        ) : isError ? (
          <div className="text-sm text-muted-foreground">
            {translate("failedToLoadReports")}{" "}
            <button
              onClick={() => refetch()}
              className="text-foreground font-medium underline underline-offset-4"
            >
              {translate("retry")}
            </button>
          </div>
        ) : reports && reports.length > 0 ? (
          <ReportList reports={reports} onDelete={handleDelete} />
        ) : (
          <p className="text-sm text-muted-foreground">
            {translate("noReportsYetCreateOneToGetStarted")}
          </p>
        )}
      </div>
    </>
  );
}
