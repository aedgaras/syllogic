import { t as translate } from "@/i18n/translate";
import { Suspense } from "react";
import { Header } from "@/components/layout/header";
import {
  CardGridSkeleton,
  DetailListSkeleton,
} from "@/components/skeletons/page-skeletons";
import { BudgetsSection } from "./_sections";

export default function BudgetsPage() {
  return (
    <>
      <Header title={translate("budgets")} />
      <div className="flex min-h-[calc(100vh-4rem)] flex-col gap-4 p-4 pt-0">
        <Suspense
          fallback={
            <>
              <CardGridSkeleton count={4} />
              <DetailListSkeleton rows={8} />
            </>
          }
        >
          <BudgetsSection />
        </Suspense>
      </div>
    </>
  );
}
