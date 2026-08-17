"use client";
import { t as translate } from "@/i18n/translate";


import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CURRENCIES, ACCOUNT_TYPES } from "@/lib/constants";
import { createAccount, createPocketAccount } from "@/features/accounts/client/actions";
import { OwnersField, type OwnerValue } from "@/components/household/owners-field";
import { saveOwners, usePeopleQuery, type ClientPerson } from "@/lib/people/client";

const IBAN_RE = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/;

interface AccountFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
  submitLabel?: string;
  cancelLabel?: string;
  showCancel?: boolean;
  successMessage?: string;
}

export function AccountForm({
  onSuccess,
  onCancel,
  submitLabel = "Create Account",
  cancelLabel = "Cancel",
  showCancel = true,
  successMessage = "Account created successfully",
}: AccountFormProps) {
  const [isLoading, setIsLoading] = useState(false);

  const [name, setName] = useState("");
  const [accountType, setAccountType] = useState("");
  const [institution, setInstitution] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [initialBalance, setInitialBalance] = useState("");
  const [isPocket, setIsPocket] = useState(false);
  const [iban, setIban] = useState("");

  // Ownership state
  const { data: people = [], isPending: isPeoplePending } = usePeopleQuery();
  const peopleLoaded = !isPeoplePending;
  const [owners, setOwners] = useState<OwnerValue[]>([]);
  const [ownersError, setOwnersError] = useState<string | null>(null);
  const saveAccountOwnersMutation = useMutation({
    mutationFn: ({ entityId, owners }: { entityId: string; owners: OwnerValue[] }) =>
      saveOwners("account", entityId, owners),
  });

  useEffect(() => {
    const self = people.find((p: ClientPerson) => p.kind === "self");
    if (self && owners.length === 0) {
      setOwners([{ personId: self.id, share: null }]);
    }
  }, [owners.length, people]);

  const resetForm = () => {
    setName("");
    setAccountType("");
    setInstitution("");
    setCurrency("EUR");
    setInitialBalance("");
    setIsPocket(false);
    setIban("");
    setOwnersError(null);
    // Re-seed owners to self
    const self = people.find((p) => p.kind === "self");
    setOwners(self ? [{ personId: self.id, share: null }] : []);
  };

  const validateOwners = (): boolean => {
    if (owners.length === 0) {
      setOwnersError(translate("selectAtLeastOneOwner"));
      return false;
    }
    const allNull = owners.every((o) => o.share === null);
    const allSet = owners.every((o) => o.share !== null);
    if (!allNull && !allSet) {
      setOwnersError(translate("allOwnersMustEitherSplitEquallyOrSpecifyShares"));
      return false;
    }
    if (allSet) {
      const sum = owners.reduce((acc, o) => acc + (o.share as number), 0);
      if (Math.abs(sum - 1) > 0.0001) {
        setOwnersError(translate("sharesMustSumTo100Currentlyc8e2ea", { value1: Math.round(sum * 100) }));
        return false;
      }
    }
    setOwnersError(null);
    return true;
  };

  const putOwners = async (entityId: string) => {
    try {
      await saveAccountOwnersMutation.mutateAsync({ entityId, owners });
    } catch (err) {
      toast.error((err as Error).message || translate("accountCreatedButFailedToSaveOwnershipYouCan"));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast.error(translate("pleaseEnterAnAccountName"));
      return;
    }
    if (!accountType) {
      toast.error(translate("pleaseSelectAnAccountType"));
      return;
    }
    if (!currency) {
      toast.error(translate("pleaseSelectACurrency"));
      return;
    }

    if (!peopleLoaded) {
      setOwnersError(translate("loadingHouseholdDataPleaseWait"));
      return;
    }
    if (people.length > 0 && !validateOwners()) return;

    const normalizedIban = iban.replace(/\s+/g, "").toUpperCase();
    if (isPocket) {
      if (!normalizedIban) {
        toast.error(translate("pleaseEnterAnIbanForThePocketAccount"));
        return;
      }
      if (
        !IBAN_RE.test(normalizedIban)
        || normalizedIban.length < 15
        || normalizedIban.length > 34
      ) {
        toast.error(translate("pleaseEnterAValidIban"));
        return;
      }
    }

    setIsLoading(true);

    try {
      const balance = initialBalance ? parseFloat(initialBalance) : 0;
      if (initialBalance && isNaN(balance)) {
        toast.error(translate("pleaseEnterAValidInitialBalance"));
        setIsLoading(false);
        return;
      }

      const result = isPocket
        ? await createPocketAccount({
            name: name.trim(),
            accountType,
            currency,
            startingBalance: balance,
            iban: normalizedIban,
          })
        : await createAccount({
            name: name.trim(),
            accountType,
            institution: institution.trim() || undefined,
            currency,
            startingBalance: balance,
          });

      if (result.success) {
        // PUT owners after entity creation
        if (result.accountId) {
          await putOwners(result.accountId);
        }

        const backfilled =
          isPocket && "backfilledCount" in result && typeof result.backfilledCount === "number"
            ? result.backfilledCount
            : 0;
        const message = backfilled > 0
          ? translate("existingTransferLinked", { successMessage: successMessage, backfilled: backfilled, value3: backfilled === 1 ? "" : "s" })
          : successMessage;
        toast.success(message);
        resetForm();
        onSuccess?.();
      } else {
        toast.error(result.error || translate("failedToCreateAccount"));
      }
    } catch {
      toast.error(translate("anErrorOccurredPleaseTryAgain"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    resetForm();
    onCancel?.();
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid gap-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="account-name">{translate("accountName")}</Label>
          <Input
            id="account-name"
            placeholder={translate("eGMainChecking")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="account-type">{translate("accountType")}</Label>
          <Select value={accountType} onValueChange={(v) => v && setAccountType(v)}>
            <SelectTrigger>
              <SelectValue placeholder={translate("selectAccountType")} />
            </SelectTrigger>
            <SelectContent>
              {ACCOUNT_TYPES.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!isPocket && (
          <div className="space-y-2">
            <Label htmlFor="account-institution">{translate("institutionOptional")}</Label>
            <Input
              id="account-institution"
              placeholder={translate("eGBankOfAmerica")}
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
            />
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="account-currency">{translate("currency")}</Label>
          <Select value={currency} onValueChange={(v) => v && setCurrency(v)}>
            <SelectTrigger>
              <SelectValue placeholder={translate("selectCurrency")} />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((curr) => (
                <SelectItem key={curr.code} value={curr.code}>
                  {curr.code} - {curr.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="account-balance">{translate("initialBalanceOptional")}</Label>
          <Input
            id="account-balance"
            type="number"
            step="0.01"
            placeholder="0.00"
            value={initialBalance}
            onChange={(e) => setInitialBalance(e.target.value)}
          />
        </div>

        <div className="flex items-center justify-between rounded border p-3">
          <div className="space-y-0.5">
            <Label htmlFor="is-pocket" className="cursor-pointer">
              {translate("registerAsPocketAccount")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {translate("trackASavingsPocketByIbanTransfersFromYour")}
            </p>
          </div>
          <Switch
            id="is-pocket"
            checked={isPocket}
            onCheckedChange={setIsPocket}
          />
        </div>

        {isPocket && (
          <div className="space-y-2">
            <Label htmlFor="account-iban">{translate("iban")}</Label>
            <Input
              id="account-iban"
              placeholder={translate("nl91Abna0417164300")}
              value={iban}
              onChange={(e) => setIban(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
            />
            <p className="text-xs text-muted-foreground">
              {translate("spacesAreIgnoredTheIbanIsEncryptedAtRest")}
            </p>
          </div>
        )}

        {people.length > 0 && (
          <div className="space-y-2">
            <OwnersField
              people={people}
              value={owners}
              onChange={(next) => {
                setOwners(next);
                setOwnersError(null);
              }}
              disabled={isLoading}
            />
            {ownersError && (
              <p className="text-sm text-destructive">{ownersError}</p>
            )}
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2">
        {showCancel && (
          <Button type="button" variant="outline" onClick={handleCancel} disabled={isLoading}>
            {cancelLabel}
          </Button>
        )}
        <Button type="submit" disabled={isLoading}>
          {isLoading ? translate("creating") : submitLabel}
        </Button>
      </div>
    </form>
  );
}
