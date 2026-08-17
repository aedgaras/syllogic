import { t as translate } from "@/i18n/translate";
export const CATEGORY_COLORS = [
  { name: translate("amber"), value: "#92400E" },
  { name: translate("blue"), value: "#1E40AF" },
  { name: translate("green"), value: "#047857" },
  { name: translate("red"), value: "#B91C1C" },
  { name: translate("purple"), value: "#5B21B6" },
  { name: translate("teal"), value: "#0F766E" },
  { name: translate("pink"), value: "#9D174D" },
  { name: translate("indigo"), value: "#3730A3" },
  { name: translate("emerald"), value: "#15803D" },
  { name: translate("slate"), value: "#334155" },
  { name: translate("stone"), value: "#44403C" },
  { name: translate("zinc"), value: "#52525B" },
] as const;

export type CategoryColor = (typeof CATEGORY_COLORS)[number];

export function getColorByValue(value: string): CategoryColor | undefined {
  return CATEGORY_COLORS.find((color) => color.value === value);
}

export function getColorByName(name: string): CategoryColor | undefined {
  return CATEGORY_COLORS.find((color) => color.name.toLowerCase() === name.toLowerCase());
}
