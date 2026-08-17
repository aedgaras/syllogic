import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TransactionTable } from "./transaction-table";
import type { TransactionWithRelations } from "@/lib/actions/transactions";
import type { TransactionsQueryState } from "@/lib/transactions/query-state";

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  searchParams: new URLSearchParams("page=2&view=compact&tx=tx-1"),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  useSearchParams: () => navigation.searchParams,
}));

vi.mock("@/lib/hooks/use-filter-persistence", () => ({ useFilterPersistence: vi.fn() }));
vi.mock("./transaction-filters", () => ({ TransactionFilters: () => null }));
vi.mock("./transaction-pagination", () => ({ TransactionPagination: () => null }));
vi.mock("./bulk-actions-dock", () => ({ BulkActionsDock: () => null }));
vi.mock("./columns", () => ({ transactionColumns: [] }));
vi.mock("./transaction-sheet", () => ({
  TransactionSheet: ({ transaction }: { transaction: TransactionWithRelations | null }) => (
    <div data-testid="selected-transaction">{transaction?.id ?? "none"}</div>
  ),
}));
vi.mock("@/components/ui/data-table", () => ({
  DataTable: (props: {
    data: TransactionWithRelations[];
    onRowClick: (row: TransactionWithRelations) => void;
    onSortingStateChange: (sorting: Array<{ id: string; desc: boolean }>) => void;
    onPaginationStateChange: (pagination: { pageIndex: number; pageSize: number }) => void;
    footer?: React.ReactNode;
  }) => (
    <div>
      <button onClick={() => props.onRowClick(props.data[0])}>select row</button>
      <button onClick={() => props.onSortingStateChange([{ id: "amount", desc: false }])}>sort amount</button>
      <button onClick={() => props.onPaginationStateChange({ pageIndex: 2, pageSize: 50 })}>page 3</button>
      {props.footer}
    </div>
  ),
}));

const transaction: TransactionWithRelations = {
  id: "tx-1",
  accountId: "account-1",
  account: null,
  description: "Coffee",
  merchant: "Cafe",
  creditor: null,
  debtor: null,
  amount: -4.5,
  currency: "EUR",
  categoryId: null,
  category: null,
  categorySystemId: null,
  categorySystem: null,
  recurringTransactionId: null,
  recurringTransaction: null,
  transactionLink: null,
  internalTransferId: null,
  internalTransfer: null,
  bookedAt: new Date("2026-08-01T00:00:00Z"),
  pending: false,
  transactionType: "debit",
  includeInAnalytics: true,
};

const queryState: TransactionsQueryState = {
  page: 2,
  pageSize: 25,
  category: [],
  accountIds: [],
  status: [],
  subscription: [],
  analytics: [],
  horizon: 30,
  sort: "bookedAt",
  order: "desc",
};

describe("TransactionTable characterization", () => {
  beforeEach(() => navigation.replace.mockClear());

  it("opens a deep-linked row and consumes only the tx query parameter", () => {
    render(
      <TransactionTable
        transactions={[transaction]}
        totalCount={1}
        filteredTotals={null}
        queryState={queryState}
      />
    );

    expect(screen.getByTestId("selected-transaction")).toHaveTextContent("tx-1");
    expect(navigation.replace).toHaveBeenCalledWith("/transactions?page=2&view=compact", { scroll: false });
  });

  it("preserves unrelated query parameters for sort and pagination changes", () => {
    render(
      <TransactionTable
        transactions={[transaction]}
        totalCount={100}
        filteredTotals={{ totalIn: 1200, totalOut: 450 }}
        queryState={{ ...queryState, search: "coffee" }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "sort amount" }));
    fireEvent.click(screen.getByRole("button", { name: "page 3" }));

    const destinations = navigation.replace.mock.calls.map(([destination]) => destination as string);
    const sortDestination = destinations.find((destination) => destination.includes("sort=amount"));
    const pageDestination = destinations.find((destination) => destination.includes("page=3"));
    expect(sortDestination).toContain("view=compact");
    expect(sortDestination).toContain("order=asc");
    expect(pageDestination).toContain("view=compact");
    expect(pageDestination).toContain("pageSize=50");
    expect(screen.getByText("+1,200.00")).toBeInTheDocument();
    expect(screen.getByText("-450.00")).toBeInTheDocument();
  });
});
