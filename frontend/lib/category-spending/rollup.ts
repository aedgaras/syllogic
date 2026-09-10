import type { CategorySpendingCategory } from "@/lib/actions/category-spending";

export interface CategoryGroupShape {
  id: string;
  name: string;
  color?: string | null;
  parentId?: string | null;
}

export interface CategorySpendingSection {
  /** Aggregated row: a group's total, or an ungrouped category as-is. */
  row: CategorySpendingCategory;
  /** Spending rows folded into this one - what a click should select. */
  memberIds: string[];
  isGroup: boolean;
}

/**
 * Fold per-category spending into its group ("Needs", "Wants", ...).
 * Categories without a group stay on their own row. Shares and deltas are
 * summed from the members, so the rolled-up totals still add up to the
 * period total the backend reported.
 */
export function rollUpCategorySpendingByGroup(
  rows: CategorySpendingCategory[],
  categories: CategoryGroupShape[],
): CategorySpendingSection[] {
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  const sections = new Map<string, CategorySpendingSection>();

  for (const row of rows) {
    const parentId = categoryById.get(row.id)?.parentId ?? null;
    const group = parentId ? categoryById.get(parentId) : undefined;

    if (!group) {
      sections.set(row.id, {
        row: { ...row },
        memberIds: [row.id],
        isGroup: false,
      });
      continue;
    }

    const existing = sections.get(group.id);
    if (!existing) {
      sections.set(group.id, {
        row: {
          ...row,
          id: group.id,
          name: group.name,
          color: group.color ?? row.color,
          fill: group.color ?? row.fill,
        },
        memberIds: [row.id],
        isGroup: true,
      });
      continue;
    }

    existing.row.amount += row.amount;
    existing.row.sharePct += row.sharePct;
    existing.row.deltaAmount += row.deltaAmount;
    existing.row.averageMonthlyAmount += row.averageMonthlyAmount;
    existing.memberIds.push(row.id);
  }

  return [...sections.values()]
    .map((section) => {
      if (!section.isGroup) return section;
      const previous = section.row.amount - section.row.deltaAmount;
      return {
        ...section,
        row: {
          ...section.row,
          deltaPct:
            previous === 0 ? 0 : (section.row.deltaAmount / previous) * 100,
        },
      };
    })
    .sort((a, b) => b.row.amount - a.row.amount);
}
