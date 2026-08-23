import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exportTransactionsToCSV } from "./csv-export";
import type { TransactionWithRelations } from "@/features/transactions/public";

function tx(
  overrides: Partial<TransactionWithRelations> = {},
): TransactionWithRelations {
  return {
    id: "t1",
    bookedAt: "2024-03-05T00:00:00.000Z",
    description: "Groceries",
    merchant: "Supermarket",
    amount: -42.5,
    currency: "EUR",
    category: { name: "Food" },
    account: { name: "Checking" },
    transactionType: null,
    pending: false,
    ...overrides,
  } as TransactionWithRelations;
}

describe("exportTransactionsToCSV", () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let click: ReturnType<typeof vi.fn>;
  let capturedBlob: Blob | undefined;
  let capturedDownloadName: string | undefined;

  beforeEach(() => {
    capturedBlob = undefined;
    capturedDownloadName = undefined;

    createObjectURL = vi.fn((blob: Blob) => {
      capturedBlob = blob;
      return "blob:mock-url";
    });
    revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;

    click = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(click);
    vi.spyOn(HTMLAnchorElement.prototype, "setAttribute").mockImplementation(
      function (this: HTMLAnchorElement, name: string, value: string) {
        if (name === "download") capturedDownloadName = value;
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing when there are no transactions", () => {
    exportTransactionsToCSV([]);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it("builds a CSV blob with header + one row per transaction and triggers a download", async () => {
    exportTransactionsToCSV([tx()]);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");

    const text = await capturedBlob!.text();
    const [header, row] = text.split("\n");
    expect(header).toBe(
      "Date,Description,Merchant,Amount,Currency,Category,Account,Type,Status",
    );
    expect(row).toBe(
      "2024-03-05,Groceries,Supermarket,-42.50,EUR,Food,Checking,debit,Completed",
    );
  });

  it("falls back to Uncategorized/Unknown/EUR when relations are missing", async () => {
    exportTransactionsToCSV([
      tx({ category: null, account: null, currency: null as unknown as string }),
    ]);
    const text = await capturedBlob!.text();
    const [, row] = text.split("\n");
    expect(row).toBe(
      "2024-03-05,Groceries,Supermarket,-42.50,EUR,Uncategorized,Unknown,debit,Completed",
    );
  });

  it("derives debit/credit from the sign of amount when transactionType is unset", async () => {
    exportTransactionsToCSV([tx({ amount: 100 })]);
    const text = await capturedBlob!.text();
    const [, row] = text.split("\n");
    expect(row?.split(",")).toContain("credit");
  });

  it("marks pending transactions as Pending in the Status column", async () => {
    exportTransactionsToCSV([tx({ pending: true })]);
    const text = await capturedBlob!.text();
    const [, row] = text.split("\n");
    expect(row?.endsWith("Pending")).toBe(true);
  });

  it("quotes and escapes fields containing commas, quotes, or newlines", async () => {
    exportTransactionsToCSV([
      tx({ description: 'Coffee, "Large" size\nreceipt' }),
    ]);
    const text = await capturedBlob!.text();
    expect(text).toContain('2024-03-05,"Coffee, ""Large"" size\nreceipt"');
  });

  it("uses a default filename derived from today's date when none is given", () => {
    exportTransactionsToCSV([tx()]);
    const today = new Date().toISOString().split("T")[0];
    expect(capturedDownloadName).toBe(`transactions_${today}.csv`);
  });

  it("uses a custom filename when provided", () => {
    exportTransactionsToCSV([tx()], "my-export.csv");
    expect(capturedDownloadName).toBe("my-export.csv");
  });
});
