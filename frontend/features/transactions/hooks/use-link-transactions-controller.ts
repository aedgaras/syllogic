"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  addTransactionToLinkGroup,
  createTransactionLinkGroup,
  findPotentialExpenses,
  findPotentialReimbursements,
  getTransactionLinkInfo,
  getUserAccountsForLinking,
  getTransactionLinkGroup,
  deleteLinkGroup,
  removeTransactionFromLinkGroup,
} from "@/lib/actions/transaction-links";
import type {
  SuggestedTransactionLink,
  TransactionLinkAccountOption,
  TransactionLinkSearchFilters,
  TransactionLinkGroup,
} from "../public";

export function useLinkTransactionsController() {
  return React.useMemo(
    () => ({
      async loadAccounts(): Promise<TransactionLinkAccountOption[]> {
        return getUserAccountsForLinking();
      },
      async loadGroup(
        transactionId: string,
      ): Promise<TransactionLinkGroup | null> {
        return getTransactionLinkGroup(transactionId);
      },
      async unlinkGroup(groupId: string): Promise<boolean> {
        try {
          const result = await deleteLinkGroup(groupId);
          if (!result.success) {
            toast.error(result.error || "Failed to unlink transactions");
            return false;
          }
          toast.success("Transactions unlinked");
          return true;
        } catch {
          toast.error("Failed to unlink transactions");
          return false;
        }
      },
      async removeFromGroup(
        transactionId: string,
      ): Promise<{ success: boolean; groupDeleted: boolean }> {
        try {
          const result = await removeTransactionFromLinkGroup(transactionId);
          if (!result.success) {
            toast.error(result.error || "Failed to remove transaction");
            return { success: false, groupDeleted: false };
          }
          toast.success("Transaction removed from group");
          return { success: true, groupDeleted: result.groupDeleted ?? false };
        } catch {
          toast.error("Failed to remove transaction");
          return { success: false, groupDeleted: false };
        }
      },
      async search(
        transactionId: string,
        isExpense: boolean,
        filters: TransactionLinkSearchFilters,
      ): Promise<{
        transactions: SuggestedTransactionLink[];
        totalCount: number;
      } | null> {
        try {
          return isExpense
            ? await findPotentialReimbursements(transactionId, filters)
            : await findPotentialExpenses(transactionId, filters);
        } catch {
          toast.error("Failed to load transactions");
          return null;
        }
      },
      async link(
        transactionId: string,
        selectedIds: string[],
        linkType: "reimbursement" | "expense",
      ): Promise<boolean> {
        if (selectedIds.length === 0) {
          toast.error("Please select at least one transaction to link");
          return false;
        }
        try {
          const existingLink = await getTransactionLinkInfo(transactionId);
          if (existingLink) {
            const outcomes = await Promise.all(
              selectedIds.map((id) =>
                addTransactionToLinkGroup(existingLink.groupId, id, linkType),
              ),
            );
            const count = outcomes.filter((result) => result.success).length;
            if (count === 0) {
              toast.error("Failed to add transactions to group");
              return false;
            }
            toast.success(`Added ${count} transaction(s) to link group`);
            return true;
          }

          const result = await createTransactionLinkGroup(
            transactionId,
            selectedIds,
            linkType,
          );
          if (!result.success) {
            toast.error(result.error || "Failed to link transactions");
            return false;
          }
          toast.success(`Linked ${selectedIds.length} transaction(s)`);
          return true;
        } catch {
          toast.error("Failed to link transactions");
          return false;
        }
      },
    }),
    [],
  );
}
