"use client";
import { t as translate } from "@/i18n/translate";

import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  RiDeleteBinLine,
  RiLoader4Line,
  RiAlertLine,
  RiErrorWarningLine,
} from "@remixicon/react";
import { cn, formatAmount } from "@/lib/utils";
import type { DeleteImpact } from "@/features/transactions/public";
import { useDeleteTransactionsController } from "@/features/transactions/hooks/use-delete-transactions-controller";

const CONFIRMATION_PHRASE = "delete transactions";

interface DeleteConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transactionIds: string[];
  onSuccess: (deletedIds: string[]) => void;
}

export function DeleteConfirmationDialog({
  open,
  onOpenChange,
  transactionIds,
  onSuccess,
}: DeleteConfirmationDialogProps) {
  const controller = useDeleteTransactionsController();
  const [impact, setImpact] = useState<DeleteImpact | null>(null);
  const [loadingImpact, setLoadingImpact] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const [deleting, setDeleting] = useState(false);

  const isConfirmed = confirmInput.trim().toLowerCase() === CONFIRMATION_PHRASE;

  // Keep a fresh ref to onOpenChange so async callbacks don't capture a stale closure
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  });

  useEffect(() => {
    if (!open || !transactionIds.length) {
      setImpact(null);
      setConfirmInput("");
      return;
    }

    setLoadingImpact(true);
    controller
      .loadImpact(transactionIds)
      .then((result) => {
        if (result) setImpact(result);
        else onOpenChangeRef.current(false);
      })
      .finally(() => setLoadingImpact(false));
  }, [controller, open, transactionIds.join(",")]);

  async function handleDelete() {
    if (!isConfirmed || deleting) return;
    setDeleting(true);
    try {
      if (await controller.remove(transactionIds)) {
        onSuccess(transactionIds);
        onOpenChange(false);
      }
    } finally {
      setDeleting(false);
    }
  }

  const hasAnchoredAccount =
    impact?.accountImpacts.some((a) => a.balanceIsAnchored) ?? false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <RiDeleteBinLine className="size-4 shrink-0" />
            {translate("delete")}{" "}
            {transactionIds.length === 1
              ? translate("transaction")
              : translate("transactions22e992", {
                  value1: transactionIds.length,
                })}
          </DialogTitle>
          <DialogDescription>
            {translate("thisActionIsPermanentAndCannotBeUndone")}
          </DialogDescription>
        </DialogHeader>

        {/* Balance Impact */}
        <div className="space-y-3">
          {loadingImpact ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : impact ? (
            <>
              <p className="text-xs text-muted-foreground">
                {translate("balanceImpactAcross")}{" "}
                {impact.accountImpacts.length} {translate("account")}
                {impact.accountImpacts.length !== 1 ? "s" : ""}:
              </p>
              <div className="divide-y divide-border rounded-none border">
                {impact.accountImpacts.map((acc) => (
                  <div key={acc.accountId} className="px-3 py-2.5 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">
                        {acc.accountName}
                      </span>
                      <span
                        className={cn(
                          "text-xs font-mono",
                          acc.amountChange > 0
                            ? "text-emerald-600"
                            : "text-destructive",
                        )}
                      >
                        {acc.amountChange > 0 ? "+" : ""}
                        {formatAmount(acc.amountChange, acc.currency)}
                      </span>
                    </div>
                    {acc.balanceIsAnchored ? (
                      <div className="flex items-start gap-1.5 text-xs text-amber-600">
                        <RiAlertLine className="size-3.5 shrink-0 mt-0.5" />
                        <span>
                          {translate(
                            "anchoredBalanceDeletionWillCreateAReconciliationGapVerify",
                          )}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{translate("newBalance")}</span>
                        <span className="font-mono">
                          {formatAmount(acc.projectedBalance, acc.currency)}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {hasAnchoredAccount && (
                <div className="flex items-start gap-2 rounded-none border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
                  <RiErrorWarningLine className="size-4 shrink-0 mt-0.5" />
                  <span>
                    {translate(
                      "oneOrMoreAffectedAccountsHaveAnAnchoredBalance",
                    )}
                  </span>
                </div>
              )}
            </>
          ) : null}
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
              if (e.key === "Enter" && isConfirmed && !deleting) handleDelete();
            }}
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={deleting}
          >
            {translate("cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={!isConfirmed || deleting || loadingImpact}
            onClick={handleDelete}
          >
            {deleting ? (
              <>
                <RiLoader4Line className="size-4 animate-spin" />
                {translate("deletingc7ac55")}
              </>
            ) : (
              <>
                <RiDeleteBinLine className="size-4" />
                {translate("delete")}{" "}
                {transactionIds.length === 1
                  ? translate("transaction")
                  : translate("transactions22e992", {
                      value1: transactionIds.length,
                    })}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
