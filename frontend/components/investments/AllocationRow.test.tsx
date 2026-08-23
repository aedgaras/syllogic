import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AllocationRow } from "./AllocationRow";

describe("AllocationRow", () => {
  it("renders a By instrument and a By currency card", () => {
    render(
      <AllocationRow
        byInstrument={{ ETF: "60", Cash: "40" }}
        byCurrency={{ USD: "100" }}
      />,
    );
    expect(screen.getByText(/instrument/i)).toBeTruthy();
    expect(screen.getByText(/currency/i)).toBeTruthy();
  });

  it("computes each segment's percentage of its group's total", () => {
    render(
      <AllocationRow
        byInstrument={{ ETF: "75", Cash: "25" }}
        byCurrency={{}}
      />,
    );
    expect(screen.getByText("ETF")).toBeTruthy();
    expect(screen.getByText("75%")).toBeTruthy();
    expect(screen.getByText("Cash")).toBeTruthy();
    expect(screen.getByText("25%")).toBeTruthy();
  });

  it("renders nothing for an empty group without dividing by zero", () => {
    const { container } = render(
      <AllocationRow byInstrument={{}} byCurrency={{}} />,
    );
    // Two empty cards, no NaN% anywhere.
    expect(container.textContent).not.toContain("NaN");
  });

  it("rounds percentages to the nearest whole number", () => {
    render(
      <AllocationRow
        byInstrument={{ A: "1", B: "2" }}
        byCurrency={{}}
      />,
    );
    // 1/3 -> 33%, 2/3 -> 67%
    expect(screen.getByText("33%")).toBeTruthy();
    expect(screen.getByText("67%")).toBeTruthy();
  });
});
