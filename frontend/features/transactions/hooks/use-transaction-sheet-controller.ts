"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { unlinkInternalTransfer } from "@/features/accounts/client/actions";
import {
  deleteBalancingTransaction,
  updateTransactionCategory,
  updateTransactionIncludeInAnalytics,
} from "@/lib/actions/transactions";

export function useTransactionSheetController() {
  const router = useRouter();

  return React.useMemo(
    () => ({
      refresh: () => router.refresh(),
      async unlinkTransfer(internalTransferId: string): Promise<boolean> {
        try {
          const result = await unlinkInternalTransfer(internalTransferId);
          if (!result.success) {
            toast.error(result.error || "Failed to unlink");
            return false;
          }
          toast.success("Transfer unlinked");
          router.refresh();
          return true;
        } catch {
          toast.error("Failed to unlink");
          return false;
        }
      },
      async revertBalancingTransfer(transactionId: string): Promise<boolean> {
        try {
          const result = await deleteBalancingTransaction(transactionId);
          if (!result.success) {
            toast.error(result.error || "Failed to revert balancing transfer");
            return false;
          }
          toast.success("Balancing transfer reverted successfully");
          router.refresh();
          return true;
        } catch {
          toast.error("Failed to revert balancing transfer");
          return false;
        }
      },
      async setAnalytics(transactionId: string, include: boolean): Promise<boolean> {
        try {
          const result = await updateTransactionIncludeInAnalytics(transactionId, include);
          if (!result.success) {
            toast.error(result.error || "Failed to update transaction");
            return false;
          }
          toast.success(
            include
              ? "Transaction included in analytics"
              : "Transaction excluded from analytics"
          );
          router.refresh();
          return true;
        } catch {
          toast.error("Failed to update transaction");
          return false;
        }
      },
      async setCategory(transactionId: string, categoryId: string | null): Promise<boolean> {
        try {
          const result = await updateTransactionCategory(transactionId, categoryId);
          if (!result.success) {
            toast.error(result.error || "Failed to update transaction");
            return false;
          }
          router.refresh();
          return true;
        } catch {
          toast.error("Failed to update transaction");
          return false;
        }
      },
    }),
    [router]
  );
}
