"use client";
import { t as translate } from "@/i18n/translate";

import { Suspense } from "react";
import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiSparklingLine,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { OnboardingProgress } from "@/components/onboarding/onboarding-progress";
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
  } = useMappingController("onboarding");

  if (isLoading) {
    return (
      <div className="space-y-8">
        <OnboardingProgress currentStep={4} />
        <Card className="min-h-[640px] h-[640px] flex flex-col">
          <CardContent className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
              <p className="text-muted-foreground">
                {translate("loadingCsvData")}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!csvData) {
    return null;
  }

  return (
    <div className="space-y-8">
      <OnboardingProgress currentStep={4} />
      <Card className="flex min-h-[640px] flex-col sm:h-[640px]">
        <CardHeader>
          <CardTitle>{translate("mapYourColumns")}</CardTitle>
          <CardDescription>
            {translate(
              "matchEachCsvColumnToTheCorrespondingTransactionField3bc30c",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col overflow-y-auto sm:overflow-hidden">
          {isAiMapping && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border bg-muted/50 px-4 py-3">
              <RiSparklingLine className="h-4 w-4 animate-pulse text-primary" />
              <span className="text-sm">
                {translate("analyzingYourCsvWithAi")}
              </span>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-card">
            <div className="grid min-h-0 sm:h-full lg:grid-cols-2 lg:divide-x">
              <div className="flex min-h-[320px] flex-col p-4 sm:min-h-0 sm:p-6">
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
                <div className="flex-1 min-h-0 overflow-y-auto pr-2">
                  <CsvMappingTable
                    headers={csvData.headers}
                    mapping={mapping}
                    onMappingChange={setMapping}
                  />
                </div>
              </div>

              <div className="flex min-h-[320px] flex-col border-t p-4 sm:min-h-0 sm:p-6 lg:border-t-0">
                <CsvSamplePreview
                  headers={csvData.headers}
                  sampleRows={csvData.sampleRows}
                  mapping={mapping}
                />
              </div>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
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
        </CardFooter>
      </Card>
    </div>
  );
}

export default function MappingPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-8">
          <OnboardingProgress currentStep={4} />
          <Card className="min-h-[640px] h-[640px] flex flex-col">
            <CardContent className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
                <p className="text-muted-foreground">
                  {translate("loadingb04ba4")}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      }
    >
      <MappingPageContent />
    </Suspense>
  );
}
