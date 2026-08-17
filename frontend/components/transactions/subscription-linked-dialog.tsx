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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { RiExternalLinkLine, RiLinkUnlinkM } from "@remixicon/react";
import Link from "next/link";
import { toast } from "sonner";
import type { TransactionWithRelations } from "@/features/transactions/public";
import { unlinkTransactionFromSubscription } from "@/features/subscriptions/client/transaction-linking";

interface SubscriptionLinkedDialogProps {
  transaction: TransactionWithRelations;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

const frequencyLabels: Record<string, string> = {
  monthly: "Monthly",
  weekly: "Weekly",
  yearly: "Yearly",
  quarterly: "Quarterly",
  biweekly: "Bi-weekly",
};

const frequencyColors: Record<string, string> = {
  monthly: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  weekly: "bg-green-500/10 text-green-700 dark:text-green-400",
  yearly: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
  quarterly: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  biweekly: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
};

export function SubscriptionLinkedDialog({
  transaction,
  open,
  onOpenChange,
  onSuccess,
}: SubscriptionLinkedDialogProps) {
  const [isUnlinking, setIsUnlinking] = useState(false);

  const subscription = transaction.recurringTransaction;

  if (!subscription) return null;

  const handleUnlink = async () => {
    setIsUnlinking(true);
    try {
      const result = await unlinkTransactionFromSubscription(transaction.id);

      if (result.success) {
        toast.success(translate("transactionUnlinkedFromSubscription"));
        onSuccess();
        onOpenChange(false);
      } else {
        toast.error(result.error || translate("failedToUnlinkTransaction"));
      }
    } catch (error) {
      toast.error(translate("failedToUnlinkTransaction"));
    } finally {
      setIsUnlinking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{translate("linkedSubscription")}</DialogTitle>
          <DialogDescription>
            {translate("thisTransactionIsLinkedToASubscription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Subscription Info */}
          <div className="bg-muted/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">{subscription.name}</h3>
              <Badge
                variant="secondary"
                className={frequencyColors[subscription.frequency]}
              >
                {frequencyLabels[subscription.frequency] ||
                  subscription.frequency}
              </Badge>
            </div>

            {subscription.merchant && (
              <div className="text-sm text-muted-foreground">
                {translate("merchant0bfafe")} {subscription.merchant}
              </div>
            )}
          </div>

          <Separator />

          {/* Actions */}
          <div className="space-y-2">
            <Link href="/subscriptions" className="block">
              <Button variant="outline" className="w-full justify-start">
                <RiExternalLinkLine className="h-4 w-4 mr-2" />
                {translate("viewAllSubscriptions")}
              </Button>
            </Link>

            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    variant="outline"
                    className="w-full justify-start text-destructive hover:text-destructive"
                    disabled={isUnlinking}
                  >
                    <RiLinkUnlinkM className="h-4 w-4 mr-2" />
                    {isUnlinking
                      ? translate("unlinking")
                      : translate("unlinkFromSubscription")}
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {translate("unlinkTransaction")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {translate(
                      "thisWillRemoveTheLinkBetweenThisTransactionAnd",
                    )}
                    {subscription.name}
                    {translate("theSubscriptionItselfWillNotBeDeleted")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{translate("cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleUnlink}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {translate("unlink")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {translate("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
