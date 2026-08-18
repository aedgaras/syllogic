import { requireAuth } from "@/lib/auth-helpers";
import type { TransactionsQueryState } from "../domain/contracts";
import { getTransactionPage as runGetTransactionPage } from "../application/get-transaction-page";
import { transactionListRepository } from "./transaction-list.repository";

export async function getTransactionPage(query: TransactionsQueryState) {
  try {
    return await runGetTransactionPage(
      await requireAuth(),
      query,
      transactionListRepository,
    );
  } catch (error) {
    console.error("[getTransactionPage] Failed to load transaction page:", {
      query,
      error,
    });
    throw error;
  }
}
