import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ReportList } from "./ReportList";
import type { Report } from "@/lib/reports/types";

function report(overrides: Partial<Report> = {}): Report {
  return {
    id: "r1",
    name: "Weekly summary",
    account_ids: [],
    transaction_mode: "RECENT",
    transaction_count: 10,
    transaction_direction: "ALL",
    frequency: "WEEKLY",
    send_time: "09:00",
    send_day_of_week: 1,
    send_day_of_month: null,
    timezone: "UTC",
    recipient_emails: [],
    is_active: true,
    next_run_at: "2024-03-10T09:00:00.000Z",
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ReportList", () => {
  it("renders a report's name and lowercased frequency", () => {
    render(<ReportList reports={[report()]} onDelete={vi.fn()} />);
    expect(screen.getByText("Weekly summary")).toBeTruthy();
    expect(screen.getByText("weekly")).toBeTruthy();
  });

  it("shows active vs paused status", () => {
    render(
      <ReportList
        reports={[report({ id: "a", is_active: true }), report({ id: "b", is_active: false })]}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText("active")).toBeTruthy();
    expect(screen.getByText("paused")).toBeTruthy();
  });

  it("shows a dash for next run when there is none scheduled", () => {
    render(
      <ReportList reports={[report({ next_run_at: null })]} onDelete={vi.fn()} />,
    );
    expect(screen.getByText(/next run\s*-/i)).toBeTruthy();
  });

  it("calls onDelete with the report id when Delete is clicked", () => {
    const onDelete = vi.fn();
    render(<ReportList reports={[report({ id: "r42" })]} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledWith("r42");
  });

  it("renders one list item per report", () => {
    render(
      <ReportList
        reports={[report({ id: "a" }), report({ id: "b" }), report({ id: "c" })]}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("listitem").length).toBe(3);
  });
});
