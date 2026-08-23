import { describe, it, expect } from "vitest";
import {
  filterSelectableCategories,
  filterCategoriesByType,
  groupCategoriesByType,
  getCategoriesForTransactionType,
  getCategoryTypeLabel,
} from "./category-utils";

const categories = [
  { id: "1", categoryType: "expense", hideFromSelection: false },
  { id: "2", categoryType: "income", hideFromSelection: false },
  { id: "3", categoryType: "transfer", hideFromSelection: true },
  { id: "4", categoryType: "expense", hideFromSelection: null },
];

describe("filterSelectableCategories", () => {
  it("drops categories flagged as hidden from selection", () => {
    expect(filterSelectableCategories(categories).map((c) => c.id)).toEqual([
      "1",
      "2",
      "4",
    ]);
  });
});

describe("filterCategoriesByType", () => {
  it("keeps only categories matching the given type", () => {
    expect(
      filterCategoriesByType(categories, "expense").map((c) => c.id),
    ).toEqual(["1", "4"]);
  });
});

describe("groupCategoriesByType", () => {
  it("buckets categories by expense/income/transfer", () => {
    const grouped = groupCategoriesByType(categories);
    expect(grouped.expense.map((c) => c.id)).toEqual(["1", "4"]);
    expect(grouped.income.map((c) => c.id)).toEqual(["2"]);
    expect(grouped.transfer.map((c) => c.id)).toEqual(["3"]);
  });
});

describe("getCategoriesForTransactionType", () => {
  it("returns expense + transfer categories for debits, excluding hidden ones", () => {
    expect(
      getCategoriesForTransactionType(categories, "debit").map((c) => c.id),
    ).toEqual(["1", "4"]);
  });

  it("returns income + transfer categories for credits, excluding hidden ones", () => {
    expect(
      getCategoriesForTransactionType(categories, "credit").map((c) => c.id),
    ).toEqual(["2"]);
  });
});

describe("getCategoryTypeLabel", () => {
  it("maps each category type to its human-readable label", () => {
    expect(getCategoryTypeLabel("expense")).toBe("Expense");
    expect(getCategoryTypeLabel("income")).toBe("Income");
    expect(getCategoryTypeLabel("transfer")).toBe("Transfer");
  });
});
