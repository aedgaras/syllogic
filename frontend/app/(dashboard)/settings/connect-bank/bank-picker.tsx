"use client";
import { t as translate } from "@/i18n/translate";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RiSearchLine,
  RiBankLine,
  RiArrowLeftLine,
  RiLoader4Line,
  RiAlertLine,
} from "@remixicon/react";
import Link from "next/link";
import { initiateAuth } from "@/lib/actions/bank-connections";
import { fetchAspsps, type Aspsp } from "@/lib/bank-connections/client";

// European countries with Enable Banking support
const COUNTRIES = [
  { code: "NL", name: translate("netherlands") },
  { code: "DE", name: translate("germany") },
  { code: "FR", name: translate("france") },
  { code: "ES", name: translate("spain") },
  { code: "IT", name: translate("italy") },
  { code: "BE", name: translate("belgium") },
  { code: "AT", name: translate("austria") },
  { code: "FI", name: translate("finland") },
  { code: "SE", name: translate("sweden") },
  { code: "NO", name: translate("norway") },
  { code: "DK", name: translate("denmark") },
  { code: "PT", name: translate("portugal") },
  { code: "IE", name: translate("ireland") },
  { code: "LU", name: translate("luxembourg") },
  { code: "PL", name: translate("poland") },
  { code: "EE", name: translate("estonia") },
  { code: "LV", name: translate("latvia") },
  { code: "LT", name: translate("lithuania") },
];

export function BankPicker() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  const [country, setCountry] = useState("NL");
  const [search, setSearch] = useState("");
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [connectingBank, setConnectingBank] = useState<string | null>(null);

  const {
    data: aspsps = [],
    isLoading: loading,
    isError,
  } = useQuery({
    queryKey: ["enable-banking", "aspsps", country],
    queryFn: ({ signal }) => {
      setFetchError(null);
      return fetchAspsps(country, signal);
    },
  });

  const loadError =
    fetchError ??
    (isError ? translate("failedToLoadAvailableBanksPleaseTryAgain") : null);

  const filtered = useMemo(() => {
    if (!search) return aspsps;
    const lower = search.toLowerCase();
    return aspsps.filter((a) => a.name.toLowerCase().includes(lower));
  }, [aspsps, search]);

  const handleConnect = async (aspsp: Aspsp) => {
    setConnectingBank(aspsp.name);
    try {
      const result = await initiateAuth(aspsp.name, aspsp.country || country);
      if (result.success && result.url) {
        router.push(result.url);
      } else {
        setFetchError(result.error || translate("failedToInitiateConnection"));
        setConnectingBank(null);
      }
    } catch {
      setFetchError(translate("failedToInitiateConnectionPleaseTryAgain"));
      setConnectingBank(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/settings?tab=bank-connections"
        className={buttonVariants({ variant: "ghost", size: "sm" })}
      >
        <RiArrowLeftLine className="mr-1.5 h-4 w-4" />
        {translate("backToSettings")}
      </Link>

      {/* Error from callback */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          <RiAlertLine className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold">{translate("selectYourBank")}</h2>
        <p className="text-sm text-muted-foreground">
          {translate("chooseYourBankToConnectViaOpenBankingYou")}
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select value={country} onValueChange={(v) => v && setCountry(v)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder={translate("selectCountry")} />
          </SelectTrigger>
          <SelectContent>
            {COUNTRIES.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative flex-1">
          <RiSearchLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={translate("searchBanks")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Bank grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <RiLoader4Line className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : loadError ? (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-center text-sm text-destructive">
          {loadError}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {translate("noBanksFound")}
          {search
            ? translate("matching", { search: search })
            : translate("for", { country: country })}
          .
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((aspsp) => (
            <button
              key={aspsp.name}
              onClick={() => handleConnect(aspsp)}
              disabled={connectingBank !== null}
              className="flex items-center gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-muted/50 disabled:opacity-50"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                <RiBankLine className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {aspsp.name}
                  {connectingBank === aspsp.name && (
                    <RiLoader4Line className="ml-2 inline h-4 w-4 animate-spin" />
                  )}
                </p>
                {aspsp.beta && (
                  <span className="text-xs text-muted-foreground">
                    {translate("beta")}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
