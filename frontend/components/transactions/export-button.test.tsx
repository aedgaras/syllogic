import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExportButton } from "./export-button";
import { exportTransactionsToCSV } from "@/lib/utils/csv-export";
import { toast } from "sonner";
import type { TransactionWithRelations } from "@/features/transactions/public";

vi.mock("@/lib/utils/csv-export", () => ({
  exportTransactionsToCSV: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const TRANSACTIONS = [{ id: "t1" }] as unknown as TransactionWithRelations[];

describe("ExportButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is disabled when there are no transactions", () => {
    render(<ExportButton transactions={[]} />);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("is disabled when the disabled prop is set, even with transactions", () => {
    render(<ExportButton transactions={TRANSACTIONS} disabled />);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("exports and shows a success toast when clicked with transactions", () => {
    render(<ExportButton transactions={TRANSACTIONS} />);
    fireEvent.click(screen.getByRole("button"));
    expect(exportTransactionsToCSV).toHaveBeenCalledWith(TRANSACTIONS);
    expect(toast.success).toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("shows an error toast when the export throws", () => {
    vi.mocked(exportTransactionsToCSV).mockImplementation(() => {
      throw new Error("boom");
    });
    render(<ExportButton transactions={TRANSACTIONS} />);
    fireEvent.click(screen.getByRole("button"));
    expect(toast.error).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
