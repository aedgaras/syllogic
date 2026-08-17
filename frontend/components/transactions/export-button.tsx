"use client";
import { t as translate } from "@/i18n/translate";

import { RiDownloadLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { exportTransactionsToCSV } from "@/lib/utils/csv-export";
import type { TransactionWithRelations } from "@/features/transactions/public";

interface ExportButtonProps {
  transactions: TransactionWithRelations[];
  disabled?: boolean;
}

export function ExportButton({ transactions, disabled }: ExportButtonProps) {
  const handleExport = () => {
    if (transactions.length === 0) {
      toast.error(translate("noTransactionsToExport"));
      return;
    }

    try {
      exportTransactionsToCSV(transactions);
      toast.success(
        translate("exportedTransactions", { value1: transactions.length }),
      );
    } catch {
      toast.error(translate("failedToExportTransactions"));
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleExport}
      disabled={disabled || transactions.length === 0}
    >
      <RiDownloadLine className="mr-2 h-4 w-4" />
      {translate("exportCsv")}
    </Button>
  );
}
