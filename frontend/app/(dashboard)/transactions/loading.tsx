import { t as translate } from "@/i18n/translate";
import {
  HeaderSkeleton,
  FiltersSkeleton,
  TableSkeleton,
} from "@/components/skeletons/page-skeletons";

export default function Loading() {
  return (
    <>
      <HeaderSkeleton title={translate("transactions")} />
      <div className="flex h-[calc(100vh-4rem)] flex-col gap-4 p-4 pt-0">
        <FiltersSkeleton />
        <TableSkeleton rows={14} />
      </div>
    </>
  );
}
