"use client";
import { t as translate } from "@/i18n/translate";

import { useState } from "react";
import { RiPercentLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { AddInterestDialog } from "./add-interest-dialog";
import { MaskableAmount } from "@/components/hide-balances/maskable-amount";

interface AccruedInterestCardProps {
  accountId: string;
  currency: string;
  accruedInterest: number;
}

function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "EUR",
  }).format(value);
}

export function AccruedInterestCard({
  accountId,
  currency,
  accruedInterest,
}: AccruedInterestCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RiPercentLine className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm text-muted-foreground">
              {translate("accruedInterest")}
            </p>
            <p className="font-mono text-lg font-semibold">
              <MaskableAmount value={formatCurrency(accruedInterest, currency)} />
            </p>
          </div>
        </div>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          {translate("addInterest")}
        </Button>
      </div>
      <AddInterestDialog
        accountId={accountId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </>
  );
}
