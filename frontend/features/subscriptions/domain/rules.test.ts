import { describe, expect, it } from "vitest";
import { monthlyEquivalent, validateSubscriptionInput } from "./rules";

describe("subscription rules", () => {
  it("normalizes supported frequencies to monthly cost", () => {
    expect(monthlyEquivalent("10", "weekly")).toBe(40);
    expect(monthlyEquivalent(120, "yearly")).toBe(10);
  });

  it("returns stable validation messages", () => {
    expect(validateSubscriptionInput({ accountId: "a", amount: 10, importance: 2 })).toBe("Name is required");
    expect(validateSubscriptionInput({ name: "Plan", accountId: "a", amount: 10, importance: 2 })).toBeNull();
  });
});
