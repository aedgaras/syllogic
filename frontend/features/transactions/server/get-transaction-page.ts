import { requireAuth } from "@/lib/auth-helpers";
import type { TransactionsQueryState } from "../domain/contracts";
import { getTransactionPage as runGetTransactionPage } from "../application/get-transaction-page";
import { transactionListRepository } from "./transaction-list.repository";

export async function getTransactionPage(query: TransactionsQueryState) {
  return runGetTransactionPage(
    await requireAuth(),
    query,
    transactionListRepository,
  );
}
