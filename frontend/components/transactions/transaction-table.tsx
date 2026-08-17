"use client";
import { t as translate } from "@/i18n/translate";


import * as React from "react";
import {
  type ColumnDef,
} from "@tanstack/react-table";
import { DataTable } from "@/components/ui/data-table";
import type {
  FilteredTransactionTotals,
  TransactionWithRelations,
} from "@/features/transactions/public";
import type { CategoryDisplay, AccountForFilter } from "@/shared/domain/display-contracts";
import { TransactionSheet } from "./transaction-sheet";
import { transactionColumns } from "./columns";
import { TransactionFilters } from "./transaction-filters";
import { TransactionPagination } from "./transaction-pagination";
import { BulkActionsDock } from "./bulk-actions-dock";
import { useFilterPersistence } from "@/shared/client/hooks/use-filter-persistence";
import {
  hasActiveTransactionFilters,
  type TransactionsQueryState,
} from "@/features/transactions/public";
import { useTransactionQueryState } from "@/features/transactions/hooks/use-transaction-query-state";
import type { BulkTransactionActions } from "@/features/transactions/hooks/use-bulk-transaction-actions";

interface TransactionTableProps {
  transactions: TransactionWithRelations[];
  totalCount: number;
  filteredTotals: FilteredTransactionTotals | null;
  queryState: TransactionsQueryState;
  categories?: CategoryDisplay[];
  accounts?: AccountForFilter[];
  onUpdateTransaction?: (id: string, updates: Partial<TransactionWithRelations>) => void;
  onDeleteTransaction?: (id: string) => void;
  onBulkUpdate?: (transactionIds: string[], categoryId: string | null) => void;
  onBulkAnalyticsUpdate?: (transactionIds: string[], includeInAnalytics: boolean) => void;
  onBulkDelete?: (deletedIds: string[]) => void;
  onLinkSuccess?: () => void;
  canDelete?: boolean;
  action?: React.ReactNode;
  basePath?: string;
  showToolbar?: boolean;
  columns?: ColumnDef<TransactionWithRelations>[];
  bulkActions: BulkTransactionActions;
}

