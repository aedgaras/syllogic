"use client";
import { t as translate } from "@/i18n/translate";


import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  RiEditLine,
  RiLink,
  RiLoader4Line,
  RiRepeatLine,
} from "@remixicon/react";
import { format } from "date-fns";
import type { SubscriptionViewModel } from "@/features/subscriptions/public";
import { useSubscriptionDetailController } from "@/features/subscriptions/hooks/use-subscription-detail-controller";

interface SubscriptionDetailSheetProps {
  subscription: SubscriptionViewModel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (subscription: SubscriptionViewModel) => void;
  onRefresh: () => void;
}

const frequencyColors: Record<string, string> = {
  monthly: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  weekly: "bg-green-500/10 text-green-700 dark:text-green-400",
  yearly: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
  quarterly: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  biweekly: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
};

const frequencyLabels: Record<string, string> = {
  monthly: "Monthly",
  weekly: "Weekly",
  yearly: "Yearly",
  quarterly: "Quarterly",
  biweekly: "Bi-weekly",
};

export function SubscriptionDetailSheet({
  subscription,
  open,
  onOpenChange,
  onEdit,
  onRefresh,
}: SubscriptionDetailSheetProps) {
  const { costAggregations, isLoading, isMatching, linkedTransactions, matchTransactions } =
    useSubscriptionDetailController(subscription, open, onRefresh);

  const handleEdit = () => {
    if (subscription) {
      onEdit(subscription);
    }
  };

  if (!subscription) return null;

  const currency = subscription.currency || "EUR";

  // Cap importance at 3 for display
  const importance = Math.min(subscription.importance, 3);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg flex flex-col px-6">
        <SheetHeader className="space-y-3 px-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="secondary"
              className={frequencyColors[subscription.frequency]}
            >
              <RiRepeatLine className="mr-1 h-3 w-3" />
              {frequencyLabels[subscription.frequency] || subscription.frequency}
            </Badge>
            {subscription.category && (
              <Badge
                variant="secondary"
                className="text-white"
                style={{ backgroundColor: subscription.category.color ?? "#6B7280" }}
              >
                {subscription.category.name}
              </Badge>
            )}
            {subscription.account && (
              <Badge variant="outline">{subscription.account.name}</Badge>
            )}
          </div>
          <SheetTitle className="text-xl">{subscription.name}</SheetTitle>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SheetDescription className="text-base font-mono">
              {parseFloat(subscription.amount).toFixed(2)} {currency}
            </SheetDescription>
            {/* Importance blocks */}
            <div
              className="flex items-center gap-1 cursor-default"
              title={importance === 3 ? translate("highImportance") : importance === 2 ? translate("mediumImportance") : translate("lowImportance")}
            >
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className={`h-3 w-5 border ${
                    i < importance
                      ? "bg-foreground border-foreground"
                      : "bg-background border-border"
                  }`}
                />
              ))}
            </div>
          </div>
        </SheetHeader>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <RiLoader4Line className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex-1 flex flex-col gap-6 mt-6 min-h-0 overflow-hidden">
            {/* Cost Aggregations */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="bg-muted/50 p-4 space-y-1">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">
                  {translate("thisYear")}
                </div>
                <div className="text-xl font-mono font-medium">
                  {costAggregations.thisYear.toFixed(2)} {currency}
                </div>
              </div>
              <div className="bg-muted/50 p-4 space-y-1">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">
                  {translate("allTime4745c5")}
                </div>
                <div className="text-xl font-mono font-medium">
                  {costAggregations.allTime.toFixed(2)} {currency}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                className="flex-1"
                onClick={matchTransactions}
                disabled={isMatching}
              >
                <RiLink className="mr-2 h-4 w-4" />
                {isMatching ? translate("matching11cb2a") : translate("matchTransactions")}
              </Button>
              <Button variant="outline" onClick={handleEdit}>
                <RiEditLine className="mr-2 h-4 w-4" />
                {translate("edit")}
              </Button>
            </div>

            <Separator />

            {/* Linked Transactions */}
            <div className="flex-1 flex flex-col min-h-0">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-sm font-medium">
                  {translate("linkedTransactions")}{linkedTransactions.length})
                </h3>
              </div>

              {linkedTransactions.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                  {translate("noTransactionsLinkedYet")}
                </div>
              ) : (
                <ScrollArea className="flex-1 min-h-0">
                  <div className="space-y-1">
                    {linkedTransactions.map((txn) => (
                      <div
                        key={txn.id}
                        className="flex flex-col gap-1 py-2 hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm truncate">
                            {txn.merchant || txn.description || translate("transaction")}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {format(new Date(txn.bookedAt), "MMM d, yyyy")}
                          </div>
                        </div>
                        <div className="shrink-0 text-sm font-mono sm:ml-4">
                          {Math.abs(parseFloat(txn.amount)).toFixed(2)} {currency}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
