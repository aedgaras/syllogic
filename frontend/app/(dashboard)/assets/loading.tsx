import { t as translate } from "@/i18n/translate";
import {
  HeaderSkeleton,
  CardGridSkeleton,
  DetailListSkeleton,
} from "@/components/skeletons/page-skeletons";

export default function Loading() {
  return (
    <>
      <HeaderSkeleton title={translate("assets")} />
      <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
        <CardGridSkeleton count={3} />
        <DetailListSkeleton rows={8} />
      </div>
    </>
  );
}
