import { describe, expect, it } from "vitest";
import { calculateStringSimilarity, detectFrequencyFromGaps, scoreSubscriptionMatch } from "./matching";

describe("subscription matching", () => {
  it("scores exact merchant and amount matches", () => {
    expect(scoreSubscriptionMatch(
      { name: "Netflix", merchant: "Netflix", amount: "12.00" },
      { merchant: "netflix", description: null, amount: "-12.00" }
    )).toEqual({ score: 80, reason: "Exact merchant match, Exact amount match" });
  });

  it("keeps substring similarity compatible with the legacy matcher", () => {
    expect(calculateStringSimilarity("Netflix.com", "Netflix")).toBe(80);
  });

  it("detects recurring intervals without framework or database dependencies", () => {
    expect(detectFrequencyFromGaps([29, 30, 31])).toEqual({ frequency: "monthly", confidence: 99 });
    expect(detectFrequencyFromGaps([7, 7, 7])).toEqual({ frequency: "weekly", confidence: 100 });
  });
});
