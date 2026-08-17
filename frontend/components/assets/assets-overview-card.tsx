"use client";
import { t as translate } from "@/i18n/translate";


import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { AssetsStackedBar } from "./assets-stacked-bar";
import { AssetsTable } from "./assets-table";
import { AddAssetDialog } from "./add-asset-dialog";
import type { AssetsOverviewData } from "./types";

interface AssetsOverviewCardProps {
  data: AssetsOverviewData;
}

export function AssetsOverviewCard({ data }: AssetsOverviewCardProps) {
  const router = useRouter();

  const handleAssetAdded = () => {
    router.refresh();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <CardTitle>{translate("assetsOverview")}</CardTitle>
            <AddAssetDialog onAssetAdded={handleAssetAdded} />
          </div>
          <span className="break-words text-xl font-bold sm:text-2xl">
            {formatCurrency(data.total, data.currency)}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <AssetsStackedBar categories={data.categories} total={data.total} />
        <AssetsTable categories={data.categories} currency={data.currency} />
      </CardContent>
    </Card>
  );
}
