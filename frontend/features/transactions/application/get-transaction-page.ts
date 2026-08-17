import type {
  TransactionPage,
  TransactionsQueryState,
} from "../domain/contracts";

export interface TransactionListRepository {
  getPage(
    userId: string,
    query: TransactionsQueryState,
  ): Promise<TransactionPage>;
}

export async function getTransactionPage(
  userId: string | null,
  query: TransactionsQueryState,
  repository: TransactionListRepository,
): Promise<TransactionPage> {
  if (!userId) {
    return {
      rows: [],
      totalCount: 0,
      filteredTotals: null,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  return repository.getPage(userId, query);
}
