import { describe, expect, it, vi } from "vitest";
import { getTransactionPage, type TransactionListRepository } from "./get-transaction-page";
import type { TransactionsQueryState } from "../domain/contracts";

const query: TransactionsQueryState = {
  page: 2,
  pageSize: 20,
  category: [],
  accountIds: [],
  status: [],
  subscription: [],
  analytics: [],
  sort: "bookedAt",
  order: "desc",
};

describe("getTransactionPage", () => {
  it("does not access the repository for an unauthenticated request", async () => {
    const repository: TransactionListRepository = { getPage: vi.fn() };
    await expect(getTransactionPage(null, query, repository)).resolves.toEqual({
      rows: [], totalCount: 0, filteredTotals: null, page: 2, pageSize: 20,
    });
    expect(repository.getPage).not.toHaveBeenCalled();
  });

  it("delegates an authenticated query to the repository", async () => {
    const page = { rows: [], totalCount: 3, filteredTotals: null, page: 2, pageSize: 20 };
    const repository: TransactionListRepository = { getPage: vi.fn().mockResolvedValue(page) };
    await expect(getTransactionPage("user-1", query, repository)).resolves.toBe(page);
    expect(repository.getPage).toHaveBeenCalledWith("user-1", query);
  });
});
