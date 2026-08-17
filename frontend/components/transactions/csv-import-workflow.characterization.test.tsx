import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MappingPage from "@/app/(dashboard)/transactions/import/mapping/page";
import PreviewPage from "@/app/(dashboard)/transactions/import/preview/page";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  getCsvImportSession: vi.fn(),
  parseCsvHeaders: vi.fn(),
  getAiColumnMapping: vi.fn(),
  saveColumnMapping: vi.fn(),
  previewImportedTransactions: vi.fn(),
  enqueueBackgroundImport: vi.fn(),
  setPendingImport: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => new URLSearchParams("id=import-1"),
}));
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { id: "user-1" } } }) }));
vi.mock("@/features/csv-import/client/pending-import-storage", () => ({
  setPendingImport: mocks.setPendingImport,
}));
vi.mock("@/lib/actions/csv-import", () => ({
  getCsvImportSession: mocks.getCsvImportSession,
  parseCsvHeaders: mocks.parseCsvHeaders,
  getAiColumnMapping: mocks.getAiColumnMapping,
  saveColumnMapping: mocks.saveColumnMapping,
  previewImportedTransactions: mocks.previewImportedTransactions,
  enqueueBackgroundImport: mocks.enqueueBackgroundImport,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/layout/header", () => ({ Header: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("@/components/transactions/csv-sample-preview", () => ({ CsvSamplePreview: () => null }));
vi.mock("@/components/transactions/csv-mapping-table", () => ({
  CsvMappingTable: ({ mapping, onMappingChange }: { mapping: Record<string, unknown>; onMappingChange: (value: Record<string, unknown>) => void }) => (
    <button onClick={() => onMappingChange({ ...mapping, merchant: "Merchant", transactionType: "Type" })}>
      change optional mapping
    </button>
  ),
}));
vi.mock("@/components/transactions/csv-preview-table", () => ({
  CsvPreviewTable: ({ transactions }: { transactions: Array<{ rowIndex: number }> }) => (
    <div data-testid="preview-rows">{transactions.map((item) => item.rowIndex).join(",")}</div>
  ),
}));
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  TabsList: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  TabsTrigger: ({ children }: React.PropsWithChildren) => <button>{children}</button>,
  TabsContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

const mapping = {
  date: "Date",
  amount: "Amount",
  description: "Description",
  merchant: "Merchant",
  transactionType: "Type",
  fee: null,
  state: null,
  startingBalance: null,
  endingBalance: null,
  typeConfig: { isAmountSigned: true, amountFormat: "AUTO", dateFormat: "DD-MM-YYYY" },
};

describe("dashboard CSV import characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCsvImportSession.mockResolvedValue({ id: "import-1", columnMapping: mapping });
    mocks.parseCsvHeaders.mockResolvedValue({
      success: true,
      data: { headers: ["Date", "Amount", "Description"], rows: [], sampleRows: [] },
    });
    mocks.saveColumnMapping.mockResolvedValue({ success: true });
    mocks.previewImportedTransactions.mockResolvedValue({
      success: true,
      transactions: [
        { rowIndex: 0, date: "2026-08-01", amount: -10, description: "One", transactionType: "debit" },
        { rowIndex: 1, date: "2026-08-02", amount: -10, description: "Duplicate", transactionType: "debit", isDuplicate: true },
      ],
    });
    mocks.enqueueBackgroundImport.mockResolvedValue({ success: true, importId: "job-1", totalTransactions: 1 });
  });

  it("sanitizes unsupported mappings before saving and opens preview", async () => {
    render(<MappingPage />);
    fireEvent.click(await screen.findByRole("button", { name: "change optional mapping" }));
    fireEvent.click(screen.getByRole("button", { name: /preview transactions/i }));

    await waitFor(() => expect(mocks.saveColumnMapping).toHaveBeenCalled());
    expect(mocks.saveColumnMapping.mock.calls[0][1]).toMatchObject({ merchant: null, transactionType: null });
    expect(mocks.push).toHaveBeenCalledWith("/transactions/import/preview?id=import-1");
  });

  it("preselects non-duplicates and enqueues only those rows", async () => {
    render(<PreviewPage />);

    const importButton = await screen.findByRole("button", { name: /import 1 transactions/i });
    expect(screen.getAllByTestId("preview-rows")[0]).toHaveTextContent("0");
    expect(screen.getAllByTestId("preview-rows")[1]).toHaveTextContent("1");
    fireEvent.click(importButton);

    await waitFor(() => expect(mocks.enqueueBackgroundImport).toHaveBeenCalledWith("import-1", [0]));
    expect(mocks.setPendingImport).toHaveBeenCalledWith("job-1", "user-1");
    expect(mocks.push).toHaveBeenCalledWith("/transactions?importing=job-1");
  });
});
