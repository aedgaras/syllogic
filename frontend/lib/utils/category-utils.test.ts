import { describe, it, expect } from "vitest";
import {
  filterSelectableCategories,
  filterCategoriesByType,
  groupCategoriesByType,
  getCategoriesForTransactionType,
  getCategoryTypeLabel,
  isCategoryGroup,
  splitCategoriesIntoSections,
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

const needs = {
  id: "g1",
  parentId: null,
  hideFromSelection: true,
  systemKey: "group_needs",
};
const emptyCustomGroup = {
  id: "g2",
  parentId: null,
  hideFromSelection: true,
  systemKey: null,
};
const groceries = {
  id: "c1",
  parentId: "g1",
  hideFromSelection: false,
  systemKey: null,
};
const loose = {
  id: "c2",
  parentId: null,
  hideFromSelection: false,
  systemKey: null,
};
const balancingTransfer = {
  id: "c3",
  parentId: null,
  hideFromSelection: true,
  systemKey: "balancing_transfer",
};

describe("isCategoryGroup", () => {
  it("treats a hidden top-level row with a group systemKey as a group", () => {
    expect(isCategoryGroup(needs)).toBe(true);
  });

  it("treats a hidden top-level row without a systemKey as a group", () => {
    expect(isCategoryGroup(emptyCustomGroup)).toBe(true);
  });

  it("does not treat other hidden system rows as groups", () => {
    expect(isCategoryGroup(balancingTransfer)).toBe(false);
  });

  it("treats any row that has children as a group", () => {
    expect(
      isCategoryGroup(balancingTransfer, [
        balancingTransfer,
        { ...groceries, parentId: "c3" },
      ]),
    ).toBe(true);
  });

  it("never treats a nested category as a group", () => {
    expect(isCategoryGroup(groceries, [needs, groceries])).toBe(false);
  });
});

describe("splitCategoriesIntoSections", () => {
  it("nests categories under their group and collects the rest", () => {
    const sections = splitCategoriesIntoSections([
      needs,
      groceries,
      loose,
      balancingTransfer,
    ]);

    expect(sections).toHaveLength(2);
    expect(sections[0].group?.id).toBe("g1");
    expect(sections[0].categories.map((c) => c.id)).toEqual(["c1"]);
    expect(sections[1].group).toBeNull();
    expect(sections[1].categories.map((c) => c.id)).toEqual(["c2", "c3"]);
  });

  it("keeps empty groups and omits an empty ungrouped bucket", () => {
    const sections = splitCategoriesIntoSections([needs, groceries]);

    expect(sections).toHaveLength(1);
    expect(sections[0].group?.id).toBe("g1");
  });

  it("keeps a category whose group is missing in the ungrouped bucket", () => {
    const sections = splitCategoriesIntoSections([groceries]);

    expect(sections).toEqual([{ group: null, categories: [groceries] }]);
  });
});
