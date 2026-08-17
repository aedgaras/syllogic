import { deleteAccount, recalculateAccountTimeseries, updateAccount } from "@/lib/actions/accounts";
import { deleteProperty, updateProperty } from "@/lib/actions/properties";
import { deleteVehicle, updateVehicle } from "@/lib/actions/vehicles";
import { hasLogoApiKey, searchLogo } from "@/lib/actions/logos";
import { fetchOwners, saveOwners } from "@/lib/people/client";
import type { AccountEditValues, AssetOwner, AssetType, PropertyEditValues, VehicleEditValues } from "../domain/contracts";

export { hasLogoApiKey as isLogoLookupEnabled };

export async function lookupAccountLogo(query: string) {
  const result = await searchLogo(query);
  return {
    success: result.success,
    error: result.error,
    logo: result.logo ? { id: result.logo.id, logoUrl: result.logo.logoUrl, updatedAt: result.logo.updatedAt?.toISOString() ?? null } : undefined,
  };
}

export function loadAssetOwners(type: AssetType, id: string) {
  return fetchOwners(type, id);
}

export function persistAssetOwners(type: AssetType, id: string, owners: AssetOwner[]) {
  return saveOwners(type, id, owners);
}

export async function updateAccountAsset(id: string, values: AccountEditValues) {
  return updateAccount(id, { name: values.name.trim(), accountType: values.accountType, institution: values.institution.trim() || undefined, currency: values.currency, startingBalance: Number(values.balance) || 0, logoId: values.logoId });
}

export async function updatePropertyAsset(id: string, values: PropertyEditValues) {
  return updateProperty(id, { name: values.name.trim(), propertyType: values.propertyType, address: values.address.trim() || undefined, currentValue: Number(values.currentValue) || 0, currency: values.currency });
}

export async function updateVehicleAsset(id: string, values: VehicleEditValues) {
  return updateVehicle(id, { name: values.name.trim(), vehicleType: values.vehicleType, make: values.make.trim() || undefined, model: values.model.trim() || undefined, year: values.year ? Number(values.year) : undefined, currentValue: Number(values.currentValue) || 0, currency: values.currency });
}

export const deleteAsset = { account: deleteAccount, property: deleteProperty, vehicle: deleteVehicle };
export const recalculateAccount = recalculateAccountTimeseries;
