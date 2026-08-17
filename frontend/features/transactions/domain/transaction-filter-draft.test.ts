import { describe, expect, it } from "vitest";
import {
  normalizeTransactionFilterDraft,
  transactionFilterDraftReducer,
} from "./transaction-filter-draft";

describe("transactionFilterDraft", () => {
  it("normalizes blank fields at the URL boundary", () => {
    expect(
      normalizeTransactionFilterDraft({
        search: " coffee ",
        minAmount: " ",
        maxAmount: "25",
      }),
    ).toEqual({ search: "coffee", minAmount: undefined, maxAmount: "25" });
  });

  it("updates one draft field without changing the others", () => {
    expect(
      transactionFilterDraftReducer(
        { search: "", minAmount: "10", maxAmount: "20" },
        { type: "edit", field: "minAmount", value: "15" },
      ),
    ).toEqual({ search: "", minAmount: "15", maxAmount: "20" });
  });
});
