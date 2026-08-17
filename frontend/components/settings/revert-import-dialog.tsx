"use client";
import { t as translate } from "@/i18n/translate";


import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { RiDeleteBinLine, RiLoader4Line, RiAlertLine, RiErrorWarningLine } from "@remixicon/react";
import { toast } from "sonner";
import { revertCsvImport } from "@/lib/actions/csv-import";
import type { CsvImportWithStats } from "@/features/csv-import/public";

const CONFIRMATION_PHRASE = "delete transactions";

interface RevertImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  csvImport: CsvImportWithStats;
  onSuccess: () => void;
}

export function RevertImportDialog({
  open,
  onOpenChange,
  csvImport,
  onSuccess,
}: RevertImportDialogProps) {
  const [confirmInput, setConfirmInput] = useState("");
  const [reverting, setReverting] = useState(false);

  const isConfirmed = confirmInput.trim().toLowerCase() === CONFIRMATION_PHRASE;

  function handleOpenChange(nextOpen: boolean) {
    if (!reverting) {
      if (!nextOpen) setConfirmInput("");
      onOpenChange(nextOpen);
    }
  }

  async function handleRevert() {
    if (!isConfirmed || reverting) return;
    setReverting(true);
    try {
      const result = await revertCsvImport(csvImport.id);
      if (result.success) {
        toast.success(
          translate("revertedTransactionDeleted", { value1: csvImport.fileName, value2: result.deletedCount, value3: result.deletedCount !== 1 ? "s" : "" })
        );
        onSuccess();
        onOpenChange(false);
      } else {
        toast.error(result.error ?? translate("failedToRevertImport"));
      }
    } finally {
      setReverting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <RiDeleteBinLine className="size-4 shrink-0" />
            {translate("revertImport")}
          </DialogTitle>
          <DialogDescription>
            {translate("thisWillPermanentlyDeleteAllTransactionsFromThisImport")}
          </DialogDescription>
        </DialogHeader>

        {/* Import summary */}
        <div className="space-y-1 rounded-none border px-3 py-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{translate("file")}</span>
            <span className="font-mono font-medium truncate max-w-[200px]">{csvImport.fileName}</span>
          </div>
          {csvImport.account && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{translate("account85dfa3")}</span>
              <span className="font-medium">{csvImport.account.name}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{translate("transactionsToDelete")}</span>
            <span className="font-mono font-medium">{csvImport.transactionCount}</span>
          </div>
        </div>

        {/* Manually edited warning */}
        {csvImport.hasEditedTransactions && (
          <div className="flex items-start gap-2 rounded-none border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
            <RiAlertLine className="size-4 shrink-0 mt-0.5" />
            <span>
              {translate("someTransactionsFromThisImportHaveBeenManuallyRe")}
            </span>
          </div>
        )}

        {/* Permanent action warning */}
        <div className="flex items-start gap-2 rounded-none border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <RiErrorWarningLine className="size-4 shrink-0 mt-0.5" />
          <span>
            {translate("allBalanceFiguresWillBeRecalculatedAfterDeletionThis")}
          </span>
        </div>

        <Separator />

        {/* Typed confirmation */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {translate("type")}{" "}
            <span className="font-mono text-foreground">{translate("deleteTransactions")}</span>{" "}
            {translate("toConfirm12ef9b")}
          </p>
          <Input
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
            placeholder={translate("deleteTransactions")}
            className="font-mono text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter" && isConfirmed && !reverting) handleRevert();
            }}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={reverting}>
            {translate("cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={!isConfirmed || reverting}
            onClick={handleRevert}
          >
            {reverting ? (
              <>
                <RiLoader4Line className="size-4 animate-spin" />
                {translate("reverting")}
              </>
            ) : (
              <>
                <RiDeleteBinLine className="size-4" />
                {translate("revertImport")}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
