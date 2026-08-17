"use client";

import { useEffect, useState } from "react";
import { AccountHeader } from "@/components/accounts/account-header";
import { AccountBalanceChart } from "@/components/accounts/account-balance-chart";
import { AccountTransactions } from "@/components/accounts/account-transactions";
import type { TransactionWithRelations } from "@/features/transactions/public";
import type { CategoryDisplay } from "@/types";
import type { AccountViewModel, BalanceHistoryPoint } from "../domain/contracts";

interface AccountDetailProps {
  account: AccountViewModel;
  balanceHistory: BalanceHistoryPoint[];
  initialTransactions: TransactionWithRelations[];
  categories: CategoryDisplay[];
}

export function AccountDetail({
  account,
  balanceHistory,
  initialTransactions,
  categories,
}: AccountDetailProps) {
  const [transactions, setTransactions] = useState(initialTransactions);

  useEffect(() => setTransactions(initialTransactions), [initialTransactions]);

  return (
    <div className="flex flex-col gap-4">
      <AccountHeader account={account} currency={account.currency} />
      <AccountBalanceChart
        data={balanceHistory}
        currency={account.currency}
        storageKey={`filters:/accounts/${account.id}/balance-horizon`}
      />
      <div className="min-h-[400px]">
        {transactions.length === 0 ? (
          <div className="flex h-48 items-center justify-center rounded border border-dashed">
            <p className="text-sm text-muted-foreground">No transactions yet</p>
          </div>
        ) : (
          <AccountTransactions
            accountId={account.id}
            transactions={transactions}
            categories={categories}
            onUpdateTransaction={(id, updates) => setTransactions((current) =>
              current.map((transaction) => transaction.id === id ? { ...transaction, ...updates } : transaction)
            )}
            onDeleteTransaction={(id) => setTransactions((current) =>
              current.filter((transaction) => transaction.id !== id)
            )}
            onBulkUpdate={(ids, categoryId) => {
              const category = categoryId
                ? categories.find((item) => item.id === categoryId) ?? null
                : null;
              setTransactions((current) => current.map((transaction) =>
                ids.includes(transaction.id)
                  ? { ...transaction, categoryId, category }
                  : transaction
              ));
            }}
            onBulkDelete={(ids) => setTransactions((current) =>
              current.filter((transaction) => !ids.includes(transaction.id))
            )}
          />
        )}
      </div>
    </div>
  );
}

