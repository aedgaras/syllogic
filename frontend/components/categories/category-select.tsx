"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface CategorySelectOption {
  id: string;
  name: string;
  color?: string | null;
}

interface CategorySelectProps {
  categories: CategorySelectOption[];
  value: string;
  onChange: (categoryId: string) => void;
  noneLabel: string;
  placeholder?: string;
  id?: string;
  className?: string;
  showSwatch?: boolean;
  swatchShape?: "circle" | "square";
  fallbackColor?: string;
}

export function CategorySelect({
  categories,
  value,
  onChange,
  noneLabel,
  placeholder = noneLabel,
  id,
  className,
  showSwatch = true,
  swatchShape = "circle",
  fallbackColor = "#A1A1AA",
}: CategorySelectProps) {
  const selected = value
    ? categories.find((c) => c.id === value)
    : undefined;

  const swatchClassName = cn(
    "h-3 w-3 shrink-0",
    swatchShape === "circle" ? "rounded-full" : undefined,
  );

  return (
    <Select value={value} onValueChange={(v) => onChange(v ?? "")}>
      <SelectTrigger id={id} className={className}>
        <SelectValue placeholder={placeholder}>
          {selected ? (
            showSwatch ? (
              <div className="flex items-center gap-2">
                <div
                  className={swatchClassName}
                  style={{ backgroundColor: selected.color || fallbackColor }}
                />
                <span>{selected.name}</span>
              </div>
            ) : (
              selected.name
            )
          ) : (
            noneLabel
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="">{noneLabel}</SelectItem>
        {categories.map((category) => (
          <SelectItem key={category.id} value={category.id}>
            {showSwatch ? (
              <div className="flex items-center gap-2">
                <div
                  className={swatchClassName}
                  style={{ backgroundColor: category.color || fallbackColor }}
                />
                {category.name}
              </div>
            ) : (
              category.name
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
