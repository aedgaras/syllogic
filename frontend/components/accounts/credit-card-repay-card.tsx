"use client";
import { t as translate } from "@/i18n/translate";

import { useState } from "react";
import { RiBankCardLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { RepayCreditCardDialog } from "./repay-credit-card-dialog";
import { MaskableAmount } from "@/components/hide-balances/maskable-amount";

interface CreditCardRepayCardProps {
  accountId: string;
  currency: string;
  functionalBalance: number;
}

function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "EUR",
  }).format(value);
}

export function CreditCardRepayCard({
  accountId,
  currency,
  functionalBalance,
}: CreditCardRepayCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const outstandingBalance = Math.max(0, -functionalBalance);

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RiBankCardLine className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm text-muted-foreground">
              {translate("outstandingBalance")}
            </p>
            <p className="font-mono text-lg font-semibold">
              <MaskableAmount value={formatCurrency(outstandingBalance, currency)} />
            </p>
          </div>
        </div>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          {translate("repay")}
        </Button>
      </div>
      <RepayCreditCardDialog
        creditCardAccountId={accountId}
        currency={currency}
        outstandingBalance={outstandingBalance}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </>
  );
}
