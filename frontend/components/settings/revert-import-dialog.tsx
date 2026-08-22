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
import {
  RiDeleteBinLine,
  RiLoader4Line,
  RiAlertLine,
  RiErrorWarningLine,
} from "@remixicon/react";
import type { CsvImportWithStats } from "@/features/csv-import/public";

const CONFIRMATION_PHRASE = "delete transactions";

interface RevertImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  csvImport: CsvImportWithStats;
  onConfirm: () => void;
  isReverting: boolean;
}

export function RevertImportDialog({
  open,
  onOpenChange,
  csvImport,
  onConfirm,
  isReverting,
}: RevertImportDialogProps) {
  const [confirmInput, setConfirmInput] = useState("");

  const isConfirmed = confirmInput.trim().toLowerCase() === CONFIRMATION_PHRASE;

  function handleOpenChange(nextOpen: boolean) {
    if (!isReverting) {
      if (!nextOpen) setConfirmInput("");
      onOpenChange(nextOpen);
    }
  }

  function handleConfirmClick() {
    if (!isConfirmed || isReverting) return;
    onConfirm();
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
            {translate(
              "thisWillPermanentlyDeleteAllTransactionsFromThisImport",
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Import summary */}
        <div className="space-y-1 rounded-none border px-3 py-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{translate("file")}</span>
            <span className="font-mono font-medium truncate max-w-[200px]">
              {csvImport.fileName}
            </span>
          </div>
          {csvImport.account && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                {translate("account85dfa3")}
              </span>
              <span className="font-medium">{csvImport.account.name}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">
              {translate("transactionsToDelete")}
            </span>
            <span className="font-mono font-medium">
              {csvImport.transactionCount}
            </span>
          </div>
        </div>

        {/* Manually edited warning */}
        {csvImport.hasEditedTransactions && (
          <div className="flex items-start gap-2 rounded-none border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
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
            <span className="font-mono text-foreground">
              {translate("deleteTransactions")}
            </span>{" "}
            {translate("toConfirm12ef9b")}
          </p>
          <Input
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
            placeholder={translate("deleteTransactions")}
            className="font-mono text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter" && isConfirmed && !isReverting)
                handleConfirmClick();
            }}
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isReverting}
          >
            {translate("cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={!isConfirmed || isReverting}
            onClick={handleConfirmClick}
          >
            {isReverting ? (
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
