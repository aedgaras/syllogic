import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CurrencySelector } from "./currency-selector";

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    onValueChange,
  }: React.PropsWithChildren<{ onValueChange?: (v: string) => void }>) => (
    <div data-testid="select" onClick={() => onValueChange?.("EUR")}>
      {children}
    </div>
  ),
  SelectContent: ({ children }: React.PropsWithChildren) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children }: React.PropsWithChildren) => (
    <span>{children}</span>
  ),
  SelectTrigger: ({ children }: React.PropsWithChildren) => (
    <div>{children}</div>
  ),
  SelectValue: () => null,
}));

describe("CurrencySelector", () => {
  it("renders the default label", () => {
    render(<CurrencySelector value="USD" onChange={vi.fn()} />);
    expect(screen.getByText("Functional Currency")).toBeTruthy();
  });

  it("renders a custom label when provided", () => {
    render(<CurrencySelector value="USD" onChange={vi.fn()} label="Base Currency" />);
    expect(screen.getByText("Base Currency")).toBeTruthy();
  });

  it("shows the tooltip trigger by default", () => {
    render(<CurrencySelector value="USD" onChange={vi.fn()} />);
    expect(document.querySelector("svg")).toBeTruthy();
  });

  it("hides the tooltip trigger when showTooltip is false", () => {
    const { container } = render(
      <CurrencySelector value="USD" onChange={vi.fn()} showTooltip={false} />,
    );
    expect(container.querySelector("svg")).toBeNull();
  });

  it("calls onChange with the newly selected currency code", () => {
    const onChange = vi.fn();
    render(<CurrencySelector value="USD" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("select"));
    expect(onChange).toHaveBeenCalledWith("EUR");
  });

  it("lists only functional currencies by default (fewer than all currencies)", () => {
    const { container: functionalOnly } = render(
      <CurrencySelector value="USD" onChange={vi.fn()} />,
    );
    const { container: all } = render(
      <CurrencySelector value="USD" onChange={vi.fn()} useAllCurrencies />,
    );
    const countSpans = (c: HTMLElement) => c.querySelectorAll("span > span").length;
    expect(countSpans(all)).toBeGreaterThan(countSpans(functionalOnly));
  });
});
