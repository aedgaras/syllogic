"use client";
import { t as translate } from "@/i18n/translate";

import { Suspense } from "react";
import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiSparklingLine,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/layout/header";
import { CsvMappingTable } from "@/components/transactions/csv-mapping-table";
import { CsvSamplePreview } from "@/components/transactions/csv-sample-preview";
import { useMappingController } from "@/features/csv-import/hooks/use-mapping-controller";

function MappingPageContent() {
  const {
    isLoading,
    isSaving,
    isAiMapping,
    csvData,
    mapping,
    setMapping,
    continueToPreview,
    goBack,
  } = useMappingController("dashboard");

  if (isLoading) {
    return (
      <>
        <Header title={translate("mapColumns")} />
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <div className="flex h-[calc(100vh-8rem)] items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
              <p className="text-muted-foreground">
                {translate("loadingCsvData")}
              </p>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (!csvData) {
    return null;
  }

  return (
    <>
      <Header title={translate("mapColumns")} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 pt-0 lg:h-[calc(100vh-4rem)] lg:overflow-hidden">
        {/* AI Mapping Status Banner */}
        {isAiMapping && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border bg-muted/50 px-4 py-3">
            <RiSparklingLine className="h-4 w-4 animate-pulse text-primary" />
            <span className="text-sm">
              {translate("analyzingYourCsvWithAi")}
            </span>
          </div>
        )}

        {/* Main Container with 2-Column Layout */}
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-card">
          <div className="grid min-h-0 lg:h-full lg:grid-cols-2 lg:divide-x">
            {/* Left Column - Field Mapping */}
            <div className="flex min-h-[360px] flex-col p-4 sm:p-6 lg:min-h-0">
              <div className="mb-4">
                <h2 className="text-lg font-semibold">
                  {translate("fieldMapping")}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {translate(
                    "matchEachCsvColumnToTheCorrespondingTransactionField",
                  )}
                </p>
              </div>
              <div className="flex-1 overflow-y-auto">
                <CsvMappingTable
                  headers={csvData.headers}
                  mapping={mapping}
                  onMappingChange={setMapping}
                />
              </div>
            </div>

            {/* Right Column - Dynamic Sample Preview */}
            <div className="flex min-h-[360px] flex-col border-t p-4 sm:p-6 lg:min-h-0 lg:border-t-0">
              <CsvSamplePreview
                headers={csvData.headers}
                sampleRows={csvData.sampleRows}
                mapping={mapping}
              />
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="mt-6 flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="outline" onClick={goBack}>
            <RiArrowLeftLine className="mr-2 h-4 w-4" />
            {translate("back")}
          </Button>
          <Button
            onClick={continueToPreview}
            disabled={isSaving || isAiMapping}
          >
            {isSaving ? translate("saving") : translate("previewTransactions")}
            <RiArrowRightLine className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    </>
  );
}

export default function MappingPage() {
  return (
    <Suspense
      fallback={
        <>
          <Header title={translate("mapColumns")} />
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
      <MappingPageContent />
    </Suspense>
  );
}
