import { describe, expect, it } from "vitest";
import type { TransactionWithRelations } from "./contracts";
import { transactionListReducer } from "./transaction-list-reducer";

const transaction = (id: string): TransactionWithRelations =>
  ({
    id,
    categoryId: null,
    category: null,
    includeInAnalytics: true,
  }) as TransactionWithRelations;

describe("transactionListReducer", () => {
  it("applies optimistic updates without mutating the source list", () => {
    const source = [transaction("one"), transaction("two")];
    const updated = transactionListReducer(source, {
      type: "set-analytics",
      ids: ["two"],
      includeInAnalytics: false,
    });

    expect(updated[1].includeInAnalytics).toBe(false);
    expect(source[1].includeInAnalytics).toBe(true);
  });

  it("replaces optimistic state when authoritative server props arrive", () => {
    const authoritative = [transaction("server")];
    expect(
      transactionListReducer([transaction("local")], {
        type: "replace",
        transactions: authoritative,
      }),
    ).toBe(authoritative);
  });
});
