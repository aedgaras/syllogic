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
import { createVehicle } from "@/lib/actions/vehicles";
import { VEHICLE_TYPES } from "./types";
import {
  OwnersField,
  type OwnerValue,
} from "@/components/household/owners-field";
import {
  saveOwners,
  usePeopleQuery,
  type ClientPerson,
} from "@/lib/people/client";

interface AddVehicleFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function AddVehicleForm({ onSuccess, onCancel }: AddVehicleFormProps) {
  const [isLoading, setIsLoading] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [currentValue, setCurrentValue] = useState("");
  const [currency, setCurrency] = useState("EUR");

  // Ownership state
  const { data: people = [], isPending: isPeoplePending } = usePeopleQuery();
  const peopleLoaded = !isPeoplePending;
  const [owners, setOwners] = useState<OwnerValue[]>([]);
  const [ownersError, setOwnersError] = useState<string | null>(null);
  const saveVehicleOwnersMutation = useMutation({
    mutationFn: ({
      entityId,
      owners,
    }: {
      entityId: string;
      owners: OwnerValue[];
    }) => saveOwners("vehicle", entityId, owners),
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
      await saveVehicleOwnersMutation.mutateAsync({ entityId, owners });
    } catch (err) {
      toast.error(
        (err as Error).message ||
          translate("vehicleCreatedButFailedToSaveOwnershipYouCan"),
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast.error(translate("pleaseEnterAVehicleName"));
      return;
    }

    if (!vehicleType) {
      toast.error(translate("pleaseSelectAVehicleType"));
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

      const yearNum = year ? parseInt(year, 10) : undefined;
      if (
        year &&
        (isNaN(yearNum!) ||
          yearNum! < 1900 ||
          yearNum! > new Date().getFullYear() + 1)
      ) {
        toast.error(translate("pleaseEnterAValidYear"));
        setIsLoading(false);
        return;
      }

      const result = await createVehicle({
        name: name.trim(),
        vehicleType,
        make: make.trim() || undefined,
        model: model.trim() || undefined,
        year: yearNum,
        currentValue: value,
        currency,
      });

      if (result.success) {
        if (result.vehicleId) {
          await putOwners(result.vehicleId);
        }
        toast.success(translate("vehicleAddedSuccessfully"));
        onSuccess?.();
      } else {
        toast.error(result.error || translate("failedToAddVehicle"));
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
        {/* Vehicle Name */}
        <div className="space-y-2">
          <Label htmlFor="vehicle-name">{translate("vehicleName")}</Label>
          <Input
            id="vehicle-name"
            placeholder={translate("eGFamilyCar")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {/* Vehicle Type */}
        <div className="space-y-2">
          <Label htmlFor="vehicle-type">{translate("vehicleType")}</Label>
          <Select
            value={vehicleType}
            onValueChange={(v) => v && setVehicleType(v)}
          >
            <SelectTrigger>
              <SelectValue placeholder={translate("selectVehicleType")} />
            </SelectTrigger>
            <SelectContent>
              {VEHICLE_TYPES.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Make and Model */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="vehicle-make">{translate("makeOptional")}</Label>
            <Input
              id="vehicle-make"
              placeholder={translate("eGToyota")}
              value={make}
              onChange={(e) => setMake(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vehicle-model">{translate("modelOptional")}</Label>
            <Input
              id="vehicle-model"
              placeholder={translate("eGCamry")}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </div>
        </div>

        {/* Year */}
        <div className="space-y-2">
          <Label htmlFor="vehicle-year">{translate("yearOptional")}</Label>
          <Input
            id="vehicle-year"
            type="number"
            placeholder={translate("eG2020")}
            value={year}
            onChange={(e) => setYear(e.target.value)}
          />
        </div>

        {/* Current Value */}
        <div className="space-y-2">
          <Label htmlFor="vehicle-value">{translate("currentValue")}</Label>
          <Input
            id="vehicle-value"
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
          <Label htmlFor="vehicle-currency">{translate("currency")}</Label>
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
          {isLoading ? translate("adding") : translate("addVehicle")}
        </Button>
      </div>
    </form>
  );
}
