import type { Property, Vehicle } from "@/lib/db/schema";
import type { AccountViewModel } from "@/features/accounts/public";
import type {
  AccountAssetViewModel,
  PropertyAssetViewModel,
  VehicleAssetViewModel,
} from "../domain/contracts";

export function toAccountAssetViewModel(row: AccountViewModel, ownerIds: string[] = []): AccountAssetViewModel {
  return {
    id: row.id,
    name: row.name,
    accountType: row.accountType,
    institution: row.institution,
    currency: row.currency ?? "EUR",
    balance: row.functionalBalance ?? "0",
    logo: row.logo,
    ownerIds,
  };
}

export function toPropertyAssetViewModel(row: Property, ownerIds: string[] = []): PropertyAssetViewModel {
  return { id: row.id, name: row.name, propertyType: row.propertyType, address: row.address, currency: row.currency ?? "EUR", value: row.currentValue ?? "0", ownerIds };
}

export function toVehicleAssetViewModel(row: Vehicle, ownerIds: string[] = []): VehicleAssetViewModel {
  return { id: row.id, name: row.name, vehicleType: row.vehicleType, make: row.make, model: row.model, year: row.year, currency: row.currency ?? "EUR", value: row.currentValue ?? "0", ownerIds };
}
