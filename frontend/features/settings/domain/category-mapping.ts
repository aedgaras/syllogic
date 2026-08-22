import type { SettingsCategory } from "./contracts";

export interface CategoryFormInput {
  name: string;
  categoryType: "expense" | "income" | "transfer";
  color: string;
  icon: string;
  description?: string;
  categorizationInstructions?: string;
  isSystem: boolean;
}

export function categoryToFormInput(
  category: SettingsCategory | null,
): CategoryFormInput | null {
  if (!category) return null;
  return {
    name: category.name,
    categoryType: category.categoryType as "expense" | "income" | "transfer",
    color: category.color || "#6b7280",
    icon: category.icon || "RiFolderLine",
    description: category.description || undefined,
    categorizationInstructions:
      category.categorizationInstructions || undefined,
    isSystem: category.isSystem || false,
  };
}
