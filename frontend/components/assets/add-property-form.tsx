"use client";
import { t as translate } from "@/i18n/translate";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CURRENCIES } from "@/lib/constants/currencies";
import { createProperty } from "@/lib/actions/properties";
import { PROPERTY_TYPES } from "./types";
import {
  OwnersField,
  type OwnerValue,
} from "@/components/household/owners-field";
import {
  saveOwners,
  usePeopleQuery,
  type ClientPerson,
} from "@/lib/people/client";

interface AddPropertyFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function AddPropertyForm({ onSuccess, onCancel }: AddPropertyFormProps) {
  const [isLoading, setIsLoading] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [propertyType, setPropertyType] = useState("");
  const [address, setAddress] = useState("");
  const [currentValue, setCurrentValue] = useState("");
  const [currency, setCurrency] = useState("EUR");

  // Ownership state
  const { data: people = [], isPending: isPeoplePending } = usePeopleQuery();
  const peopleLoaded = !isPeoplePending;
  const [owners, setOwners] = useState<OwnerValue[]>([]);
  const [ownersError, setOwnersError] = useState<string | null>(null);
  const savePropertyOwnersMutation = useMutation({
    mutationFn: ({
      entityId,
      owners,
    }: {
      entityId: string;
      owners: OwnerValue[];
    }) => saveOwners("property", entityId, owners),
  });

  useEffect(() => {
    const self = people.find((p: ClientPerson) => p.kind === "self");
    if (self && owners.length === 0) {
      setOwners([{ personId: self.id, share: null }]);
    }
  }, [owners.length, people]);

  const validateOwners = (): boolean => {
    if (owners.length === 0) {
      setOwnersError(translate("selectAtLeastOneOwner"));
      return false;
    }
    const allNull = owners.every((o) => o.share === null);
    const allSet = owners.every((o) => o.share !== null);
    if (!allNull && !allSet) {
      setOwnersError(
        translate("allOwnersMustEitherSplitEquallyOrSpecifyShares"),
      );
      return false;
    }
    if (allSet) {
      const sum = owners.reduce((acc, o) => acc + (o.share as number), 0);
      if (Math.abs(sum - 1) > 0.0001) {
        setOwnersError(
          translate("sharesMustSumTo100Currentlyc8e2ea", {
            value1: Math.round(sum * 100),
          }),
        );
        return false;
      }
    }
    setOwnersError(null);
    return true;
  };

  const putOwners = async (entityId: string) => {
    try {
      await savePropertyOwnersMutation.mutateAsync({ entityId, owners });
    } catch (err) {
      toast.error(
        (err as Error).message ||
          translate("propertyCreatedButFailedToSaveOwnershipYouCan"),
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast.error(translate("pleaseEnterAPropertyName"));
      return;
    }

    if (!propertyType) {
      toast.error(translate("pleaseSelectAPropertyType"));
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

    setIsLoading(true);

    try {
      const value = currentValue ? parseFloat(currentValue) : 0;
      if (currentValue && isNaN(value)) {
        toast.error(translate("pleaseEnterAValidValue"));
        setIsLoading(false);
        return;
      }

      const result = await createProperty({
        name: name.trim(),
        propertyType,
        address: address.trim() || undefined,
        currentValue: value,
        currency,
      });

      if (result.success) {
        if (result.propertyId) {
          await putOwners(result.propertyId);
        }
        toast.success(translate("propertyAddedSuccessfully"));
        onSuccess?.();
      } else {
        toast.error(result.error || translate("failedToAddProperty"));
      }
    } catch {
      toast.error(translate("anErrorOccurredPleaseTryAgain"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid gap-4 py-4">
        {/* Property Name */}
        <div className="space-y-2">
          <Label htmlFor="property-name">{translate("propertyName")}</Label>
          <Input
            id="property-name"
            placeholder={translate("eGMainResidence")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {/* Property Type */}
        <div className="space-y-2">
          <Label htmlFor="property-type">{translate("propertyType")}</Label>
          <Select
            value={propertyType}
            onValueChange={(v) => v && setPropertyType(v)}
          >
            <SelectTrigger>
              <SelectValue placeholder={translate("selectPropertyType")} />
            </SelectTrigger>
            <SelectContent>
              {PROPERTY_TYPES.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Address */}
        <div className="space-y-2">
          <Label htmlFor="property-address">
            {translate("addressOptional")}
          </Label>
          <Input
            id="property-address"
            placeholder={translate("eG123MainStCityState")}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>

        {/* Current Value */}
        <div className="space-y-2">
          <Label htmlFor="property-value">{translate("currentValue")}</Label>
          <Input
            id="property-value"
            type="number"
            inputMode="decimal"
            step="0.01"
            placeholder="0.00"
            value={currentValue}
            onChange={(e) => setCurrentValue(e.target.value)}
          />
        </div>

        {/* Currency */}
        <div className="space-y-2">
          <Label htmlFor="property-currency">{translate("currency")}</Label>
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

        {/* Owners */}
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
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isLoading}
        >
          {translate("cancel")}
        </Button>
        <Button type="submit" disabled={isLoading}>
          {isLoading ? translate("adding") : translate("addProperty")}
        </Button>
      </div>
    </form>
  );
}
