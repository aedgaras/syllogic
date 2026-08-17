"use client";
import { t as translate } from "@/i18n/translate";

import { Suspense } from "react";
import { RiArrowLeftLine, RiCheckLine, RiAlertLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Header } from "@/components/layout/header";
import { CsvPreviewTable } from "@/components/transactions/csv-preview-table";
import { cn } from "@/lib/utils";
import { usePreviewController } from "@/features/csv-import/hooks/use-preview-controller";

function PreviewPageContent() {
  const {
    isLoading,
    isImporting,
    selectedIndices,
    setSelectedIndices,
    balanceVerification,
    toImport,
    skipped,
    enqueue,
    goBack,
  } = usePreviewController("dashboard");

  if (isLoading) {
    return (
      <>
        <Header title={translate("previewImport")} />
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <div className="flex h-[calc(100vh-8rem)] items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
              <p className="text-muted-foreground">
                {translate("loadingPreview")}
              </p>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title={translate("previewImport")} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 pt-0 lg:h-[calc(100vh-4rem)] lg:overflow-hidden">
        {/* Balance Verification Card */}
        {balanceVerification?.hasBalanceData && (
          <div
            className={cn(
              "mb-4 rounded-lg border p-4",
              !balanceVerification.canVerify
                ? "border-muted bg-muted/30"
                : balanceVerification.isVerified
                  ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950"
                  : "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950",
            )}
          >
            <div className="flex items-center gap-2 mb-3">
              {!balanceVerification.canVerify ? (
                <RiAlertLine className="h-5 w-5 text-muted-foreground" />
              ) : balanceVerification.isVerified ? (
                <RiCheckLine className="h-5 w-5 text-green-600 dark:text-green-400" />
              ) : (
                <RiAlertLine className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              )}
              <span className="font-medium">
                {!balanceVerification.canVerify
                  ? translate("balanceInfoPartial")
                  : balanceVerification.isVerified
                    ? translate("balanceVerified")
                    : translate("balanceDiscrepancyDetected")}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              {balanceVerification.fileStartingBalance !== null && (
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">
                    {translate("startingBalancebc3b92")}
                  </span>
                  <span className="font-mono">
                    {balanceVerification.fileStartingBalance.toFixed(2)}
                  </span>
                </div>
              )}
              {balanceVerification.fileEndingBalance !== null && (
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">
                    {translate("endingBalanceFile")}
                  </span>
                  <span className="font-mono">
                    {balanceVerification.fileEndingBalance.toFixed(2)}
                  </span>
                </div>
              )}
              {balanceVerification.calculatedEndingBalance !== null && (
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">
                    {translate("calculatedEnding")}
                  </span>
                  <span className="font-mono">
                    {balanceVerification.calculatedEndingBalance.toFixed(2)}
                  </span>
                </div>
              )}
              {balanceVerification.canVerify &&
                !balanceVerification.isVerified &&
                balanceVerification.discrepancy !== null && (
                  <div className="flex justify-between gap-3 text-amber-600 dark:text-amber-400">
                    <span>{translate("discrepancy")}</span>
                    <span className="font-mono font-medium">
                      {balanceVerification.discrepancy.toFixed(2)}
                    </span>
                  </div>
                )}
            </div>
            {!balanceVerification.canVerify && (
              <p className="mt-2 text-xs text-muted-foreground">
                {translate("mapBothStartingAndEndingBalanceColumnsForFull")}
              </p>
            )}
            {balanceVerification.hasBalanceData && (
              <p className="mt-2 text-xs text-muted-foreground">
                {translate("dailyBalancesFromTheCsvWillBeUsedTo")}
              </p>
            )}
          </div>
        )}

        <Tabs defaultValue="to-import" className="flex min-h-0 flex-1 flex-col">
          {/* Tabs outside container */}
          <TabsList className="mb-2 w-full sm:w-fit">
            <TabsTrigger value="to-import" className="gap-2">
              {translate("toImport")}
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium">
                {toImport.length}
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="skipped"
              className="gap-2"
              disabled={skipped.length === 0}
            >
              {translate("skipped")}
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                {skipped.length}
              </span>
            </TabsTrigger>
          </TabsList>

          {/* Container with scrollable table */}
          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-card">
            <TabsContent value="to-import" className="h-full m-0">
              <div className="h-full overflow-y-auto">
                <CsvPreviewTable
                  transactions={toImport}
                  selectedIndices={selectedIndices}
                  onSelectionChange={setSelectedIndices}
                  showCheckboxes={false}
                />
              </div>
            </TabsContent>

            <TabsContent value="skipped" className="h-full m-0">
              <div className="h-full overflow-y-auto">
                <CsvPreviewTable
                  transactions={skipped}
                  selectedIndices={[]}
                  onSelectionChange={() => {}}
                  showCheckboxes={false}
                />
              </div>
            </TabsContent>
          </div>
        </Tabs>

        {/* Footer Actions - always visible */}
        <div className="mt-4 flex shrink-0 flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="outline" onClick={goBack}>
            <RiArrowLeftLine className="mr-2 h-4 w-4" />
            {translate("backToMapping")}
          </Button>
          <Button
            onClick={enqueue}
            disabled={isImporting || selectedIndices.length === 0}
          >
            {isImporting
              ? translate("importing")
              : translate("importTransactions", {
                  value1: selectedIndices.length,
                })}
            <RiCheckLine className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    </>
  );
}

export default function PreviewPage() {
  return (
    <Suspense
      fallback={
        <>
          <Header title={translate("previewImport")} />
          <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
            <div className="flex h-[calc(100vh-8rem)] items-center justify-center">
              <div className="text-center">
                <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
                <p className="text-muted-foreground">
                  {translate("loadingb04ba4")}
                </p>
              </div>
            </div>
          </div>
        </>
      }
    >
      <PreviewPageContent />
    </Suspense>
  );
}
