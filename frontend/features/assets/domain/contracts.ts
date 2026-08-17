export type AssetType = "account" | "property" | "vehicle";
export type AssetMode = "idle" | "edit" | "delete" | "balance";

export interface AssetDialogState {
  mode: AssetMode;
  assetType: AssetType | null;
  assetId: string | null;
}

export interface AssetPerson {
  id: string;
  name: string;
  kind: string;
  color?: string | null;
  avatarUrl?: string | null;
}

export interface AssetOwner {
  personId: string;
  share: number | null;
}

export interface AssetLogo {
  id: string;
  logoUrl: string | null;
  updatedAt: string | null;
}

export interface AccountAssetViewModel {
  id: string;
  name: string;
  accountType: string;
  institution: string | null;
  currency: string;
  balance: string;
  logo: AssetLogo | null;
  ownerIds: string[];
}

export interface PropertyAssetViewModel {
  id: string;
  name: string;
  propertyType: string;
  address: string | null;
  currency: string;
  value: string;
  ownerIds: string[];
}

export interface VehicleAssetViewModel {
  id: string;
  name: string;
  vehicleType: string;
  make: string | null;
  model: string | null;
  year: number | null;
  currency: string;
  value: string;
  ownerIds: string[];
}

export interface AssetManagementViewModel {
  accounts: AccountAssetViewModel[];
  properties: PropertyAssetViewModel[];
  vehicles: VehicleAssetViewModel[];
  people: AssetPerson[];
}

export interface AccountEditValues {
  name: string;
  accountType: string;
  institution: string;
  currency: string;
  balance: string;
  logoId: string | null;
  logoUrl: string | null;
  logoUpdatedAt: string | null;
  owners: AssetOwner[];
}

export interface PropertyEditValues {
  name: string;
  propertyType: string;
  address: string;
  currentValue: string;
  currency: string;
  owners: AssetOwner[];
}

export interface VehicleEditValues {
  name: string;
  vehicleType: string;
  make: string;
  model: string;
  year: string;
  currentValue: string;
  currency: string;
  owners: AssetOwner[];
}

export interface AssetActionResult {
  success: boolean;
  error?: string;
}