function formatSummaryAmount(amount: number): string {
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function TransactionTable({
  transactions,
  totalCount,
  filteredTotals,
  queryState,
  categories = [],
  accounts = [],
  onUpdateTransaction,
  onDeleteTransaction,
  onBulkUpdate,
  onBulkAnalyticsUpdate,
  onBulkDelete,
  onLinkSuccess,
  canDelete = true,
  action,
  basePath = "/transactions",
  showToolbar = true,
  columns,
  bulkActions,
}: TransactionTableProps) {
  const [selectedTransaction, setSelectedTransaction] = React.useState<TransactionWithRelations | null>(null);
  const {
    searchParams,
    updateQueryState,
    sortingState,
    paginationState,
    onSortingStateChange,
    onPaginationStateChange,
    consumeTransactionDeepLink,
  } = useTransactionQueryState(queryState, basePath);

  useFilterPersistence();

  const pageCount = Math.max(1, Math.ceil(totalCount / queryState.pageSize));
  const resolvedFilteredTotals = hasActiveTransactionFilters(queryState)
    ? filteredTotals
    : null;

  const recurringOptions = React.useMemo(() => {
    const byId = new Map<string, { id: string; name: string; merchant?: string; frequency: string }>();
    transactions.forEach((transaction) => {
      const recurring = transaction.recurringTransaction;
      if (!recurring || byId.has(recurring.id)) {
        return;
      }
      byId.set(recurring.id, {
        id: recurring.id,
        name: recurring.name,
        merchant: recurring.merchant ?? undefined,
        frequency: recurring.frequency,
      });
    });
    return Array.from(byId.values());
  }, [transactions]);

  React.useEffect(() => {
    const txId = searchParams.get("tx");
    if (!txId) return;
    const tx = transactions.find((transaction) => transaction.id === txId);
    if (!tx) return;

    setSelectedTransaction(tx);
    consumeTransactionDeepLink(tx.id);
  }, [consumeTransactionDeepLink, searchParams, transactions]);

  const handleRowClick = (transaction: TransactionWithRelations) => {
    setSelectedTransaction(transaction);
  };

  const handleUpdateTransaction = (id: string, updates: Partial<TransactionWithRelations>) => {
    onUpdateTransaction?.(id, updates);
    if (selectedTransaction?.id === id) {
      setSelectedTransaction((prev) => (prev ? { ...prev, ...updates } : null));
    }
  };

  return (
    <>
      <DataTable
        columns={columns ?? transactionColumns}
        data={transactions}
        onRowClick={handleRowClick}
        enableColumnResizing={true}
        enableRowSelection={true}
        enablePagination={true}
        manualPagination={true}
        manualSorting={true}
        rowCount={totalCount}
        pageCount={pageCount}
        paginationState={paginationState}
        onPaginationStateChange={onPaginationStateChange}
        sortingState={sortingState}
        onSortingStateChange={onSortingStateChange}
        toolbar={
          showToolbar
            ? () => (
                <TransactionFilters
                  filters={queryState}
                  categories={categories}
                  accounts={accounts}
                  recurringOptions={recurringOptions}
                  action={action}
                  onFiltersChange={updateQueryState}
                  onClearFilters={() =>
                    updateQueryState(
                      {
                        page: 1,
                        search: undefined,
                        category: [],
                        accountIds: [],
                        status: [],
                        subscription: [],
                        analytics: [],
                        minAmount: undefined,
                        maxAmount: undefined,
                        from: undefined,
                        to: undefined,
                        horizon: 30,
                        sort: "bookedAt",
                        order: "desc",
                      },
                      { resetPage: false }
                    )
                  }
                />
              )
            : undefined
        }
        pagination={(table) => (
          <TransactionPagination
            table={table}
            totalCount={totalCount}
            page={queryState.page}
            pageSize={queryState.pageSize}
            onPageChange={(page) => updateQueryState({ page }, { resetPage: false })}
            onPageSizeChange={(pageSize) =>
              updateQueryState({ pageSize, page: 1 }, { resetPage: false })
            }
          />
        )}
        bulkActions={(table) => {
          const selectedRows = table.getSelectedRowModel().rows;
          const selectedIds = selectedRows.map((row) => row.original.id);
          const selectedTransactions = selectedRows.map((row) => row.original);
          const selectedCount = selectedRows.length;

          return (
            <BulkActionsDock
              selectedCount={selectedCount}
              selectedIds={selectedIds}
              selectedTransactions={selectedTransactions}
              categories={categories}
              onClearSelection={() => table.resetRowSelection()}
              onBulkUpdate={(categoryId) => {
                onBulkUpdate?.(selectedIds, categoryId);
              }}
              onBulkAnalyticsUpdate={(includeInAnalytics) => {
                onBulkAnalyticsUpdate?.(selectedIds, includeInAnalytics);
              }}
              onBulkDelete={(deletedIds) => {
                onBulkDelete?.(deletedIds);
                table.resetRowSelection();
              }}
              onLinkSuccess={onLinkSuccess}
              canDelete={canDelete}
              actions={bulkActions}
            />
          );
        }}
        wrapperClassName="flex min-h-0 flex-1 flex-col"
        tableContainerClassName="min-h-0 flex-1 overflow-y-auto"
        mobileCards
        tableContainerProps={
          { "data-walkthrough": "walkthrough-table" } as React.HTMLAttributes<HTMLDivElement>
        }
        footer={
          resolvedFilteredTotals ? (
            <div className="-mt-px flex items-center justify-end gap-8 border-x border-b bg-muted/25 px-4 py-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">{translate("totalIn")}</span>
                <span className="font-mono font-medium text-emerald-700">
                  +{formatSummaryAmount(resolvedFilteredTotals.totalIn)}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">{translate("totalOut")}</span>
                <span className="font-mono font-medium text-rose-700">
                  -{formatSummaryAmount(resolvedFilteredTotals.totalOut)}
                </span>
              </div>
            </div>
          ) : null
        }
      />

      <TransactionSheet
        transaction={selectedTransaction}
        open={selectedTransaction !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedTransaction(null);
        }}
        onUpdateTransaction={handleUpdateTransaction}
        onDeleteTransaction={onDeleteTransaction}
        categories={categories}
        canDelete={canDelete}
        canEdit={canDelete}
      />
    </>
  );
}
