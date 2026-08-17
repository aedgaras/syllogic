"use client";
import { t as translate } from "@/i18n/translate";

import { useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import { RiArrowLeftLine, RiCheckLine, RiAlertLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OnboardingProgress } from "@/components/onboarding/onboarding-progress";
import { CsvPreviewTable } from "@/components/transactions/csv-preview-table";
import { cn } from "@/lib/utils";
import { usePreviewController } from "@/features/csv-import/hooks/use-preview-controller";

const SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: ["Cmd", "K"], label: translate("openCommandPalette") },
  { keys: ["B"], label: translate("goToDashboard") },
  { keys: ["T"], label: translate("goToTransactions") },
  { keys: ["A"], label: translate("goToAssets") },
  { keys: ["S"], label: translate("goToSettings") },
  { keys: ["N"], label: translate("newTransaction") },
  { keys: ["M"], label: translate("toggleTheme9b0eaf") },
];

function ShortcutKeys({ keys }: { keys: string[] }) {
  return (
    <div className="flex items-center gap-1">
      {keys.map((key) => (
        <kbd
          key={key}
          className="inline-flex h-6 items-center rounded border bg-muted px-2 text-[10px] font-mono text-muted-foreground"
        >
          {key}
        </kbd>
      ))}
    </div>
  );
}

function PreviewPageContent() {
  const router = useRouter();
  const {
    isLoading,
    isImporting,
    hasStartedImport,
    showSuccessModal,
    setShowSuccessModal,
    selectedIndices,
    setSelectedIndices,
    balanceVerification,
    toImport,
    skipped,
    enqueue,
    goBack,
  } = usePreviewController("onboarding");

  useEffect(() => {
    if (!showSuccessModal) return;

    let active = true;

    const fireConfetti = async () => {
      try {
        const mod = await import("canvas-confetti");
        const confetti = "default" in mod ? mod.default : mod;

        if (!active) return;

        confetti({
          particleCount: 90,
          spread: 70,
          origin: { y: 0.6 },
        });

        setTimeout(() => {
          if (!active) return;
          confetti({
            particleCount: 60,
            spread: 90,
            origin: { y: 0.4 },
          });
        }, 250);
      } catch {
        // Ignore confetti failures
      }
    };

    fireConfetti();

    return () => {
      active = false;
    };
  }, [showSuccessModal]);

  if (isLoading) {
    return (
      <div className="space-y-8">
        <OnboardingProgress currentStep={4} />
        <Card className="min-h-[640px] h-[640px] flex flex-col">
          <CardContent className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
              <p className="text-muted-foreground">
                {translate("loadingPreview")}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <OnboardingProgress currentStep={4} />
      <Card className="flex min-h-[640px] flex-col sm:h-[640px]">
        <CardHeader>
          <CardTitle>{translate("previewYourImport")}</CardTitle>
          <CardDescription>
            {translate("reviewWhatWillBeImportedBeforeWeAddTransactions")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 flex flex-col gap-4">
          {balanceVerification?.hasBalanceData && (
            <div
              className={cn(
                "rounded-lg border p-4",
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

          <Tabs
            defaultValue="to-import"
            className="flex min-h-0 flex-1 flex-col"
          >
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
        </CardContent>
        <CardFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="outline" onClick={goBack}>
            <RiArrowLeftLine className="mr-2 h-4 w-4" />
            {translate("backToMapping")}
          </Button>
          <Button
            onClick={enqueue}
            disabled={
              isImporting || selectedIndices.length === 0 || hasStartedImport
            }
          >
            {isImporting
              ? translate("importing")
              : translate("importTransactions", {
                  value1: selectedIndices.length,
                })}
            <RiCheckLine className="ml-2 h-4 w-4" />
          </Button>
        </CardFooter>
      </Card>

      <Dialog open={showSuccessModal} onOpenChange={setShowSuccessModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {translate("yourFirstAccountIsBeingCreated")}
            </DialogTitle>
            <DialogDescription>
              {translate("thisCanTakeAFewMinutesDependingOnThe")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">
                {translate("tipPressCmdKAnytimeToOpenTheCommand")}
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                {translate("shortcuts")}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {SHORTCUTS.map((shortcut) => (
                  <div
                    key={`${shortcut.label}-${shortcut.keys.join("-")}`}
                    className="flex flex-col gap-1 rounded border bg-background px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="text-muted-foreground">
                      {shortcut.label}
                    </span>
                    <ShortcutKeys keys={shortcut.keys} />
                  </div>
                ))}
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              {translate("pressMToToggleTheThemeAndTryIt")}
            </p>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={() => {
                setShowSuccessModal(false);
                router.push("/?tour=1");
              }}
            >
              {translate("getStarted")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function PreviewPage() {
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
      <PreviewPageContent />
    </Suspense>
  );
}
