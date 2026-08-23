import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ReportRunsTable } from "./ReportRunsTable";
import type { ReportRun } from "@/lib/reports/types";

function run(overrides: Partial<ReportRun> = {}): ReportRun {
  return {
    id: "run-1",
    scheduled_for: "2024-03-05T09:00:00.000Z",
    is_test: false,
    started_at: "2024-03-05T09:00:01.000Z",
    finished_at: "2024-03-05T09:00:05.000Z",
    status: "SUCCEEDED",
    error_message: null,
    recipient_emails: [],
    created_at: "2024-03-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ReportRunsTable", () => {
  it("shows 'Test send' instead of a timestamp for test runs", () => {
    render(<ReportRunsTable runs={[run({ is_test: true })]} />);
    expect(screen.getAllByText("Test send").length).toBeGreaterThan(0);
  });

  it("formats the scheduled timestamp for non-test runs", () => {
    const scheduled = "2024-03-05T09:00:00.000Z";
    render(<ReportRunsTable runs={[run({ scheduled_for: scheduled })]} />);
    const expected = new Date(scheduled).toLocaleString();
    expect(screen.getAllByText(expected).length).toBeGreaterThan(0);
  });

  it("shows a dash when scheduled_for is null and the run isn't a test", () => {
    render(<ReportRunsTable runs={[run({ scheduled_for: null })]} />);
    expect(screen.getAllByText("-").length).toBeGreaterThan(0);
  });

  it("shows the error message only when the run failed with one", () => {
    render(
      <ReportRunsTable
        runs={[run({ status: "FAILED", error_message: "Boom" })]}
      />,
    );
    expect(screen.getAllByText("Boom").length).toBeGreaterThan(0);
  });

  it("omits the mobile error row when there is no error message (only the table header says Error)", () => {
    render(<ReportRunsTable runs={[run({ error_message: null })]} />);
    expect(screen.getAllByText("Error").length).toBe(1);
  });

  it("renders the run status badge text", () => {
    render(<ReportRunsTable runs={[run({ status: "RUNNING" })]} />);
    expect(screen.getAllByText("RUNNING").length).toBeGreaterThan(0);
  });
});
