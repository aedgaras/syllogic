import { t as translate } from "@/i18n/translate";
import type { AssetCategoryKey } from "@/lib/assets/asset-category";

export type { AssetCategoryKey };
export {
  ASSET_CATEGORY_COLORS,
  ASSET_CATEGORY_LABELS,
} from "@/lib/assets/asset-category";

export type AssetType = "account" | "property" | "vehicle";

export interface AssetAccount {
  id: string;
  name: string;
  institution: string | null;
  value: number;
  percentage: number;
  currency: string;
  initial: string;
}

export interface AssetCategory {
  key: AssetCategoryKey;
  label: string;
  color: string;
  value: number;
  percentage: number;
  isActive: boolean;
  accounts: AssetAccount[];
}

export interface AssetsOverviewData {
  total: number;
  currency: string;
  categories: AssetCategory[];
}

export const PROPERTY_TYPES = [
  { value: "residential", label: translate("residential") },
  { value: "commercial", label: translate("commercial") },
  { value: "land", label: translate("land") },
  { value: "other", label: translate("other") },
] as const;

export const VEHICLE_TYPES = [
  { value: "car", label: translate("car") },
  { value: "motorcycle", label: translate("motorcycle") },
  { value: "boat", label: translate("boat") },
  { value: "rv", label: translate("rv") },
  { value: "other", label: translate("other") },
] as const;

export type PropertyType = (typeof PROPERTY_TYPES)[number]["value"];
export type VehicleType = (typeof VEHICLE_TYPES)[number]["value"];
