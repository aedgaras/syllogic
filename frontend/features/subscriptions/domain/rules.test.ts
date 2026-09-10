import { describe, expect, it } from "vitest";
import {
  monthlyEquivalent,
  nextDueDateAfter,
  validateSubscriptionInput,
} from "./rules";

describe("subscription rules", () => {
  it("normalizes supported frequencies to monthly cost", () => {
    expect(monthlyEquivalent("10", "weekly")).toBe(40);
    expect(monthlyEquivalent(120, "yearly")).toBe(10);
  });

  it("returns stable validation messages", () => {
    expect(
      validateSubscriptionInput({ accountId: "a", amount: 10, importance: 2 }),
    ).toBe("Name is required");
    expect(
      validateSubscriptionInput({
        name: "Plan",
        accountId: "a",
        amount: 10,
        importance: 2,
      }),
    ).toBeNull();
  });
});

describe("nextDueDateAfter", () => {
  it("steps by whole days for weekly cadences", () => {
    expect(nextDueDateAfter(new Date("2026-03-05T00:00:00Z"), "weekly")).toBe(
      "2026-03-12",
    );
    expect(nextDueDateAfter(new Date("2026-03-05T00:00:00Z"), "biweekly")).toBe(
      "2026-03-19",
    );
  });

  it("steps by whole months and clamps to the month end", () => {
    expect(nextDueDateAfter(new Date("2026-01-31T00:00:00Z"), "monthly")).toBe(
      "2026-02-28",
    );
    expect(nextDueDateAfter(new Date("2026-01-15T00:00:00Z"), "quarterly")).toBe(
      "2026-04-15",
    );
    expect(nextDueDateAfter(new Date("2026-01-15T00:00:00Z"), "yearly")).toBe(
      "2027-01-15",
    );
  });

  it("returns null for a cadence it cannot step", () => {
    expect(nextDueDateAfter(new Date("2026-01-15T00:00:00Z"), "hourly")).toBeNull();
  });
});
