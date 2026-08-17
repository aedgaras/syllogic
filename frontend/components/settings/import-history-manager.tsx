"use client";
import { t as translate } from "@/i18n/translate";


import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  RiUploadLine,
  RiAlertLine,
  RiDeleteBinLine,
  RiInboxLine,
} from "@remixicon/react";
import { formatDate } from "@/lib/utils";
import { RevertImportDialog } from "./revert-import-dialog";
import type { CsvImportWithStats } from "@/features/csv-import/public";

function statusBadgeVariant(status: string | null): "default" | "outline" | "secondary" {
  switch (status) {
    case "completed":
      return "default";
    case "failed":
      return "outline";
    default:
      return "secondary";
  }
}

interface ImportHistoryManagerProps {
  initialImports: CsvImportWithStats[];
  canDelete?: boolean;
}

export function ImportHistoryManager({ initialImports, canDelete = true }: ImportHistoryManagerProps) {
  const router = useRouter();
  const [selectedImport, setSelectedImport] = useState<CsvImportWithStats | null>(null);

  function handleRevertSuccess() {
    setSelectedImport(null);
    router.refresh();
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <RiUploadLine className="size-4" />
            {translate("importHistory")}
          </CardTitle>
          <CardDescription>
            {translate("allCsvFileImportsForYourAccountsRevertAn")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {initialImports.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
              <RiInboxLine className="size-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">{translate("noImportsYet")}</p>
              <p className="text-xs text-muted-foreground">
                {translate("csvImportsWillAppearHereOnceYouUploadA")}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {initialImports.map((imp) => {
                const hasTransactions = imp.transactionCount > 0;
                const canRevert = hasTransactions && canDelete;

                return (
                  <div
                    key={imp.id}
                    className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  >
                    {/* Left: file info */}
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="truncate text-xs font-medium font-mono">
                          {imp.fileName}
                        </span>
                        {imp.hasEditedTransactions && (
                          <Tooltip>
                            <TooltipTrigger>
                              <RiAlertLine className="size-3.5 shrink-0 text-amber-500" />
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              <p>{translate("someTransactionsWereManuallyReCategorized")}</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {imp.account && <span>{imp.account.name}</span>}
                        {imp.account && imp.createdAt && <span>·</span>}
                        {imp.createdAt && (
                          <span>{formatDate(imp.createdAt)}</span>
                        )}
                        {imp.transactionCount > 0 && (
                          <>
                            <span>·</span>
                            <span className="font-mono">{imp.transactionCount} {translate("transaction41c48b")}{imp.transactionCount !== 1 ? "s" : ""}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Right: status + action */}
                    <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto">
                      <Badge variant={statusBadgeVariant(imp.status)} className="text-xs capitalize">
                        {imp.status ?? translate("unknown50d8b4")}
                      </Badge>

                      {canRevert ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setSelectedImport(imp)}
                        >
                          <RiDeleteBinLine className="size-3.5 mr-1" />
                          {translate("revert")}
                        </Button>
                      ) : (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <span
                                aria-disabled="true"
                                className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-none border border-input bg-transparent px-3 py-1 text-xs font-medium opacity-50"
                              />
                            }
                          >
                            {translate("revert")}
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            <p>
                              {!canDelete
                                ? translate("revertingImportsIsDisabledForTheDemoAccount")
                                : imp.transactionCount === 0
                                ? translate("noLinkedTransactionsThisImportMayPredateTransactionTracking")
                                : translate("cannotRevert")}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedImport && (
        <RevertImportDialog
          open={selectedImport !== null}
          onOpenChange={(open) => {
            if (!open) setSelectedImport(null);
          }}
          csvImport={selectedImport}
          onSuccess={handleRevertSuccess}
        />
      )}
    </>
  );
}
