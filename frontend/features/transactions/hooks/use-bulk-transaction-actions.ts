"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  bulkUpdateTransactionCategory,
  bulkUpdateTransactionIncludeInAnalytics,
} from "@/lib/actions/transactions";
import { createLinkGroupFromSelection } from "@/lib/actions/transaction-links";
import { exportTransactionsToCSV } from "@/lib/utils/csv-export";
import type { TransactionWithRelations } from "../public";

export interface BulkTransactionActions {
  categorize(ids: string[], categoryId: string | null): Promise<boolean>;
  setAnalytics(ids: string[], includeInAnalytics: boolean): Promise<boolean>;
  link(ids: string[]): Promise<boolean>;
  exportCsv(transactions: TransactionWithRelations[]): boolean;
}

export function useBulkTransactionActions(): BulkTransactionActions {
  const router = useRouter();
  return React.useMemo(
    () => ({
      async categorize(ids, categoryId) {
        try {
          const result = await bulkUpdateTransactionCategory(ids, categoryId);
          if (!result.success) {
            toast.error(result.error || "Failed to update transactions");
            return false;
          }
          toast.success(`Updated ${result.updatedCount} transactions`);
          router.refresh();
          return true;
        } catch {
          toast.error("An error occurred. Please try again.");
          return false;
        }
      },
      async setAnalytics(ids, includeInAnalytics) {
        try {
          const result = await bulkUpdateTransactionIncludeInAnalytics(
            ids,
            includeInAnalytics,
          );
          if (!result.success) {
            toast.error(result.error || "Failed to update transactions");
            return false;
          }
          toast.success(
            includeInAnalytics
              ? `${result.updatedCount} transactions included in analytics`
              : `${result.updatedCount} transactions excluded from analytics`,
          );
          router.refresh();
          return true;
        } catch {
          toast.error("An error occurred. Please try again.");
          return false;
        }
      },
      async link(ids) {
        if (ids.length < 2) {
          toast.error("Select at least 2 transactions to link");
          return false;
        }
        try {
          const result = await createLinkGroupFromSelection(ids);
          if (!result.success) {
            toast.error(result.error || "Failed to link transactions");
            return false;
          }
          toast.success(`Linked ${ids.length} transactions`);
          router.refresh();
          return true;
        } catch {
          toast.error("An error occurred. Please try again.");
          return false;
        }
      },
      exportCsv(transactions) {
        if (transactions.length === 0) {
          toast.error("No transactions to export");
          return false;
        }
        try {
          exportTransactionsToCSV(transactions);
          toast.success(`Exported ${transactions.length} transactions`);
          return true;
        } catch {
          toast.error("Failed to export transactions");
          return false;
        }
      },
    }),
    [router],
  );
}
