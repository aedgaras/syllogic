"use client";
import { t as translate } from "@/i18n/translate";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  RiBankLine,
  RiExternalLinkLine,
  RiEyeLine,
  RiEyeOffLine,
  RiRefreshLine,
} from "@remixicon/react";
import { createBrokerConnection } from "@/lib/api/investments";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field, Input } from "./_form-bits";

export function BrokerForm({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const [accountName, setAccountName] = useState("IBKR Main");
  const [baseCurrency, setBaseCurrency] = useState("EUR");
  const [token, setToken] = useState("");
  const [tokenVisible, setTokenVisible] = useState(false);
  const [qPos, setQPos] = useState("");
  const [qTrades, setQTrades] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await createBrokerConnection({
        provider: "ibkr_flex",
        flex_token: token,
        query_id_positions: qPos,
        query_id_trades: qTrades,
        account_name: accountName,
        base_currency: baseCurrency,
      });
      router.push("/investments");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-t-2 border-t-primary">
      <CardContent className="p-6 space-y-5">
        <form onSubmit={submit} className="space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 border border-border flex items-center justify-center font-bold text-[11px] text-muted-foreground">
              {translate("ibkr")}
            </div>
            <div>
              <div className="font-semibold text-sm">
                {translate("interactiveBrokersFlexQuery")}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {translate("positionsAndTradeHistorySyncAutomaticallyViaTheFlex")}
              </div>
            </div>
          </div>
          <div className="bg-muted/40 border border-border px-4 py-3 space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {translate("whatYouNeed")}
            </div>
            {[
              "A Flex Web Service token — from IBKR Account Management → Reports → Flex Queries",
              "A Positions Flex Query ID configured to export account positions",
              "A Trades Flex Query ID configured to export trade history",
            ].map((t) => (
              <div
                key={t}
                className="flex gap-2 text-xs text-muted-foreground"
              >
                <span>·</span>
                <span>{t}</span>
              </div>
            ))}
            <a
              href="https://www.interactivebrokers.com/en/index.php?f=1325"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-foreground mt-1 inline-flex items-center gap-1 hover:underline"
            >
              <RiExternalLinkLine size={11} /> {translate("howToSetUpFlexQueries")}
            </a>
          </div>
          <div className="space-y-3.5">
            <div className="flex flex-col gap-3 sm:flex-row">
              <Field label={translate("accountNameabe4d6")} className="flex-[2_1_0%]">
                <Input
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                />
              </Field>
              <Field label={translate("baseCurrency")} className="flex-1">
                <Select
                  value={baseCurrency}
                  onValueChange={(v) => v && setBaseCurrency(v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EUR">{translate("eur")}</SelectItem>
                    <SelectItem value="USD">{translate("usd")}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label={translate("flexToken")}>
              <div className="relative">
                <Input
                  type={tokenVisible ? "text" : "password"}
                  placeholder={translate("pasteYourFlexWebServiceToken")}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="pr-9"
                />
                <button
                  type="button"
                  onClick={() => setTokenVisible((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {tokenVisible ? (
                    <RiEyeOffLine size={13} />
                  ) : (
                    <RiEyeLine size={13} />
                  )}
                </button>
              </div>
            </Field>
            <div className="flex gap-3">
              <Field label={translate("positionsQueryId")} className="flex-1">
                <Input
                  placeholder={translate("eG123456")}
                  value={qPos}
                  onChange={(e) => setQPos(e.target.value)}
                />
              </Field>
              <Field label={translate("tradesQueryId")} className="flex-1">
                <Input
                  placeholder={translate("eG789012")}
                  value={qTrades}
                  onChange={(e) => setQTrades(e.target.value)}
                />
              </Field>
            </div>
            {err && <div className="text-destructive text-xs">{err}</div>}
            <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
              <Button type="button" variant="outline" onClick={onCancel}>
                {translate("cancel")}
              </Button>
              <Button type="submit" disabled={busy}>
                <RiRefreshLine size={13} /> {busy ? translate("syncing") : translate("connectSync")}
              </Button>
            </div>
          </div>
          <div className="mt-6 pt-5 border-t border-border">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2.5">
              {translate("moreBrokersComingSoon")}
            </div>
            <div className="grid gap-2.5 sm:grid-cols-3">
              {["Trading 212", "Degiro", "Schwab"].map((b) => (
                <div
                  key={b}
                  className="flex items-center gap-2 border border-border px-3.5 py-2.5 opacity-45"
                >
                  <RiBankLine size={14} className="text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">{b}</span>
                </div>
              ))}
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
