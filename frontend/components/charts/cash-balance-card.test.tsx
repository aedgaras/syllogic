import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { CashBalanceCard } from "./cash-balance-card";

describe("CashBalanceCard", () => {
  it("formats the balance as currency", () => {
    render(<CashBalanceCard balance={1234.5} currency="USD" />);
    expect(screen.getByText("$1,234.50")).toBeTruthy();
  });

  it("formats a different currency correctly", () => {
    render(<CashBalanceCard balance={99} currency="EUR" />);
    expect(screen.getByText("€99.00")).toBeTruthy();
  });

  it("shows the total balance label", () => {
    render(<CashBalanceCard balance={0} currency="USD" />);
    expect(screen.getByText(/total balance/i)).toBeTruthy();
  });
});
