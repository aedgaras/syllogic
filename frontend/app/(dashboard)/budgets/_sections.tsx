import { BudgetManagement } from "@/features/budgets/public";
import { getBudgetKpis, getBudgets } from "@/features/budgets/server";
import { getUserCategories } from "@/lib/actions/categories";

export async function BudgetsSection() {
  const [budgets, categories, kpis] = await Promise.all([
    getBudgets(),
    getUserCategories(),
    getBudgetKpis(),
  ]);

  return (
    <BudgetManagement
      initialBudgets={budgets}
      categories={categories}
      kpis={kpis}
    />
  );
}
