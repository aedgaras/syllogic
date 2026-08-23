import { describe, it, expect } from "vitest";
import {
  parseAccountParams,
  parseGlobalFiltersFromSearchParams,
  parseGlobalFiltersFromQueryString,
  hasGlobalFilters,
  toGlobalFilterSearchParams,
  getGlobalFilterQueryString,
  normalizeGlobalFilterQueryString,
  resolveGlobalFilterQueryString,
} from "./global-filters";

describe("parseAccountParams", () => {
  it("dedupes, trims, and drops empty/'all' values", () => {
    const params = new URLSearchParams(
      "account=a1,a2& account=a2&account=all&account= &account=a3",
    );
    expect(parseAccountParams(params).sort()).toEqual(["a1", "a2", "a3"]);
  });

  it("returns an empty array when there are no account params", () => {
    expect(parseAccountParams(new URLSearchParams())).toEqual([]);
  });
});

describe("parseGlobalFiltersFromSearchParams", () => {
  it("parses accountIds, from, and to", () => {
    const params = new URLSearchParams("account=a1&from=2024-01-01&to=2024-01-31");
    expect(parseGlobalFiltersFromSearchParams(params)).toEqual({
      accountIds: ["a1"],
      from: "2024-01-01",
      to: "2024-01-31",
      horizon: undefined,
    });
  });

  it("parses horizon only when from is absent", () => {
    const params = new URLSearchParams("horizon=90d");
    expect(parseGlobalFiltersFromSearchParams(params).horizon).toBe("90d");
  });

  it("ignores horizon when from is present", () => {
    const params = new URLSearchParams("from=2024-01-01&horizon=90d");
    expect(parseGlobalFiltersFromSearchParams(params).horizon).toBeUndefined();
  });
});

describe("hasGlobalFilters", () => {
  it("is false for an empty filter set", () => {
    expect(hasGlobalFilters({ accountIds: [] })).toBe(false);
  });

  it("is true when any field is set", () => {
    expect(hasGlobalFilters({ accountIds: ["a1"] })).toBe(true);
    expect(hasGlobalFilters({ accountIds: [], from: "2024-01-01" })).toBe(true);
    expect(hasGlobalFilters({ accountIds: [], horizon: "30d" })).toBe(true);
  });
});

describe("toGlobalFilterSearchParams / getGlobalFilterQueryString", () => {
  it("serializes account ids as repeated params", () => {
    const qs = getGlobalFilterQueryString({ accountIds: ["a1", "a2"] });
    expect(qs).toBe("account=a1&account=a2");
  });

  it("includes to only when from is also set", () => {
    const withoutFrom = toGlobalFilterSearchParams({
      accountIds: [],
      to: "2024-01-31",
    });
    expect(withoutFrom.has("to")).toBe(false);

    const withFrom = toGlobalFilterSearchParams({
      accountIds: [],
      from: "2024-01-01",
      to: "2024-01-31",
    });
    expect(withFrom.get("to")).toBe("2024-01-31");
  });

  it("falls back to horizon when from is absent", () => {
    const qs = getGlobalFilterQueryString({ accountIds: [], horizon: "90d" });
    expect(qs).toBe("horizon=90d");
  });

  it("prefers from/to over horizon when both are present", () => {
    const qs = getGlobalFilterQueryString({
      accountIds: [],
      from: "2024-01-01",
      horizon: "90d",
    });
    expect(qs).toBe("from=2024-01-01");
  });
});

describe("parseGlobalFiltersFromQueryString", () => {
  it("accepts a query string with or without a leading ?", () => {
    const a = parseGlobalFiltersFromQueryString("?account=a1");
    const b = parseGlobalFiltersFromQueryString("account=a1");
    expect(a).toEqual(b);
    expect(a.accountIds).toEqual(["a1"]);
  });
});

describe("normalizeGlobalFilterQueryString", () => {
  it("returns an empty string for null/undefined/empty input", () => {
    expect(normalizeGlobalFilterQueryString(null)).toBe("");
    expect(normalizeGlobalFilterQueryString(undefined)).toBe("");
    expect(normalizeGlobalFilterQueryString("")).toBe("");
  });

  it("round-trips a valid query string through parse + serialize", () => {
    expect(normalizeGlobalFilterQueryString("account=a1&account=a2")).toBe(
      "account=a1&account=a2",
    );
  });
});

describe("resolveGlobalFilterQueryString", () => {
  it("prefers the current query string when it carries filters", () => {
    expect(
      resolveGlobalFilterQueryString("account=a1", "account=a2"),
    ).toBe("account=a1");
  });

  it("falls back to the stored query string when current has no filters", () => {
    expect(resolveGlobalFilterQueryString("", "account=a2")).toBe(
      "account=a2",
    );
  });

  it("returns an empty string when neither has filters", () => {
    expect(resolveGlobalFilterQueryString("", null)).toBe("");
  });
});
