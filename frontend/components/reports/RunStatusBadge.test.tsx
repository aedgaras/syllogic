import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { RunStatusBadge } from "./RunStatusBadge";

describe("RunStatusBadge", () => {
  it("renders the status text", () => {
    render(<RunStatusBadge status="RUNNING" />);
    expect(screen.getByText("RUNNING")).toBeTruthy();
  });

  it.each([
    ["SCHEDULED", "bg-secondary"],
    ["RUNNING", "border-border"],
    ["SUCCEEDED", "bg-primary"],
    ["FAILED", "bg-destructive/10"],
  ] as const)("maps %s to the %s badge variant", (status, variantClass) => {
    render(<RunStatusBadge status={status} />);
    expect(screen.getByText(status).className).toContain(variantClass);
  });
});
