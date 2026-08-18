import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { getBudgetDetail } from "@/features/budgets/server";
import { BudgetDetailView } from "@/components/budgets/budget-detail-view";

export default async function BudgetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const budget = await getBudgetDetail(id);
  if (!budget) return notFound();

  return (
    <>
      <Header title={budget.name} />
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <BudgetDetailView budget={budget} />
      </div>
    </>
  );
}
