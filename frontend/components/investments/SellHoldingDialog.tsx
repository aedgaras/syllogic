"use client";
import { t as translate } from "@/i18n/translate";

import { useMemo, useState } from "react";
import { sellHolding, type Holding } from "@/lib/api/investments";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { normalizeDecimalInput } from "@/lib/utils";
import { Field, Input } from "./_form-bits";

export function SellHoldingDialog({
  open,
  onOpenChange,
  holding,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  holding: Holding;
  onDone: () => void;
}) {
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState(holding.current_price ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const proceeds = useMemo(() => {
    const q = Number.parseFloat(qty);
    const p = Number.parseFloat(price);
    return Number.isFinite(q) && Number.isFinite(p) ? q * p : null;
  }, [qty, price]);

  const overSell = Number.parseFloat(qty || "0") > Number(holding.quantity);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!qty.trim() || !price.trim()) {
      setErr("Add a quantity and price.");
      return;
    }
    setBusy(true);
    try {
      await sellHolding(holding.id, { quantity: qty, price });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {translate("sell")} {holding.symbol}
          </DialogTitle>
          <DialogDescription>
            {translate("sellCreditsTheProceedsBackToCashInThisInvestmentAccount")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {translate("qty")}: {holding.quantity} {holding.symbol}
          </p>
          <div className="flex gap-3">
            <Field label={translate("quantity")} className="flex-1">
              <Input
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={qty}
                onChange={(e) => setQty(normalizeDecimalInput(e.target.value))}
              />
            </Field>
            <Field label={translate("pricePerUnit")} className="flex-1">
              <Input
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={price}
                onChange={(e) => setPrice(normalizeDecimalInput(e.target.value))}
              />
            </Field>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setQty(String(holding.quantity))}
          >
            {translate("sellAll")}
          </Button>

          {proceeds !== null && (
            <p className={`text-xs ${overSell ? "text-destructive" : "text-muted-foreground"}`}>
              {translate("totalProceeds")}: {proceeds.toFixed(2)} {holding.currency}
              {overSell ? ` — ${translate("exceedsHeldQuantity")}` : ""}
            </p>
          )}

          {err && <p className="text-xs text-destructive">{err}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              {translate("cancel")}
            </Button>
            <Button type="submit" variant="destructive" disabled={busy}>
              {busy ? translate("selling") : translate("sell")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
