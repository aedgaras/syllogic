import { describe, expect, it } from "vitest";
import {
  DATE_FORMAT_OPTIONS,
  isImportDateFormat,
  parseImportDate,
  toInvariantDate,
  toInvariantDateTime,
  type ImportDateFormat,
} from "./dates";

const samples: Record<ImportDateFormat, string> = {
  "DD-MM-YYYY": "13-02-2025 14:30:00",
  "DD/MM/YYYY": "13/02/2025",
  "DD.MM.YYYY": "13.02.2025",
  "MM-DD-YYYY": "02-13-2025",
  "MM/DD/YYYY": "02/13/2025 14:30",
  "MM.DD.YYYY": "02.13.2025",
  "YYYY-MM-DD": "2025-02-13T14:30:00+02:00",
  "YYYY/MM/DD": "2025/02/13",
  "YYYY.MM.DD": "2025.02.13",
  "DD-MM-YY": "13-02-25",
  "DD/MM/YY": "13/02/25",
  "DD.MM.YY": "13.02.25",
  "MM-DD-YY": "02-13-25",
  "MM/DD/YY": "02/13/25",
  "MM.DD.YY": "02.13.25",
  "YY-MM-DD": "25-02-13",
  "YY/MM/DD": "25/02/13",
  "YY.MM.DD": "25.02.13",
  YYYYMMDD: "20250213",
  DDMMYYYY: "13022025",
  MMDDYYYY: "02132025",
  "DD MMM YYYY": "13 February 2025",
  "MMM DD, YYYY": "Feb 13, 2025",
};

describe("parseImportDate", () => {
  it.each(DATE_FORMAT_OPTIONS)("parses $value invariantly", ({ value }) => {
    const date = parseImportDate(samples[value], value);
    expect(toInvariantDate(date!)).toBe("2025-02-13");
    expect(toInvariantDateTime(date!)).toBe("2025-02-13T00:00:00.000Z");
  });

  it("uses the selected ordering for ambiguous dates", () => {
    expect(toInvariantDate(parseImportDate("01/02/2025", "DD/MM/YYYY")!)).toBe(
      "2025-02-01",
    );
    expect(toInvariantDate(parseImportDate("01/02/2025", "MM/DD/YYYY")!)).toBe(
      "2025-01-02",
    );
  });

  it("rejects invalid dates instead of allowing rollover", () => {
    expect(parseImportDate("31/02/2025", "DD/MM/YYYY")).toBeNull();
    expect(parseImportDate("02/13/2025", "DD/MM/YYYY")).toBeNull();
    expect(parseImportDate(undefined, "DD/MM/YYYY")).toBeNull();
  });

  it("validates persisted and AI-provided format values", () => {
    expect(isImportDateFormat("YYYY/MM/DD")).toBe(true);
    expect(isImportDateFormat("locale date")).toBe(false);
  });
});
