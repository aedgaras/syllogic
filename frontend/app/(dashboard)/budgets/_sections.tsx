import { BudgetsClient } from "@/components/budgets/budgets-client";
import { getBudgetKpis, getBudgets } from "@/features/budgets/server";
import { getUserCategories } from "@/lib/actions/categories";

export async function BudgetsSection() {
  const [budgets, categories, kpis] = await Promise.all([
    getBudgets(),
    getUserCategories(),
    getBudgetKpis(),
  ]);

  return (
    <BudgetsClient
      initialBudgets={budgets}
      categories={categories}
      kpis={kpis}
    />
  );
}
