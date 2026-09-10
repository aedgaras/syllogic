import { describe, it, expect } from "vitest";
import { rollUpCategorySpendingByGroup } from "./rollup";
import type { CategorySpendingCategory } from "@/lib/actions/category-spending";

function row(
  overrides: Partial<CategorySpendingCategory> &
    Pick<CategorySpendingCategory, "id" | "name" | "amount">,
): CategorySpendingCategory {
  return {
    color: "#111111",
    icon: null,
    fill: "#111111",
    sharePct: 0,
    deltaAmount: 0,
    deltaPct: 0,
    averageMonthlyAmount: 0,
    ...overrides,
  };
}

const categories = [
  { id: "needs", name: "Needs", color: "#0F766E", parentId: null },
  { id: "groceries", name: "Groceries", color: "#111111", parentId: "needs" },
  { id: "rent", name: "Rent", color: "#222222", parentId: "needs" },
  { id: "misc", name: "Misc", color: "#333333", parentId: null },
];

describe("rollUpCategorySpendingByGroup", () => {
  it("sums a group's members into one row and keeps the group's identity", () => {
    const sections = rollUpCategorySpendingByGroup(
      [
        row({
          id: "groceries",
          name: "Groceries",
          amount: 300,
          sharePct: 30,
          averageMonthlyAmount: 100,
        }),
        row({
          id: "rent",
          name: "Rent",
          amount: 500,
          sharePct: 50,
          averageMonthlyAmount: 250,
        }),
        row({ id: "misc", name: "Misc", amount: 200, sharePct: 20 }),
      ],
      categories,
    );

    expect(sections.map((s) => s.row.id)).toEqual(["needs", "misc"]);

    const needs = sections[0];
    expect(needs.isGroup).toBe(true);
    expect(needs.row.name).toBe("Needs");
    expect(needs.row.fill).toBe("#0F766E");
    expect(needs.row.amount).toBe(800);
    expect(needs.row.sharePct).toBe(80);
    expect(needs.row.averageMonthlyAmount).toBe(350);
    expect(needs.memberIds).toEqual(["groceries", "rent"]);
  });

  it("recomputes a group's delta percentage from its summed members", () => {
    const [needs] = rollUpCategorySpendingByGroup(
      [
        row({
          id: "groceries",
          name: "Groceries",
          amount: 300,
          deltaAmount: 50,
        }),
        row({ id: "rent", name: "Rent", amount: 500, deltaAmount: 50 }),
      ],
      categories,
    );

    // previous = 800 - 100
    expect(needs.row.deltaAmount).toBe(100);
    expect(needs.row.deltaPct).toBeCloseTo(14.2857, 3);
  });

  it("leaves ungrouped categories untouched", () => {
    const sections = rollUpCategorySpendingByGroup(
      [row({ id: "misc", name: "Misc", amount: 200, deltaPct: 12 })],
      categories,
    );

    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ isGroup: false, memberIds: ["misc"] });
    expect(sections[0].row.deltaPct).toBe(12);
  });

  it("keeps a category whose group is unknown on its own row", () => {
    const sections = rollUpCategorySpendingByGroup(
      [row({ id: "orphan", name: "Orphan", amount: 10 })],
      categories,
    );

    expect(sections.map((s) => s.row.id)).toEqual(["orphan"]);
  });
});
