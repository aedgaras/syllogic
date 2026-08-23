import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AddTransactionButton } from "./add-transaction-button";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

describe("AddTransactionButton", () => {
  it("renders a plain button that calls onAddManual when CSV import is disallowed", () => {
    const onAddManual = vi.fn();
    render(
      <AddTransactionButton onAddManual={onAddManual} allowCsvImport={false} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add transaction/i }));
    expect(onAddManual).toHaveBeenCalled();
  });

  it("does not render a dropdown menu when CSV import is disallowed", () => {
    render(<AddTransactionButton onAddManual={vi.fn()} allowCsvImport={false} />);
    expect(screen.queryByText(/import from csv/i)).toBeNull();
  });

  it("shows a dropdown with manual/import/scan options when CSV import is allowed", () => {
    render(<AddTransactionButton onAddManual={vi.fn()} allowCsvImport={true} />);
    fireEvent.click(screen.getByRole("button", { name: /add transaction/i }));
    expect(screen.getByText(/add manually/i)).toBeTruthy();
    expect(screen.getByText(/import from csv/i)).toBeTruthy();
    expect(screen.getByText(/scan receipt/i)).toBeTruthy();
  });

  it("calls onAddManual when the Add manually option is clicked", () => {
    const onAddManual = vi.fn();
    render(<AddTransactionButton onAddManual={onAddManual} allowCsvImport={true} />);
    fireEvent.click(screen.getByRole("button", { name: /add transaction/i }));
    fireEvent.click(screen.getByText(/add manually/i));
    expect(onAddManual).toHaveBeenCalled();
  });

  it("navigates to the import page when Import from CSV is clicked", () => {
    render(<AddTransactionButton onAddManual={vi.fn()} allowCsvImport={true} />);
    fireEvent.click(screen.getByRole("button", { name: /add transaction/i }));
    fireEvent.click(screen.getByText(/import from csv/i));
    expect(push).toHaveBeenCalledWith("/transactions/import");
  });

  it("navigates to the scan-receipt page when Scan receipt is clicked", () => {
    render(<AddTransactionButton onAddManual={vi.fn()} allowCsvImport={true} />);
    fireEvent.click(screen.getByRole("button", { name: /add transaction/i }));
    fireEvent.click(screen.getByText(/scan receipt/i));
    expect(push).toHaveBeenCalledWith("/transactions/scan-receipt");
  });
});
