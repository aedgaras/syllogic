"use client";
import { t as translate } from "@/i18n/translate";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  RiLink,
  RiAddLine,
  RiCloseLine,
  RiLoader4Line,
  RiArrowDownSLine,
  RiArrowUpSLine,
} from "@remixicon/react";
import { format } from "date-fns";
import { cn, formatAmount } from "@/lib/utils";
import type { TransactionLinkGroup } from "@/features/transactions/public";
import { useLinkTransactionsController } from "@/features/transactions/hooks/use-link-transactions-controller";
import { logger } from "@/lib/logger";

interface LinkedTransactionsSectionProps {
  transactionId: string;
  currency: string;
  onLinkClick: () => void;
  onUpdate: () => void;
}

export function LinkedTransactionsSection({
  transactionId,
  currency,
  onLinkClick,
  onUpdate,
}: LinkedTransactionsSectionProps) {
  const controller = useLinkTransactionsController();
  const [isLoading, setIsLoading] = useState(true);
  const [linkGroup, setLinkGroup] = useState<TransactionLinkGroup | null>(null);
  const [isUnlinking, setIsUnlinking] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const loadLinkGroup = useCallback(async () => {
    setIsLoading(true);
    try {
      const group = await controller.loadGroup(transactionId);
      setLinkGroup(group);
    } catch (error) {
      logger.error("Failed to load link group", { error });
    } finally {
      setIsLoading(false);
    }
  }, [controller, transactionId]);

  useEffect(() => {
    void loadLinkGroup();
  }, [loadLinkGroup]);

  const handleUnlinkAll = async () => {
    if (!linkGroup) return;

    setIsUnlinking(true);
    try {
      if (await controller.unlinkGroup(linkGroup.groupId)) {
        setLinkGroup(null);
        onUpdate();
      }
    } finally {
      setIsUnlinking(false);
    }
  };

  const handleRemoveLinked = async (linkedTxnId: string) => {
    setIsUnlinking(true);
    try {
      const result = await controller.removeFromGroup(linkedTxnId);
      if (result.success) {
        if (result.groupDeleted) {
          setLinkGroup(null);
        } else {
          await loadLinkGroup();
        }
        onUpdate();
      }
    } finally {
      setIsUnlinking(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <RiLink className="h-4 w-4" />
          <span className="text-sm font-medium">
            {translate("linkedTransactionsc39891")}
          </span>
        </div>
        <div className="flex items-center justify-center py-4">
          <RiLoader4Line className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  // Not linked - show link button
  if (!linkGroup) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <RiLink className="h-4 w-4" />
          <span className="text-sm font-medium">
            {translate("linkedTransactionsc39891")}
          </span>
        </div>
        <Button variant="outline" className="w-full" onClick={onLinkClick}>
          <RiLink className="h-4 w-4 mr-2" />
          {translate("linkReimbursements")}
        </Button>
      </div>
    );
  }

  // Linked - show group details
  const allLinked = [
    ...(linkGroup.primary ? [linkGroup.primary] : []),
    ...linkGroup.linked,
  ];

  return (
    <div>
      {/* Collapsible Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between w-full p-3 bg-muted/50 hover:bg-muted/70 transition-colors"
      >
        <div className="flex items-center gap-2">
          <RiLink className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">
            {translate("linked")}
            {allLinked.length})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-sm font-mono font-medium",
              linkGroup.netAmount > 0 ? "text-emerald-600" : "text-foreground",
            )}
          >
            {formatAmount(linkGroup.netAmount, currency)}
          </span>
          {isExpanded ? (
            <RiArrowUpSLine className="h-4 w-4 text-muted-foreground" />
          ) : (
            <RiArrowDownSLine className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Collapsible Content */}
      {isExpanded && (
        <div className="border-x border-b bg-muted/30 p-3 space-y-3">
          {/* Transaction List */}
          <div className="space-y-2">
            {allLinked.map((txn) => (
              <div
                key={txn.id}
                className={cn(
                  "flex items-center gap-2 text-sm",
                  txn.id === transactionId && "font-medium",
                )}
              >
                {txn.linkRole === "primary" && (
                  <Badge variant="outline" className="text-xs shrink-0">
                    {translate("primary")}
                  </Badge>
                )}
                <span
                  className={cn(
                    "font-mono shrink-0",
                    txn.amount > 0 && "text-emerald-600",
                  )}
                >
                  {txn.amount > 0 ? "+" : ""}
                  {Math.abs(txn.amount).toFixed(2)}
                </span>
                <span className="truncate flex-1 text-muted-foreground">
                  {txn.merchant ||
                    txn.description ||
                    format(new Date(txn.bookedAt), "MMM d")}
                </span>
                {txn.id !== transactionId && txn.linkRole !== "primary" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveLinked(txn.id);
                    }}
                    disabled={isUnlinking}
                  >
                    <RiCloseLine className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              className="flex-1"
              onClick={(e) => {
                e.stopPropagation();
                onLinkClick();
              }}
              disabled={isUnlinking}
            >
              <RiAddLine className="h-4 w-4 mr-1" />
              {translate("addMore")}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger
                nativeButton={true}
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1 text-destructive hover:text-destructive"
                    disabled={isUnlinking}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {translate("unlinkAll")}
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {translate("unlinkAllTransactions")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {translate(
                      "thisWillRemoveAllLinksBetweenTheseTransactionsThey",
                    )}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{translate("cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleUnlinkAll}>
                    {translate("unlinkAll")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      )}
    </div>
  );
}
