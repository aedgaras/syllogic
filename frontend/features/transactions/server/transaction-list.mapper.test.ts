import { describe, expect, it, vi } from "vitest";
import { mapTransactionListRow, mapTransactionListRows, type TransactionListRow } from "./transaction-list.mapper";

const row: TransactionListRow = {
  id: "tx-1", accountId: "account-1", description: "Coffee", merchant: "Cafe",
  creditor: null, debtor: null, amount: "-4.50", currency: "EUR", categoryId: null,
  categorySystemId: null, recurringTransactionId: null, bookedAt: new Date("2026-01-02T00:00:00Z"),
  pending: false, transactionType: "debit", includeInAnalytics: true,
  account: { id: "account-1", name: "Daily", institution: "Bank", accountType: "checking", logoId: null, logo: null },
  category: null, categorySystem: null, recurringTransaction: null, transactionLink: null,
  internalTransferId: "transfer-1",
  internalTransfer: { id: "transfer-1", sourceTxnId: "tx-1", mirrorTxnId: "tx-2", sourceAccount: null, pocketAccount: { id: "pocket-1", name: "Pocket" } },
};

describe("transaction list mapper", () => {
  it("maps persistence values to the transaction list contract", () => {
    expect(mapTransactionListRow(row)).toMatchObject({
      id: "tx-1", amount: -4.5,
      internalTransfer: { sourceTransactionId: "tx-1", mirrorTransactionId: "tx-2" },
    });
  });

  it("omits orphaned rows and reports them", () => {
    const onMissingAccount = vi.fn();
    expect(mapTransactionListRows([{ ...row, account: null }], onMissingAccount)).toEqual([]);
    expect(onMissingAccount).toHaveBeenCalledOnce();
  });
});
