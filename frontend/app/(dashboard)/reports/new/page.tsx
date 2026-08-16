"use client";

import { useQuery } from "@tanstack/react-query";
import { listAccounts } from "@/lib/reports/api";
import { Header } from "@/components/layout/header";
import { ReportForm } from "@/components/reports/ReportForm";

export default function NewReportPage() {
  const {
    data: accounts,
    isLoading: accountsLoading,
    isError: accountsError,
  } = useQuery({ queryKey: ["accounts"], queryFn: listAccounts });

  return (
    <>
      <Header title="New report" />
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0 text-foreground">
        <ReportForm
          availableAccounts={accounts ?? []}
          accountsLoading={accountsLoading}
          accountsError={accountsError}
        />
      </div>
    </>
  );
}
