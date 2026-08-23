"use client";
import { t as translate } from "@/i18n/translate";

import { useState, useEffect, useRef } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { CategorySelect } from "@/components/categories/category-select";
import { Separator } from "@/components/ui/separator";
import { cn, formatDate, formatAmount } from "@/lib/utils";
import type { TransactionWithRelations } from "@/features/transactions/public";
import { Switch } from "@/components/ui/switch";
import type { CategoryDisplay } from "@/shared/domain/display-contracts";
import { filterSelectableCategories } from "@/lib/utils/category-utils";
import {
  RiDeleteBinLine,
  RiEditLine,
  RiExchangeLine,
  RiLoopRightLine,
} from "@remixicon/react";
import { useTransactionSheetController } from "@/features/transactions/hooks/use-transaction-sheet-controller";
import { SubscriptionDetectionDialog } from "./subscription-detection-dialog";
import { SubscriptionLinkedDialog } from "./subscription-linked-dialog";
import { LinkReimbursementsDialog } from "./link-reimbursements-dialog";
import { LinkedTransactionsSection } from "./linked-transactions-section";
import { DeleteConfirmationDialog } from "./delete-confirmation-dialog";
import { AddTransactionDialog } from "./add-transaction-dialog";

interface TransactionSheetProps {
  transaction: TransactionWithRelations | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdateTransaction?: (
    id: string,
    updates: Partial<TransactionWithRelations>,
  ) => void;
  onDeleteTransaction?: (id: string) => void;
  categories?: CategoryDisplay[];
  canDelete?: boolean;
  canEdit?: boolean;
}

