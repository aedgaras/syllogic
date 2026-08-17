"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { deleteTransactions, getDeleteImpact } from "@/lib/actions/transactions";
import type { DeleteImpact } from "../public";

export function useDeleteTransactionsController() {
  const router = useRouter();
  return React.useMemo(
    () => ({
      async loadImpact(ids: string[]): Promise<DeleteImpact | null> {
        const result = await getDeleteImpact(ids);
        if (result.success) return result.data;
        toast.error(result.error ?? "Failed to compute impact");
        return null;
      },
      async remove(ids: string[]): Promise<boolean> {
        const result = await deleteTransactions(ids);
        if (!result.success) {
          toast.error(result.error ?? "Failed to delete transactions");
          return false;
        }
        const count = result.deletedCount ?? ids.length;
        toast.success(`${count === 1 ? "Transaction" : `${count} transactions`} deleted`);
        router.refresh();
        return true;
      },
    }),
    [router]
  );
}
