import { describe, expect, it } from "vitest";
import { getCurrentPeriodRange } from "./period";

function ymd(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

describe("getCurrentPeriodRange", () => {
  const now = new Date(2026, 7, 18, 12, 0, 0);

  it("returns the calendar month range for monthly", () => {
    const { start, end } = getCurrentPeriodRange("monthly", null, now);
    expect(ymd(start)).toBe("2026-08-01");
    expect(ymd(end)).toBe("2026-09-01");
  });

  it("returns the calendar year range for yearly", () => {
    const { start, end } = getCurrentPeriodRange("yearly", null, now);
    expect(ymd(start)).toBe("2026-01-01");
    expect(ymd(end)).toBe("2027-01-01");
  });

  it("returns a Monday-anchored week when no startDate is given", () => {
    const { start, end } = getCurrentPeriodRange("weekly", null, now);
    expect(start.getDay()).toBe(1);
    expect(end.getTime() - start.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("anchors the week to startDate's weekday", () => {
    const startDate = new Date(2026, 7, 5); // Wednesday
    const { start } = getCurrentPeriodRange("weekly", startDate, now);
    expect(start.getDay()).toBe(3);
  });
});
