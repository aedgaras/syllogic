import { t as translate } from "@/i18n/translate";
import { HeaderSkeleton, CardGridSkeleton, DetailListSkeleton } from "@/components/skeletons/page-skeletons";

export default function Loading() {
  return (
    <>
      <HeaderSkeleton title={translate("subscriptions")} />
      <div className="flex min-h-[calc(100vh-4rem)] flex-col gap-4 p-4">
        <CardGridSkeleton count={4} />
        <DetailListSkeleton rows={8} />
      </div>
    </>
  );
}
