import type { TransactionWithRelations } from "./contracts";

export type TransactionListAction =
  | { type: "replace"; transactions: TransactionWithRelations[] }
  | { type: "update"; id: string; updates: Partial<TransactionWithRelations> }
  | { type: "delete"; ids: string[] }
  | {
      type: "set-category";
      ids: string[];
      categoryId: string | null;
      category: TransactionWithRelations["category"];
    }
  | { type: "set-analytics"; ids: string[]; includeInAnalytics: boolean };

export function transactionListReducer(
  state: TransactionWithRelations[],
  action: TransactionListAction,
): TransactionWithRelations[] {
  switch (action.type) {
    case "replace":
      return action.transactions;
    case "update":
      return state.map((transaction) =>
        transaction.id === action.id
          ? { ...transaction, ...action.updates }
          : transaction,
      );
    case "delete": {
      const deletedIds = new Set(action.ids);
      return state.filter((transaction) => !deletedIds.has(transaction.id));
    }
    case "set-category": {
      const updatedIds = new Set(action.ids);
      return state.map((transaction) =>
        updatedIds.has(transaction.id)
          ? {
              ...transaction,
              categoryId: action.categoryId,
              category: action.category,
            }
          : transaction,
      );
    }
    case "set-analytics": {
      const updatedIds = new Set(action.ids);
      return state.map((transaction) =>
        updatedIds.has(transaction.id)
          ? { ...transaction, includeInAnalytics: action.includeInAnalytics }
          : transaction,
      );
    }
  }
}
