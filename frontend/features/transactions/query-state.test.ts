import { describe, expect, it } from "vitest";
import {
  applyTransactionsQueryPatch,
  parseTransactionsSearchParams,
  toTransactionsSearchParams,
} from "./query-state";

describe("transaction query state", () => {
  it("normalizes paging, duplicate filters, dates, and sort values", () => {
    expect(
      parseTransactionsSearchParams({
        page: "0",
        pageSize: "500",
        category: ["food,food", "travel"],
        from: "2026-04-10",
        to: "2026-04-01",
        horizon: "90",
        sort: "unknown",
      }),
    ).toMatchObject({
      page: 1,
      pageSize: 100,
      category: ["food", "travel"],
      from: "2026-04-10",
      to: undefined,
      horizon: undefined,
      sort: "bookedAt",
      order: "desc",
    });
  });

  it("serializes only non-default values and applies a typed patch", () => {
    const initial = new URLSearchParams(
      "page=2&search=coffee&importing=import-1",
    );
    const patched = applyTransactionsQueryPatch(initial, {
      page: 3,
      order: "asc",
    });
    expect(patched.get("page")).toBe("3");
    expect(patched.get("search")).toBe("coffee");
    // Query-state owns only transaction filters; workflow parameters are merged by orchestration.
    expect(patched.has("importing")).toBe(false);
    expect(
      toTransactionsSearchParams(parseTransactionsSearchParams({})).toString(),
    ).toBe("");
  });
});
