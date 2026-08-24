"use client";
import { t as translate } from "@/i18n/translate";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Holding } from "@/lib/api/investments";
import { HoldingsTable } from "./HoldingsTable";
import { BuyHoldingDialog } from "./BuyHoldingDialog";
import { SellHoldingDialog } from "./SellHoldingDialog";
import { Button } from "@/components/ui/button";

export function InvestmentHoldingsSection({
  accountId,
  holdings,
}: {
  accountId: string;
  holdings: Holding[];
}) {
  const router = useRouter();
  const [buyOpen, setBuyOpen] = useState(false);
  const [sellTarget, setSellTarget] = useState<Holding | null>(null);

  const cashHoldings = holdings.filter((h) => h.instrument_type === "cash");

  const refresh = () => router.refresh();

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-medium">{translate("holdings")}</h2>
        <Button
          size="sm"
          onClick={() => setBuyOpen(true)}
          disabled={cashHoldings.length === 0}
        >
          {translate("buy")}
        </Button>
      </div>
      <HoldingsTable holdings={holdings} onSell={setSellTarget} />

      <BuyHoldingDialog
        open={buyOpen}
        onOpenChange={setBuyOpen}
        accountId={accountId}
        cashHoldings={cashHoldings}
        onDone={() => {
          setBuyOpen(false);
          refresh();
        }}
      />

      {sellTarget && (
        <SellHoldingDialog
          open={!!sellTarget}
          onOpenChange={(o) => !o && setSellTarget(null)}
          holding={sellTarget}
          onDone={() => {
            setSellTarget(null);
            refresh();
          }}
        />
      )}
    </>
  );
}
