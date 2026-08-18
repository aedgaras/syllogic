import { describe, expect, it } from "vitest";
import { computeBudgetStatus } from "./status";

describe("computeBudgetStatus", () => {
  it("is on_track just under the near-limit threshold", () => {
    expect(computeBudgetStatus(79.9, 100)).toBe("on_track");
  });

  it("is near_limit exactly at 80%", () => {
    expect(computeBudgetStatus(80, 100)).toBe("near_limit");
  });

  it("is near_limit exactly at 100%", () => {
    expect(computeBudgetStatus(100, 100)).toBe("near_limit");
  });

  it("is over_budget just above 100%", () => {
    expect(computeBudgetStatus(100.1, 100)).toBe("over_budget");
  });
});
