import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MaskableAmount } from "./maskable-amount";
import { HideBalancesProvider } from "./hide-balances-provider";

vi.mock("@/lib/actions/settings", () => ({
  updateHideBalances: vi.fn(),
}));

describe("MaskableAmount", () => {
  it("shows the value unmasked outside any provider (default context)", () => {
    render(<MaskableAmount value="€1,234" />);
    expect(screen.getByText("€1,234")).toBeTruthy();
  });

  it("shows the value when hideBalances starts false", () => {
    render(
      <HideBalancesProvider initialHideBalances={false}>
        <MaskableAmount value="€1,234" />
      </HideBalancesProvider>,
    );
    expect(screen.getByText("€1,234")).toBeTruthy();
  });

  it("shows the default mask when hideBalances starts true", () => {
    render(
      <HideBalancesProvider initialHideBalances={true}>
        <MaskableAmount value="€1,234" />
      </HideBalancesProvider>,
    );
    expect(screen.queryByText("€1,234")).toBeNull();
    expect(screen.getByText("••••")).toBeTruthy();
  });

  it("supports a custom mask", () => {
    render(
      <HideBalancesProvider initialHideBalances={true}>
        <MaskableAmount value="€1,234" mask="hidden" />
      </HideBalancesProvider>,
    );
    expect(screen.getByText("hidden")).toBeTruthy();
  });
});
