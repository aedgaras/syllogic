import { t as translate } from "@/i18n/translate";
import {
  HeaderSkeleton,
  FiltersSkeleton,
  ChartSkeleton,
  TableSkeleton,
} from "@/components/skeletons/page-skeletons";

export default function Loading() {
  return (
    <>
      <HeaderSkeleton title={translate("categorySpending")} />
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <FiltersSkeleton />
        <ChartSkeleton height={360} />
        <TableSkeleton rows={10} />
      </div>
    </>
  );
}
