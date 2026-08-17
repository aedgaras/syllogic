"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AddTransactionButton } from "@/components/transactions/add-transaction-button";
import { AddTransactionDialog } from "@/components/transactions/add-transaction-dialog";
import { TransactionTable } from "@/components/transactions/transaction-table";
import { useRegisterCommandPaletteCallbacks } from "@/components/command-palette-context";
import { exportTransactionsToCSV } from "@/lib/utils/csv-export";
import type { AccountForFilter, CategoryDisplay } from "@/shared/domain/display-contracts";
import type {
  FilteredTransactionTotals,
  TransactionsQueryState,
  TransactionWithRelations,
} from "../public";
import { transactionListReducer } from "../domain/transaction-list-reducer";
import { ImportProgressView } from "../components/import-progress-view";
import { useImportProgressController } from "../hooks/use-import-progress-controller";
import { useBulkTransactionActions } from "../hooks/use-bulk-transaction-actions";

interface TransactionsScreenProps {
  initialTransactions: TransactionWithRelations[];
  totalCount: number;
  filteredTotals: FilteredTransactionTotals | null;
  initialQueryState: TransactionsQueryState;
  categories: CategoryDisplay[];
  accounts: AccountForFilter[];
  canImportCsv: boolean;
  canDelete?: boolean;
}

export function TransactionsScreen({
  initialTransactions,
  totalCount,
  filteredTotals,
  initialQueryState,
  categories,
  accounts,
  canImportCsv,
  canDelete = true,
}: TransactionsScreenProps) {
  const router = useRouter();
  const [transactions, dispatch] = React.useReducer(
    transactionListReducer,
    initialTransactions
  );
  const [isAddDialogOpen, setIsAddDialogOpen] = React.useState(false);
  const importProgress = useImportProgressController();
  const bulkActions = useBulkTransactionActions();

  React.useEffect(() => {
    dispatch({ type: "replace", transactions: initialTransactions });
  }, [initialTransactions]);

  const handleAddManual = React.useCallback(() => setIsAddDialogOpen(true), []);
  const handleExportCsv = React.useCallback(
    () => exportTransactionsToCSV(transactions),
    [transactions]
  );
  const handleImportCsv = React.useCallback(
    () => router.push("/transactions/import"),
    [router]
  );

  useRegisterCommandPaletteCallbacks(
    {
      onAddTransaction: handleAddManual,
      onExportCSV: handleExportCsv,
      onImportCsv: canImportCsv ? handleImportCsv : undefined,
    },
    [canImportCsv, handleAddManual, handleExportCsv, handleImportCsv]
  );

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col">
        <TransactionTable
          transactions={transactions}
          totalCount={totalCount}
          filteredTotals={filteredTotals}
          queryState={initialQueryState}
          categories={categories}
          accounts={accounts}
          onUpdateTransaction={(id, updates) => dispatch({ type: "update", id, updates })}
          onDeleteTransaction={(id) => dispatch({ type: "delete", ids: [id] })}
          onBulkUpdate={(ids, categoryId) =>
            dispatch({
              type: "set-category",
              ids,
              categoryId,
              category: categoryId
                ? categories.find((category) => category.id === categoryId) ?? null
                : null,
            })
          }
          onBulkAnalyticsUpdate={(ids, includeInAnalytics) =>
            dispatch({ type: "set-analytics", ids, includeInAnalytics })
          }
          onBulkDelete={(ids) => dispatch({ type: "delete", ids })}
          onLinkSuccess={() => router.refresh()}
          canDelete={canDelete}
          bulkActions={bulkActions}
          action={
            <div className="flex flex-row items-center gap-3">
              <ImportProgressView {...importProgress} />
              <AddTransactionButton
                onAddManual={handleAddManual}
                allowCsvImport={canImportCsv}
              />
            </div>
          }
        />
      </div>
      <AddTransactionDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        categories={categories}
      />
    </>
  );
}
