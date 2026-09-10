import { BudgetManagement } from "@/features/budgets/public";
import { getBudgetKpis, getBudgets } from "@/features/budgets/server";
import { getUserCategories } from "@/lib/actions/categories";
import { filterSelectableCategories } from "@/lib/utils/category-utils";

export async function BudgetsSection() {
  const [budgets, categories, kpis] = await Promise.all([
    getBudgets(),
    getUserCategories(),
    getBudgetKpis(),
  ]);

  return (
    <BudgetManagement
      initialBudgets={budgets}
      categories={filterSelectableCategories(categories)}
      kpis={kpis}
    />
  );
}
