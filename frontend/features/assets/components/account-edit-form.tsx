"use client";
import { t as translate } from "@/i18n/translate";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import {
  RiCloseLine,
  RiLoader4Line,
  RiScalesLine,
  RiSearchLine,
} from "@remixicon/react";
import { AccountLogo } from "@/components/ui/account-logo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OwnersField } from "@/components/household/owners-field";
import { CURRENCIES } from "@/lib/constants/currencies";
import { accountEditSchema } from "../domain/edit-schemas";
import type {
  AccountEditValues,
  AssetLogo,
  AssetPerson,
} from "../domain/contracts";

const ACCOUNT_TYPES = [
  { value: "checking", label: translate("checkingAccount") },
  { value: "savings", label: translate("savingsAccount") },
  { value: "credit_card", label: translate("creditCard") },
  { value: "investment", label: translate("investmentAccount") },
  { value: "cash", label: translate("cash") },
  { value: "other", label: translate("other") },
];

export function AccountEditForm({
  values,
  people,
  open,
  pending,
  logoLookupEnabled,
  onOpenChange,
  onSubmit,
  onLookupLogo,
  onAdjustBalance,
}: {
  values: AccountEditValues;
  people: AssetPerson[];
  open: boolean;
  pending: boolean;
  logoLookupEnabled: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: AccountEditValues) => Promise<void>;
  onLookupLogo: (query: string) => Promise<AssetLogo | null>;
  onAdjustBalance: () => void;
}) {
  const [logoSearch, setLogoSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<AccountEditValues>({
    resolver: zodResolver(accountEditSchema),
    defaultValues: values,
  });
  const [name, logoId, logoUrl, logoUpdatedAt, institution] = useWatch({
    control,
    name: ["name", "logoId", "logoUrl", "logoUpdatedAt", "institution"],
  });
  const search = async () => {
    setSearching(true);
    const logo = await onLookupLogo(logoSearch || institution || name);
    if (logo) {
      setValue("logoId", logo.id);
      setValue("logoUrl", logo.logoUrl);
      setValue("logoUpdatedAt", logo.updatedAt);
    }
    setSearching(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{translate("editAccount")}</DialogTitle>
          <DialogDescription>
            {translate("updateYourAccountDetails")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="grid gap-4 py-4">
            <Field
              label={translate("accountName")}
              id="edit-account-name"
              error={errors.name?.message}
            >
              <Input id="edit-account-name" {...register("name")} />
            </Field>
            <Controller
              control={control}
              name="accountType"
              render={({ field }) => (
                <Field label={translate("accountType")}>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACCOUNT_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
            <Field
              label={translate("institutionOptional")}
              id="edit-account-institution"
            >
              <Input
                id="edit-account-institution"
                {...register("institution")}
              />
            </Field>
            {logoLookupEnabled && (
              <Field label={translate("accountLogo")}>
                <div className="flex items-center gap-2">
                  <AccountLogo
                    name={name || "Account"}
                    logoUrl={logoUrl}
                    updatedAt={logoUpdatedAt}
                    className="!size-9"
                  />
                  <div className="flex flex-1 items-center gap-2">
                    <Input
                      placeholder={translate("searchByInstitutionName")}
                      value={logoSearch}
                      onChange={(event) => setLogoSearch(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void search();
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => void search()}
                      disabled={searching}
                    >
                      {searching ? (
                        <RiLoader4Line className="h-4 w-4 animate-spin" />
                      ) : (
                        <RiSearchLine className="h-4 w-4" />
                      )}
                    </Button>
                    {logoId && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setValue("logoId", null);
                          setValue("logoUrl", null);
                          setValue("logoUpdatedAt", null);
                          setLogoSearch("");
                        }}
                      >
                        <RiCloseLine className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </Field>
            )}
            <Field
              label={translate("currentBalance")}
              id="edit-account-balance"
            >
              <div className="flex gap-2">
                <Input
                  id="edit-account-balance"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  disabled
                  {...register("balance")}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onAdjustBalance}
                >
                  <RiScalesLine className="mr-2 h-4 w-4" />
                  {translate("adjust")}
                </Button>
              </div>
            </Field>
            <Controller
              control={control}
              name="currency"
              render={({ field }) => (
                <Field label={translate("currency")}>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((currency) => (
                        <SelectItem key={currency.code} value={currency.code}>
                          {currency.code} - {currency.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
            {people.length > 1 && (
              <Controller
                control={control}
                name="owners"
                render={({ field }) => (
                  <OwnersField
                    people={people}
                    value={field.value}
                    onChange={field.onChange}
                    disabled={pending}
                  />
                )}
              />
            )}
            {errors.owners?.message && (
              <p className="text-sm text-destructive">
                {errors.owners.message}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              {translate("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? translate("saving") : translate("saveChangesfa2984")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  id,
  error,
  children,
}: React.PropsWithChildren<{ label: string; id?: string; error?: string }>) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
