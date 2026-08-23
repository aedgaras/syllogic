import { describe, it, expect } from "vitest";
import {
  cn,
  normalizeDecimalInput,
  formatCurrency,
  formatAmount,
  formatDate,
} from "./utils";

describe("cn", () => {
  it("merges class names and dedupes conflicting Tailwind classes", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });
});

describe("normalizeDecimalInput", () => {
  it("converts a comma decimal separator to a dot", () => {
    expect(normalizeDecimalInput("12,34")).toBe("12.34");
  });

  it("leaves a dot decimal separator unchanged", () => {
    expect(normalizeDecimalInput("12.34")).toBe("12.34");
  });

  it("strips non-numeric characters", () => {
    expect(normalizeDecimalInput("€12,34abc")).toBe("12.34");
  });

  it("preserves a leading negative sign", () => {
    expect(normalizeDecimalInput("-12,34")).toBe("-12.34");
  });

  it("collapses multiple decimal points into one", () => {
    expect(normalizeDecimalInput("1.2.3")).toBe("1.23");
  });
});

describe("formatCurrency", () => {
  it("formats a positive value with no decimals by default", () => {
    expect(formatCurrency(1234, "USD")).toBe("$1,234");
  });

  it("formats absolute value by default (no sign) for negative input", () => {
    expect(formatCurrency(-1234, "USD")).toBe("$1,234");
  });

  it("prefixes a minus sign for negative values when showSign is true", () => {
    expect(formatCurrency(-1234, "USD", { showSign: true })).toBe("-$1,234");
  });

  it("respects fraction digit options", () => {
    expect(
      formatCurrency(1234.5, "USD", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    ).toBe("$1,234.50");
  });
});

describe("formatAmount", () => {
  const nlEur = (n: number) =>
    new Intl.NumberFormat("nl-NL", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);

  it("formats a positive amount with 2 decimals using nl-NL locale", () => {
    expect(formatAmount(1234.5, "EUR")).toBe(nlEur(1234.5));
  });

  it("prefixes a minus sign for negative amounts", () => {
    expect(formatAmount(-1234.5, "EUR")).toBe(`-${nlEur(1234.5)}`);
  });
});

describe("formatDate", () => {
  const date = new Date("2024-03-05T00:00:00.000Z");

  it("defaults to the medium preset", () => {
    expect(formatDate(date)).toBe("5 Mar 2024");
  });

  it("supports the short preset", () => {
    expect(formatDate(date, "short")).toBe("5 Mar");
  });

  it("supports the long preset", () => {
    expect(formatDate(date, "long")).toBe("5 March 2024");
  });

  it("supports explicit Intl.DateTimeFormatOptions", () => {
    expect(formatDate(date, { year: "numeric" })).toBe("2024");
  });
});
