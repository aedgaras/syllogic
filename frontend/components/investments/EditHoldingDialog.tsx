"use client";
import { t as translate } from "@/i18n/translate";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateHolding, type Holding } from "@/lib/api/investments";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeDecimalInput } from "@/lib/utils";
import { SymbolSearchInput } from "./SymbolSearchInput";
import type { SymbolSearchResult } from "@/lib/api/investments";

export function EditHoldingDialog({
  open,
  onOpenChange,
  holding,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  holding: Holding;
}) {
  const router = useRouter();
  const [symbol, setSymbol] = useState(holding.symbol);
  const [qty, setQty] = useState(holding.quantity);
  const [avgCost, setAvgCost] = useState(holding.avg_cost ?? "");
  const [asOfDate, setAsOfDate] = useState(holding.as_of_date ?? "");
  const [providerSymbol, setProviderSymbol] = useState(
    holding.provider_symbol ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await updateHolding(holding.id, {
        ...(symbol !== holding.symbol ? { symbol } : {}),
        quantity: qty,
        avg_cost: avgCost === "" ? null : avgCost,
        as_of_date: asOfDate === "" ? null : asOfDate,
        provider_symbol: providerSymbol === "" ? null : providerSymbol,
      });
      onOpenChange(false);
      router.refresh();
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
            {translate("editHolding")} {holding.symbol}
          </DialogTitle>
          <DialogDescription>
            {translate(
              "manualHoldingsOnlyConnectedBrokerPositionsSyncAutomatically",
            )}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="symbol">{translate("symbol")}</Label>
            <SymbolSearchInput
              id="symbol"
              value={symbol}
              onChange={setSymbol}
              onSelect={(r: SymbolSearchResult) => setSymbol(r.symbol)}
            />
            <p className="text-xs text-muted-foreground">
              {translate("changingTheSymbolTriggersAnAutomaticRePricingOn")}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="qty">{translate("quantity")}</Label>
            <Input
              id="qty"
              type="number"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="avg-cost">
              {translate("avgCost")}{" "}
              <span className="text-muted-foreground">
                {translate("optional")}
              </span>
            </Label>
            <Input
              id="avg-cost"
              type="text"
              inputMode="decimal"
              value={avgCost}
              onChange={(e) => setAvgCost(normalizeDecimalInput(e.target.value))}
              placeholder="—"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="as-of">
              {translate("asOfDate")}{" "}
              <span className="text-muted-foreground">
                {translate("optional")}
              </span>
            </Label>
            <Input
              id="as-of"
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="provider-symbol">
              {translate("priceLookupSymbol")}{" "}
              <span className="text-muted-foreground">
                {translate("optional")}
              </span>
            </Label>
            <SymbolSearchInput
              id="provider-symbol"
              value={providerSymbol}
              onChange={setProviderSymbol}
              onSelect={(r: SymbolSearchResult) => setProviderSymbol(r.symbol)}
              placeholder={translate("eGLonOrAs", {
                value1: holding.symbol,
                value2: holding.symbol,
              })}
            />
            <p className="text-xs text-muted-foreground">
              {translate("overrideTheTickerUsedForPriceLookupsUsefulFor")}
            </p>
          </div>
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
            <Button type="submit" disabled={busy}>
              {busy ? translate("saving56a228") : translate("saveChanges")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