export function TransactionSheet({
  transaction,
  open,
  onOpenChange,
  onUpdateTransaction,
  onDeleteTransaction,
  categories = [],
  canDelete = true,
  canEdit = true,
}: TransactionSheetProps) {
  const controller = useTransactionSheetController();
  // Filter out categories hidden from manual selection (e.g., Balancing Transfer)
  const selectableCategories = filterSelectableCategories(categories);

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    null,
  );
  const [includeInAnalytics, setIncludeInAnalytics] = useState<boolean>(true);
  const [instructions, setInstructions] = useState<string>("");
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isReverting, setIsReverting] = useState(false);
  const [isTogglingAnalytics, setIsTogglingAnalytics] = useState(false);
  const [showSubscriptionDialog, setShowSubscriptionDialog] = useState(false);
  const [showLinkedSubscriptionDialog, setShowLinkedSubscriptionDialog] =
    useState(false);
  const [showLinkReimbursementsDialog, setShowLinkReimbursementsDialog] =
    useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [isUnlinkingTransfer, setIsUnlinkingTransfer] = useState(false);

  const isBalancingTransfer =
    transaction?.category?.name === "Balancing Transfer";
  const isExpense = transaction?.transactionType === "debit";
  const hasLinkedSubscription = !!transaction?.recurringTransactionId;
  const pocketAccountName =
    transaction?.internalTransfer?.pocketAccount?.name ?? null;
  const internalTransferId = transaction?.internalTransferId ?? null;

  // Track previous transaction ID to only reset state when a different transaction is opened
  const prevTransactionIdRef = useRef<string | null>(null);

  const handleUnlinkInternalTransfer = async () => {
    if (!internalTransferId) return;

    setIsUnlinkingTransfer(true);
    try {
      await controller.unlinkTransfer(internalTransferId);
    } finally {
      setIsUnlinkingTransfer(false);
    }
  };

  const handleRevertBalancingTransfer = async () => {
    if (!transaction) return;

    setIsReverting(true);
    try {
      if (await controller.revertBalancingTransfer(transaction.id)) {
        onDeleteTransaction?.(transaction.id);
        onOpenChange(false);
      }
    } finally {
      setIsReverting(false);
    }
  };

  // Reset state only when a different transaction is opened (not when same transaction updates)
  useEffect(() => {
    if (transaction && transaction.id !== prevTransactionIdRef.current) {
      prevTransactionIdRef.current = transaction.id;
      setSelectedCategoryId(transaction.categoryId);
      setIncludeInAnalytics(transaction.includeInAnalytics ?? true);
      setInstructions("");
      setHasChanges(false);
    }
  }, [transaction]);

  // Reset ref when sheet closes so reopening same transaction reinitializes properly
  useEffect(() => {
    if (!open) {
      prevTransactionIdRef.current = null;
    }
  }, [open]);

  const handleCategoryChange = (value: string) => {
    const newCategoryId = value || null;
    setSelectedCategoryId(newCategoryId);
    setHasChanges(newCategoryId !== transaction?.categoryId);
  };

  const handleInstructionsChange = (value: string) => {
    setInstructions(value);
  };

  const handleIncludeInAnalyticsChange = async (checked: boolean) => {
    if (!transaction) return;

    setIsTogglingAnalytics(true);
    try {
      if (await controller.setAnalytics(transaction.id, checked)) {
        setIncludeInAnalytics(checked);
        onUpdateTransaction?.(transaction.id, {
          includeInAnalytics: checked,
        });
      }
    } finally {
      setIsTogglingAnalytics(false);
    }
  };

  const handleSave = async () => {
    if (!transaction || !hasChanges) return;

    setIsSaving(true);
    try {
      if (await controller.setCategory(transaction.id, selectedCategoryId)) {
        const newCategory = selectedCategoryId
          ? categories.find((cat) => cat.id === selectedCategoryId) || null
          : null;

        onUpdateTransaction?.(transaction.id, {
          categoryId: selectedCategoryId,
          category: newCategory,
        });

        setHasChanges(false);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubscriptionSuccess = () => {
    // Refresh the transaction to show updated subscription link
    onOpenChange(false);
    controller.refresh();
  };

  const handleSubscriptionButtonClick = () => {
    if (hasLinkedSubscription) {
      setShowLinkedSubscriptionDialog(true);
    } else {
      setShowSubscriptionDialog(true);
    }
  };

  if (!transaction) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="sm:max-w-md flex flex-col h-full overflow-hidden px-2.5"
      >
        {/* Fixed Header */}
        <SheetHeader className="space-y-1 p-0 pt-4 shrink-0">
          <SheetDescription className="text-muted-foreground">
            {formatDate(transaction.bookedAt)}
          </SheetDescription>
          <SheetTitle className="text-lg font-medium break-all">
            {transaction.description ||
              transaction.category?.name ||
              translate("uncategorized")}
          </SheetTitle>
          <div
            className={cn(
              "text-3xl font-semibold tracking-tight pt-2",
              transaction.amount > 0 && "text-[#22C55E]",
            )}
          >
            {formatAmount(transaction.amount, transaction.currency || "EUR")}
          </div>
        </SheetHeader>

        <Separator className="my-4 shrink-0" />

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 space-y-6 pr-1">
          {/* Internal Transfer Chip */}
          {internalTransferId && pocketAccountName && (
            <div className="flex items-center gap-2 rounded border bg-muted/40 p-2 text-xs">
              <RiExchangeLine className="h-4 w-4 shrink-0" />
              <span className="flex-1 truncate">
                {translate("internalTransfer")} {pocketAccountName}
              </span>
              <button
                type="button"
                className="text-muted-foreground underline hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleUnlinkInternalTransfer}
                disabled={isUnlinkingTransfer}
              >
                {isUnlinkingTransfer
                  ? translate("unlinking")
                  : translate("unlink")}
              </button>
            </div>
          )}

          {/* Category Section */}
          <div className="space-y-3">
            <Label htmlFor="category">{translate("category")}</Label>
            <CategorySelect
              id="category"
              className="w-full"
              categories={selectableCategories}
              value={selectedCategoryId || ""}
              onChange={handleCategoryChange}
              noneLabel={translate("uncategorized")}
              placeholder={translate("selectCategory")}
              swatchShape="square"
            />
            {/* Show AI-assigned category if different from user selection */}
            {transaction.categorySystemId &&
              transaction.categorySystemId !== selectedCategoryId && (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <span>{translate("aiSuggested")}</span>
                  <span className="inline-flex items-center gap-1">
                    <span
                      className="h-2 w-2 shrink-0 inline-block"
                      style={{
                        backgroundColor:
                          transaction.categorySystem?.color || "#A1A1AA",
                      }}
                    />
                    {transaction.categorySystem?.name || translate("unknown")}
                  </span>
                </p>
              )}
          </div>

          {/* Linked Transactions Section */}
          {!isBalancingTransfer && (
            <LinkedTransactionsSection
              transactionId={transaction.id}
              currency={transaction.currency || "EUR"}
              onLinkClick={() => setShowLinkReimbursementsDialog(true)}
              onUpdate={handleSubscriptionSuccess}
            />
          )}

          {/* Categorization Instructions */}
          <div className="space-y-3">
            <Label htmlFor="instructions">
              {translate("categorizationInstructions")}
            </Label>
            <Textarea
              id="instructions"
              placeholder={translate(
                "addInstructionsForHowThisMerchantOrSimilarTransactions",
              )}
              value={instructions}
              onChange={(e) => handleInstructionsChange(e.target.value)}
              className="min-h-[100px] resize-none"
            />
          </div>

          {/* Include in Analytics Toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="include-analytics">
                {translate("includeInAnalytics")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {translate("whenDisabledThisTransactionWonTAppearInCharts")}
              </p>
            </div>
            <Switch
              id="include-analytics"
              checked={includeInAnalytics}
              onCheckedChange={handleIncludeInAnalyticsChange}
              disabled={isTogglingAnalytics}
            />
          </div>

          <Separator />

          {/* Transaction Details */}
          <div className="space-y-4 pb-2">
            <h3 className="text-sm font-medium">{translate("details")}</h3>

            <div className="grid gap-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {translate("merchant")}
                </span>
                <span>{transaction.merchant || "-"}</span>
              </div>
              {transaction.creditor && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {translate("creditor")}
                  </span>
                  <span className="text-right max-w-[60%] break-words">
                    {transaction.creditor}
                  </span>
                </div>
              )}
              {transaction.debtor && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {translate("debtor")}
                  </span>
                  <span className="text-right max-w-[60%] break-words">
                    {transaction.debtor}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {translate("account85dfa3")}
                </span>
                <span>{transaction.account?.name || translate("unknown")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {translate("institution")}
                </span>
                <span>{transaction.account?.institution || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {translate("status")}
                </span>
                <span>
                  {transaction.pending
                    ? translate("pending")
                    : translate("completed")}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Fixed Footer with Save Button, Subscription Button and Revert Option */}
        <div className="pt-4 pb-4 border-t space-y-3 shrink-0 mt-auto">
          {canEdit && !isBalancingTransfer && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setShowEditDialog(true)}
            >
              <RiEditLine className="h-4 w-4 mr-2" />
              {internalTransferId
                ? translate("viewTransferDetails")
                : translate("editTransaction")}
            </Button>
          )}

          {/* Subscription button - only show for expenses and not balancing transfers */}
          {isExpense && !isBalancingTransfer && (
            <Button
              variant="outline"
              className="w-full"
              onClick={handleSubscriptionButtonClick}
            >
              <RiLoopRightLine className="h-4 w-4 mr-2" />
              {hasLinkedSubscription
                ? translate("linked63de9d", {
                    value1: transaction.recurringTransaction?.name,
                  })
                : translate("markAsSubscription")}
            </Button>
          )}

          <Button
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            className="w-full"
          >
            {isSaving ? translate("saving") : translate("saveChangesfa2984")}
          </Button>

          {/* Delete button for regular transactions */}
          {canDelete && !isBalancingTransfer && (
            <Button
              variant="outline"
              className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => setShowDeleteDialog(true)}
            >
              <RiDeleteBinLine className="h-4 w-4 mr-2" />
              {translate("deleteTransaction")}
            </Button>
          )}

          {/* Revert button for balancing transfers */}
          {isBalancingTransfer && (
            <AlertDialog>
              <AlertDialogTrigger
                disabled={isReverting}
                render={
                  <Button
                    variant="destructive"
                    className="w-full"
                    disabled={isReverting}
                  >
                    <RiDeleteBinLine className="h-4 w-4 mr-2" />
                    {isReverting
                      ? translate("revertingd78047")
                      : translate("revertBalancingTransfer")}
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {translate("revertBalancingTransfer49544b")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {translate(
                      "thisWillDeleteTheBalancingTransferAndRecalculateThe",
                    )}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{translate("cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleRevertBalancingTransfer}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {translate("revert")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </SheetContent>

      {/* Subscription Detection Dialog */}
      <SubscriptionDetectionDialog
        transaction={transaction}
        open={showSubscriptionDialog}
        onOpenChange={setShowSubscriptionDialog}
        onSuccess={handleSubscriptionSuccess}
        categories={categories}
      />

      {/* Linked Subscription Dialog */}
      <SubscriptionLinkedDialog
        transaction={transaction}
        open={showLinkedSubscriptionDialog}
        onOpenChange={setShowLinkedSubscriptionDialog}
        onSuccess={handleSubscriptionSuccess}
      />

      {/* Link Reimbursements Dialog */}
      <LinkReimbursementsDialog
        transaction={transaction}
        open={showLinkReimbursementsDialog}
        onOpenChange={setShowLinkReimbursementsDialog}
        onSuccess={handleSubscriptionSuccess}
      />

      {/* Delete Transaction Dialog */}
      <DeleteConfirmationDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        transactionIds={transaction ? [transaction.id] : []}
        onSuccess={() => {
          if (transaction) onDeleteTransaction?.(transaction.id);
          onOpenChange(false);
        }}
      />

      <AddTransactionDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        categories={categories}
        transaction={transaction}
        onTransactionUpdated={onUpdateTransaction}
      />
    </Sheet>
  );
}
