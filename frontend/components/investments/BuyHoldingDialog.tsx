"use client";
import { t as translate } from "@/i18n/translate";

import { useMemo, useState } from "react";
import { buyHolding, type Holding, type SymbolSearchResult } from "@/lib/api/investments";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { normalizeDecimalInput } from "@/lib/utils";
import { SymbolSearchInput } from "./SymbolSearchInput";
import { Field, Input } from "./_form-bits";

type Inst = "etf" | "equity";

export function BuyHoldingDialog({
  open,
  onOpenChange,
  accountId,
  cashHoldings,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  cashHoldings: Holding[];
  onDone: () => void;
}) {
  const [currency, setCurrency] = useState(cashHoldings[0]?.currency ?? "EUR");
  const [symbol, setSymbol] = useState("");
  const [providerSymbol, setProviderSymbol] = useState("");
  const [instrumentType, setInstrumentType] = useState<Inst>("etf");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const availableCash = useMemo(
    () => cashHoldings.find((h) => h.currency === currency)?.quantity ?? "0",
    [cashHoldings, currency],
  );

  const total = useMemo(() => {
    const q = Number.parseFloat(qty);
    const p = Number.parseFloat(price);
    return Number.isFinite(q) && Number.isFinite(p) ? q * p : null;
  }, [qty, price]);

  const overBudget =
    total !== null && Number.isFinite(Number(availableCash))
      ? total > Number(availableCash)
      : false;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!symbol.trim() || !qty.trim() || !price.trim()) {
      setErr("Add a symbol, quantity, and price.");
      return;
    }
    setBusy(true);
    try {
      await buyHolding(accountId, {
        symbol: symbol.trim(),
        quantity: qty,
        instrument_type: instrumentType,
        currency,
        price,
        provider_symbol: providerSymbol || undefined,
      });
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
          <DialogTitle>{translate("buy")}</DialogTitle>
          <DialogDescription>
            {translate("buyUsingCashHeldInThisInvestmentAccount")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label={translate("currency")}>
            <Select value={currency} onValueChange={(v) => v && setCurrency(v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {cashHoldings.map((h) => (
                  <SelectItem key={h.currency} value={h.currency}>
                    {h.currency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {translate("availableCash")}: {availableCash} {currency}
            </p>
          </Field>

          <Field label={translate("symbol")}>
            <SymbolSearchInput
              value={symbol}
              onChange={setSymbol}
              onSelect={(r: SymbolSearchResult) => {
                setSymbol(r.symbol);
                if (r.currency) setCurrency(r.currency);
              }}
              placeholder={translate("searchSymbolOrName")}
            />
          </Field>

          <Field label={translate("instrumentType")}>
            <ToggleGroup
              multiple={false}
              value={[instrumentType]}
              onValueChange={(v) => v[0] && setInstrumentType(v[0] as Inst)}
              variant="outline"
              size="sm"
            >
              {(["etf", "equity"] as Inst[]).map((t) => (
                <ToggleGroupItem key={t} value={t} className="capitalize flex-1">
                  {t === "etf" ? translate("etf") : t}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>

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

          {total !== null && (
            <p className={`text-xs ${overBudget ? "text-destructive" : "text-muted-foreground"}`}>
              {translate("totalCost")}: {total.toFixed(2)} {currency}
              {overBudget ? ` — ${translate("exceedsAvailableCash")}` : ""}
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
            <Button type="submit" disabled={busy || cashHoldings.length === 0}>
              {busy ? translate("buying") : translate("buy")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
