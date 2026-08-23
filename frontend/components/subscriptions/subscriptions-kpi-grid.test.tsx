import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SubscriptionsKpiGrid } from "./subscriptions-kpi-grid";
import type { SubscriptionKpis } from "@/features/subscriptions/public";

const KPIS: SubscriptionKpis = {
  activeCount: 7,
  monthlyTotal: 42.5,
  allTimeTotal: 1234,
  currency: "EUR",
};

describe("SubscriptionsKpiGrid", () => {
  it("renders the active subscription count as-is", () => {
    render(<SubscriptionsKpiGrid kpis={KPIS} />);
    expect(screen.getByText("7")).toBeTruthy();
  });

  it("formats monthly and all-time totals as currency", () => {
    render(<SubscriptionsKpiGrid kpis={KPIS} />);
    expect(screen.getByText("€42.50")).toBeTruthy();
    expect(screen.getByText("€1,234.00")).toBeTruthy();
  });

  it("renders all three labels", () => {
    render(<SubscriptionsKpiGrid kpis={KPIS} />);
    expect(screen.getByText(/active subscriptions/i)).toBeTruthy();
    expect(screen.getByText(/total monthly/i)).toBeTruthy();
    expect(screen.getByText(/all.time total/i)).toBeTruthy();
  });
});
