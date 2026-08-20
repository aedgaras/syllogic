"use client";
import { t as translate } from "@/i18n/translate";

import { useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeDecimalInput } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RiArrowDownSLine } from "@remixicon/react";

export interface CategoryMultiSelectOption {
  id: string;
  name: string;
  color: string | null;
}

interface CategoryMultiSelectProps {
  options: CategoryMultiSelectOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  usage?: Record<string, Array<{ budgetId: string; budgetName: string }>>;
  label?: string;
  error?: string;
  subLimits?: Record<string, string>;
  onSubLimitChange?: (categoryId: string, value: string) => void;
}

export function CategoryMultiSelect({
  options,
  value,
  onChange,
  usage,
  label,
  error,
  subLimits,
  onSubLimitChange,
}: CategoryMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filteredOptions = useMemo(() => {
    if (!search) return options;
    return options.filter((option) =>
      option.name.toLowerCase().includes(search.toLowerCase()),
    );
  }, [options, search]);

  const selectedOptions = useMemo(
    () => options.filter((option) => value.includes(option.id)),
    [options, value],
  );

  function toggleOption(id: string) {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id));
      return;
    }
    onChange([...value, id]);
  }

  return (
    <div className="grid gap-2">
      {label && <Label>{label}</Label>}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className="flex h-8 w-full items-center justify-between border border-input bg-background px-2.5 text-xs hover:bg-accent hover:text-accent-foreground">
          <span className="truncate text-left">
            {value.length === 0
              ? translate("selectCategories")
              : `${value.length} selected`}
          </span>
          <RiArrowDownSLine className="h-4 w-4 shrink-0 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <div className="border-b p-2">
            <Input
              placeholder={translate("search", { value1: "categories" })}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {filteredOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => toggleOption(option.id)}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent"
              >
                <Checkbox
                  checked={value.includes(option.id)}
                  className="pointer-events-none"
                />
                {option.color ? (
                  <span
                    className="inline-flex items-center truncate px-1.5 py-0.5 text-xs text-white"
                    style={{ backgroundColor: option.color }}
                  >
                    {option.name}
                  </span>
                ) : (
                  <span className="truncate">{option.name}</span>
                )}
              </button>
            ))}
            {filteredOptions.length === 0 && (
              <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                {translate("noResultsFound")}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {selectedOptions.length > 0 && (
        <div className="flex flex-col gap-2">
          {selectedOptions.map((option) => {
            const otherBudgets = usage?.[option.id];
            return (
              <div key={option.id} className="flex flex-wrap items-center gap-2">
                <span
                  className="inline-flex items-center truncate px-1.5 py-0.5 text-xs text-white"
                  style={{ backgroundColor: option.color || "#6B7280" }}
                >
                  {option.name}
                </span>
                {otherBudgets && otherBudgets.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {translate("alsoUsedInBudget", {
                      value1: otherBudgets.map((b) => b.budgetName).join(", "),
                    })}
                  </span>
                )}
                {onSubLimitChange && (
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder={translate("subBudgetOptional")}
                    value={subLimits?.[option.id] ?? ""}
                    onChange={(event) =>
                      onSubLimitChange(
                        option.id,
                        normalizeDecimalInput(event.target.value),
                      )
                    }
                    className="h-7 w-32 text-xs"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
