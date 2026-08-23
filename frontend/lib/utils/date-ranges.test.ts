import { describe, it, expect } from "vitest";
import { rangeToDates } from "./date-ranges";

describe("rangeToDates", () => {
  const now = new Date("2024-06-15T12:00:00Z");

  it("returns a fixed epoch start for ALL", () => {
    expect(rangeToDates("ALL", now)).toEqual({
      from: "2010-01-01",
      to: "2024-06-15",
    });
  });

  it("subtracts 7 days for 1W", () => {
    expect(rangeToDates("1W", now)).toEqual({
      from: "2024-06-08",
      to: "2024-06-15",
    });
  });

  it("subtracts 30 days for 1M", () => {
    expect(rangeToDates("1M", now)).toEqual({
      from: "2024-05-16",
      to: "2024-06-15",
    });
  });

  it("subtracts 90 days for 3M", () => {
    expect(rangeToDates("3M", now)).toEqual({
      from: "2024-03-17",
      to: "2024-06-15",
    });
  });

  it("subtracts 365 days for 1Y (crosses the 2024 leap day)", () => {
    expect(rangeToDates("1Y", now)).toEqual({
      from: "2023-06-16",
      to: "2024-06-15",
    });
  });

  it("defaults to the current date when now is omitted", () => {
    const result = rangeToDates("1W");
    expect(result.to).toBe(new Date().toISOString().slice(0, 10));
  });

  it("handles year boundary crossing", () => {
    const newYearEve = new Date("2024-01-05T00:00:00Z");
    expect(rangeToDates("1W", newYearEve)).toEqual({
      from: "2023-12-29",
      to: "2024-01-05",
    });
  });
});
