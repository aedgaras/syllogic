"use client";
import { t as translate } from "@/i18n/translate";

import * as React from "react";
import { type DateRange } from "react-day-picker";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import {
  RiArrowDownSLine,
  RiCalendarLine,
  RiCloseLine,
  RiMoneyDollarCircleLine,
} from "@remixicon/react";
import { cn, normalizeDecimalInput } from "@/lib/utils";

export interface FilterOption {
  id: string;
  label: string;
  color?: string;
}

interface MultiSelectFilterProps {
  label: string;
  icon: React.ReactNode;
  options: FilterOption[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  includeUncategorized?: boolean;
  searchable?: boolean;
  /** Overrides the display label when exactly one of these ids is selected. */
  singleSelectionLabelOverrides?: Record<string, string>;
}

export function MultiSelectFilter({
  label,
  icon,
  options,
  selectedIds,
  onSelectionChange,
  includeUncategorized,
  searchable,
  singleSelectionLabelOverrides,
}: MultiSelectFilterProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const filteredOptions = React.useMemo(() => {
    if (!search) return options;
    return options.filter((opt) =>
      opt.label.toLowerCase().includes(search.toLowerCase()),
    );
  }, [options, search]);

  const toggleOption = (id: string) => {
    if (selectedIds.includes(id)) {
      onSelectionChange(selectedIds.filter((value) => value !== id));
      return;
    }
    onSelectionChange([...selectedIds, id]);
  };

  const getDisplayText = () => {
    if (selectedIds.length === 0) return "Select...";
    if (selectedIds.length === 1) {
      const override = singleSelectionLabelOverrides?.[selectedIds[0]];
      if (override) return override;
      const option = options.find((item) => item.id === selectedIds[0]);
      return option?.label || selectedIds[0];
    }
    return `${selectedIds.length} selected`;
  };

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
        {selectedIds.length > 0 && (
          <span className="text-foreground">({selectedIds.length})</span>
        )}
      </Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className="flex h-8 w-full items-center justify-between border border-input bg-background px-2.5 text-xs hover:bg-accent hover:text-accent-foreground">
          <span className="truncate">{getDisplayText()}</span>
          <RiArrowDownSLine className="h-4 w-4 shrink-0 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-0">
          {searchable && (
            <div className="border-b p-2">
              <Input
                placeholder={translate("search", {
                  value1: label.toLowerCase(),
                })}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-7"
              />
            </div>
          )}
          <div className="max-h-48 overflow-y-auto p-1">
            {includeUncategorized && !search && (
              <button
                type="button"
                onClick={() => toggleOption("uncategorized")}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent"
              >
                <Checkbox
                  checked={selectedIds.includes("uncategorized")}
                  className="pointer-events-none"
                />
                <span className="inline-flex items-center bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {translate("uncategorized")}
                </span>
              </button>
            )}
            {filteredOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => toggleOption(option.id)}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent"
              >
                <Checkbox
                  checked={selectedIds.includes(option.id)}
                  className="pointer-events-none"
                />
                {option.color ? (
                  <span
                    className="inline-flex items-center truncate px-1.5 py-0.5 text-xs text-white"
                    style={{ backgroundColor: option.color }}
                  >
                    {option.label}
                  </span>
                ) : (
                  <span className="truncate">{option.label}</span>
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
    </div>
  );
}

export interface DateRangePreset {
  label: string;
  getValue: () => DateRange;
}

interface DateRangeFilterProps {
  dateRange: DateRange | undefined;
  onDateRangeChange: (range: DateRange | undefined) => void;
  presets: DateRangePreset[];
  clearLabel: string;
  formatDisplay: (range: DateRange | undefined) => string;
}

export function DateRangeFilter({
  dateRange,
  onDateRangeChange,
  presets,
  clearLabel,
  formatDisplay,
}: DateRangeFilterProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-2 text-xs text-muted-foreground">
        <RiCalendarLine className="h-4 w-4" />
        {translate("dateRange")}
        {dateRange?.from && <span className="text-foreground">(1)</span>}
      </Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className="flex h-8 w-full items-center justify-between border border-input bg-background px-2.5 text-xs hover:bg-accent hover:text-accent-foreground">
          <span className="truncate">{formatDisplay(dateRange)}</span>
          <RiArrowDownSLine className="h-4 w-4 shrink-0 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[calc(100vw-2rem)] p-0 sm:w-auto"
        >
          <div className="flex flex-col sm:flex-row">
            <div className="w-full space-y-0.5 border-b p-2 sm:w-28 sm:border-b-0 sm:border-r">
              <button
                type="button"
                onClick={() => {
                  onDateRangeChange(undefined);
                  setOpen(false);
                }}
                className={cn(
                  "w-full px-2 py-1.5 text-left text-xs hover:bg-accent",
                  !dateRange?.from && "bg-accent",
                )}
              >
                {clearLabel}
              </button>
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    onDateRangeChange(preset.getValue());
                    setOpen(false);
                  }}
                  className="w-full px-2 py-1.5 text-left text-xs hover:bg-accent"
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="p-2">
              <Calendar
                mode="range"
                selected={dateRange}
                onSelect={(range) => onDateRangeChange(range)}
                numberOfMonths={1}
                defaultMonth={dateRange?.from}
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

interface AmountRangeFilterProps {
  minAmount: string;
  maxAmount: string;
  onMinChange: (value: string) => void;
  onMaxChange: (value: string) => void;
}

export function AmountRangeFilter({
  minAmount,
  maxAmount,
  onMinChange,
  onMaxChange,
}: AmountRangeFilterProps) {
  const hasFilter = minAmount || maxAmount;

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-2 text-xs text-muted-foreground">
        <RiMoneyDollarCircleLine className="h-4 w-4" />
        {translate("amountRange")}
        {hasFilter && <span className="text-foreground">(1)</span>}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          type="text"
          inputMode="decimal"
          placeholder={translate("min")}
          value={minAmount}
          onChange={(event) =>
            onMinChange(normalizeDecimalInput(event.target.value))
          }
          className="h-8"
        />
        <span className="text-xs text-muted-foreground">{translate("to")}</span>
        <Input
          type="text"
          inputMode="decimal"
          placeholder={translate("max")}
          value={maxAmount}
          onChange={(event) =>
            onMaxChange(normalizeDecimalInput(event.target.value))
          }
          className="h-8"
        />
      </div>
    </div>
  );
}

interface FilterTagProps {
  label: string;
  onRemove: () => void;
}

export function FilterTag({ label, onRemove }: FilterTagProps) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="inline-flex items-center gap-1 bg-muted px-2 py-0.5 text-xs hover:bg-muted/80"
    >
      {label}
      <RiCloseLine className="h-3 w-3" />
    </button>
  );
}
