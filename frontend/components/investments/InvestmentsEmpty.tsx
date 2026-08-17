"use client";
import { t as translate } from "@/i18n/translate";

import { useRouter } from "next/navigation";
import {
  RiAddLine,
  RiLineChartLine,
  RiLinksLine,
  RiPencilLine,
} from "@remixicon/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function InvestmentsEmpty({
  isDemoRestricted = false,
}: {
  isDemoRestricted?: boolean;
}) {
  const router = useRouter();
  const go = () => router.push("/investments/connect");

  if (isDemoRestricted) {
    return (
      <div className="flex-1 flex items-center justify-center p-10">
        <div className="max-w-xl w-full">
          <Card className="rounded-none">
            <CardContent className="px-8 py-10 flex flex-col items-center text-center gap-3">
              <div className="w-11 h-11 border border-border flex items-center justify-center bg-muted/40">
                <RiLineChartLine size={20} className="text-muted-foreground" />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="text-base font-semibold">{translate("noHoldingsYet")}</div>
                <div className="text-xs text-muted-foreground leading-relaxed max-w-[340px]">
                  {translate("connectingBrokersAndAddingHoldingsIsDisabledForThe")}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex items-center justify-center p-10">
      <div className="max-w-xl w-full flex flex-col">
        <Card className="rounded-none">
          <CardContent className="px-8 pt-8 pb-6 flex flex-col items-center text-center gap-3">
            <div className="w-11 h-11 border border-border flex items-center justify-center bg-muted/40">
              <RiLineChartLine size={20} className="text-muted-foreground" />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="text-base font-semibold">{translate("noHoldingsYet")}</div>
              <div className="text-xs text-muted-foreground leading-relaxed max-w-[340px]">
                {translate("trackYourPortfolioByConnectingABrokerForAutomatic")}
              </div>
            </div>
          </CardContent>
        </Card>
        <div className="grid grid-cols-2 border border-t-0 border-border">
          <div className="p-6 flex flex-col gap-3 border-r border-border">
            <div className="flex items-center gap-2">
              <RiLinksLine size={16} />
              <span className="font-semibold text-sm">{translate("connectBroker")}</span>
              <Badge className="ml-auto text-[9px] tracking-wider rounded-none">
                {translate("recommended")}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground leading-relaxed">
              {translate("connectInteractiveBrokersViaFlexQueryPositionsAndTrades")}
            </div>
            <ul className="mt-1 pl-4 list-disc space-y-1">
              {[
                translate("automaticPositionSync"),
                translate("tradeHistoryImported"),
                translate("noManualEntryNeeded"),
              ].map((t) => (
                <li key={t} className="text-xs text-muted-foreground">
                  {t}
                </li>
              ))}
            </ul>
            <Button onClick={go} className="mt-1 w-full">
              <RiLinksLine size={13} /> {translate("connectIbkr")}
            </Button>
          </div>
          <div className="p-6 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <RiPencilLine size={16} />
              <span className="font-semibold text-sm">{translate("addManually")}</span>
            </div>
            <div className="text-xs text-muted-foreground leading-relaxed">
              {translate("createAnAccountSearchBySymbolAndEnterQuantities")}
            </div>
            <ul className="mt-1 pl-4 list-disc space-y-1">
              {[
                translate("noBrokerNeeded"),
                translate("pricesUpdatedDaily"),
                translate("youManageQuantities"),
              ].map((t) => (
                <li key={t} className="text-xs text-muted-foreground">
                  {t}
                </li>
              ))}
            </ul>
            <Button onClick={go} variant="outline" className="mt-1 w-full">
              <RiAddLine size={13} /> {translate("addHolding")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
