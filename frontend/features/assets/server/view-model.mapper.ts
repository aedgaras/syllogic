import type { Account, Property, Vehicle } from "@/lib/db/schema";
import type {
  AccountAssetViewModel,
  PropertyAssetViewModel,
  VehicleAssetViewModel,
} from "../domain/contracts";

type AccountRow = Account & { logo?: { id: string; logoUrl: string | null; updatedAt?: Date | null } | null };

export function toAccountAssetViewModel(row: AccountRow, ownerIds: string[] = []): AccountAssetViewModel {
  return {
    id: row.id,
    name: row.name,
    accountType: row.accountType,
    institution: row.institution,
    currency: row.currency ?? "EUR",
    balance: row.functionalBalance ?? "0",
    logo: row.logo ? { id: row.logo.id, logoUrl: row.logo.logoUrl, updatedAt: row.logo.updatedAt?.toISOString() ?? null } : null,
    ownerIds,
  };
}

export function toPropertyAssetViewModel(row: Property, ownerIds: string[] = []): PropertyAssetViewModel {
  return { id: row.id, name: row.name, propertyType: row.propertyType, address: row.address, currency: row.currency ?? "EUR", value: row.currentValue ?? "0", ownerIds };
}

export function toVehicleAssetViewModel(row: Vehicle, ownerIds: string[] = []): VehicleAssetViewModel {
  return { id: row.id, name: row.name, vehicleType: row.vehicleType, make: row.make, model: row.model, year: row.year, currency: row.currency ?? "EUR", value: row.currentValue ?? "0", ownerIds };
}
