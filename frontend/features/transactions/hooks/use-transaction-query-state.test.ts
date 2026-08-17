import { describe, expect, it } from "vitest";
import { parseTransactionsSearchParamsFromUrlSearchParams } from "../public";
import { mergeTransactionQueryParams } from "./use-transaction-query-state";

describe("mergeTransactionQueryParams", () => {
  it("updates managed transaction state and preserves workflow parameters", () => {
    const current = new URLSearchParams("page=4&search=old&importing=job-1&tx=deep-link");
    const state = parseTransactionsSearchParamsFromUrlSearchParams(
      new URLSearchParams("page=1&search=new&sort=amount&order=asc")
    );

    const merged = mergeTransactionQueryParams(current, state);

    expect(merged.get("page")).toBeNull();
    expect(merged.get("search")).toBe("new");
    expect(merged.get("sort")).toBe("amount");
    expect(merged.get("importing")).toBe("job-1");
    expect(merged.get("tx")).toBe("deep-link");
  });
});
