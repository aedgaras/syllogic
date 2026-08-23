"use client";
import { t as translate } from "@/i18n/translate";

import * as React from "react";
import { type Table } from "@tanstack/react-table";
import { type DateRange } from "react-day-picker";
import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfQuarter,
  endOfQuarter,
  startOfYear,
  endOfYear,
  subDays,
  format,
} from "date-fns";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  RiSearchLine,
  RiFilter3Line,
  RiPriceTag3Line,
  RiTimeLine,
  RiRepeatLine,
} from "@remixicon/react";
import type { TransactionWithRelations } from "@/features/transactions/public";
import type { CategoryForFilter } from "@/shared/domain/display-contracts";
import {
  MultiSelectFilter,
  DateRangeFilter,
  AmountRangeFilter,
  FilterTag,
  type FilterOption,
} from "@/components/filters/filter-controls";

interface AccountTransactionFiltersProps {
  table: Table<TransactionWithRelations>;
  categories: CategoryForFilter[];
}

const datePresets = [
  {
    label: translate("today"),
    getValue: () => ({
      from: startOfDay(new Date()),
      to: endOfDay(new Date()),
    }),
  },
  {
    label: translate("yesterday"),
    getValue: () => ({
      from: startOfDay(subDays(new Date(), 1)),
      to: endOfDay(subDays(new Date(), 1)),
    }),
  },
  {
    label: translate("thisWeek"),
    getValue: () => ({
      from: startOfWeek(new Date(), { weekStartsOn: 1 }),
      to: endOfWeek(new Date(), { weekStartsOn: 1 }),
    }),
  },
  {
    label: translate("thisMonth"),
    getValue: () => ({
      from: startOfMonth(new Date()),
      to: endOfMonth(new Date()),
    }),
  },
  {
    label: translate("thisQuarter"),
    getValue: () => ({
      from: startOfQuarter(new Date()),
      to: endOfQuarter(new Date()),
    }),
  },
  {
    label: translate("thisYear"),
    getValue: () => ({
      from: startOfYear(new Date()),
      to: endOfYear(new Date()),
    }),
  },
];

function formatDateRangeDisplay(range: DateRange | undefined): string {
  if (!range?.from) return "All time";
  if (!range.to) return format(range.from, "MMM d, yyyy");
  return `${format(range.from, "MMM d")} - ${format(range.to, "MMM d, yyyy")}`;
}

export function AccountTransactionFilters({
  table,
  categories,
}: AccountTransactionFiltersProps) {
  const descriptionColumn = table.getColumn("description");
  const categoryColumn = table.getColumn("category");
  const pendingColumn = table.getColumn("pending");
  const bookedAtColumn = table.getColumn("bookedAt");
  const amountColumn = table.getColumn("amount");
  const recurringTransactionColumn = table.getColumn("recurringTransaction");

  const descriptionValue =
    (descriptionColumn?.getFilterValue() as string) ?? "";
  const categoryValues = (categoryColumn?.getFilterValue() as string[]) ?? [];
  const statusValues = (pendingColumn?.getFilterValue() as string[]) ?? [];
  const recurringTransactionValues =
    (recurringTransactionColumn?.getFilterValue() as string[]) ?? [];
  const dateRange = bookedAtColumn?.getFilterValue() as DateRange | undefined;
  const amountRange = amountColumn?.getFilterValue() as
    | { min?: string; max?: string }
    | undefined;
  const minAmount = amountRange?.min ?? "";
  const maxAmount = amountRange?.max ?? "";

  const activeFilterCount =
    categoryValues.length +
    statusValues.length +
    recurringTransactionValues.length +
    (dateRange?.from ? 1 : 0) +
    (minAmount || maxAmount ? 1 : 0);

  const clearFilters = () => {
    categoryColumn?.setFilterValue([]);
    pendingColumn?.setFilterValue([]);
    recurringTransactionColumn?.setFilterValue([]);
    bookedAtColumn?.setFilterValue(undefined);
    amountColumn?.setFilterValue(undefined);
  };

  const categoryOptions: FilterOption[] = categories.map((cat) => ({
    id: cat.id,
    label: cat.name,
    color: cat.color ?? undefined,
  }));

  const statusOptions: FilterOption[] = [
    { id: "completed", label: translate("completed") },
    { id: "pending", label: translate("pending") },
  ];

  const recurringTransactionMap = new Map<
    string,
    { id: string; name: string; merchant?: string; frequency: string }
  >();
  table.getPreFilteredRowModel().rows.forEach((row) => {
    const recurring = row.original.recurringTransaction;
    if (recurring && !recurringTransactionMap.has(recurring.id)) {
      recurringTransactionMap.set(recurring.id, {
        id: recurring.id,
        name: recurring.name,
        merchant: recurring.merchant ?? undefined,
        frequency: recurring.frequency,
      });
    }
  });
  const recurringTransactionOptions: FilterOption[] = Array.from(
    recurringTransactionMap.values(),
  ).map((rt) => ({
    id: rt.id,
    label: rt.merchant
      ? translate("message", { value1: rt.name, value2: rt.merchant })
      : rt.name,
  }));

  const filterTags: { label: string; onRemove: () => void }[] = [];

  categoryValues.forEach((id) => {
    if (id === "uncategorized") {
      filterTags.push({
        label: translate("uncategorized"),
        onRemove: () =>
          categoryColumn?.setFilterValue(
            categoryValues.filter((v) => v !== id),
          ),
      });
    } else {
      const cat = categories.find((c) => c.id === id);
      if (cat) {
        filterTags.push({
          label: cat.name,
          onRemove: () =>
            categoryColumn?.setFilterValue(
              categoryValues.filter((v) => v !== id),
            ),
        });
      }
    }
  });

  statusValues.forEach((id) => {
    filterTags.push({
      label: id === "pending" ? translate("pending") : translate("completed"),
      onRemove: () =>
        pendingColumn?.setFilterValue(statusValues.filter((v) => v !== id)),
    });
  });

  recurringTransactionValues.forEach((id) => {
    if (id === "no_subscription") {
      filterTags.push({
        label: translate("noSubscription"),
        onRemove: () =>
          recurringTransactionColumn?.setFilterValue(
            recurringTransactionValues.filter((v) => v !== id),
          ),
      });
    } else {
      const rt = recurringTransactionMap.get(id);
      if (rt) {
        filterTags.push({
          label: rt.merchant
            ? translate("message", { value1: rt.name, value2: rt.merchant })
            : rt.name,
          onRemove: () =>
            recurringTransactionColumn?.setFilterValue(
              recurringTransactionValues.filter((v) => v !== id),
            ),
        });
      }
    }
  });

  if (dateRange?.from) {
    const label = dateRange.to
      ? translate("messagedca30a", {
          value1: format(dateRange.from, "MMM d"),
          value2: format(dateRange.to, "MMM d"),
        })
      : format(dateRange.from, translate("mmmDYyyy"));
    filterTags.push({
      label,
      onRemove: () => bookedAtColumn?.setFilterValue(undefined),
    });
  }

  if (minAmount || maxAmount) {
    let label = "";
    if (minAmount && maxAmount) {
      label = `${minAmount} - ${maxAmount}`;
    } else if (minAmount) {
      label = `>= ${minAmount}`;
    } else {
      label = `<= ${maxAmount}`;
    }
    filterTags.push({
      label,
      onRemove: () => amountColumn?.setFilterValue(undefined),
    });
  }

  const totalRows = table.getFilteredRowModel().rows.length;
  const totalUnfiltered = table.getPreFilteredRowModel().rows.length;
  const isFiltered = totalRows !== totalUnfiltered;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full sm:w-64">
          <RiSearchLine className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={translate("searchTransactions")}
            value={descriptionValue}
            onChange={(event) =>
              descriptionColumn?.setFilterValue(event.target.value)
            }
            className="pl-8"
          />
        </div>

        <Popover>
          <PopoverTrigger className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-transparent hover:bg-accent hover:text-accent-foreground h-8 px-3">
            <RiFilter3Line className="h-4 w-4" />
            {translate("filters")}
            {activeFilterCount > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center bg-muted px-1.5 text-2xs font-medium text-muted-foreground">
                {activeFilterCount}
              </span>
            )}
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-[calc(100vw-2rem)] sm:w-80"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {translate("filters")}
              </span>
              {activeFilterCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
                >
                  {translate("clearAll")}
                </Button>
              )}
            </div>

            <Separator className="my-3" />

            <div className="space-y-4">
              <DateRangeFilter
                dateRange={dateRange}
                onDateRangeChange={(range) =>
                  bookedAtColumn?.setFilterValue(range)
                }
                presets={datePresets}
                clearLabel={translate("allTime")}
                formatDisplay={formatDateRangeDisplay}
              />

              <MultiSelectFilter
                label={translate("category")}
                icon={<RiPriceTag3Line className="h-4 w-4" />}
                options={categoryOptions}
                selectedIds={categoryValues}
                onSelectionChange={(ids) => categoryColumn?.setFilterValue(ids)}
                includeUncategorized
                searchable
                singleSelectionLabelOverrides={{
                  uncategorized: "Uncategorized",
                }}
              />

              <MultiSelectFilter
                label={translate("status")}
                icon={<RiTimeLine className="h-4 w-4" />}
                options={statusOptions}
                selectedIds={statusValues}
                onSelectionChange={(ids) => pendingColumn?.setFilterValue(ids)}
              />

              <MultiSelectFilter
                label={translate("subscription")}
                icon={<RiRepeatLine className="h-4 w-4" />}
                options={[
                  { id: "no_subscription", label: "No Subscription" },
                  ...recurringTransactionOptions,
                ]}
                selectedIds={recurringTransactionValues}
                onSelectionChange={(ids) =>
                  recurringTransactionColumn?.setFilterValue(ids)
                }
                searchable
              />

              <AmountRangeFilter
                minAmount={minAmount}
                maxAmount={maxAmount}
                onMinChange={(value) =>
                  amountColumn?.setFilterValue({
                    ...amountRange,
                    min: value || undefined,
                  })
                }
                onMaxChange={(value) =>
                  amountColumn?.setFilterValue({
                    ...amountRange,
                    max: value || undefined,
                  })
                }
              />
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {filterTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {filterTags.map((tag, index) => (
            <FilterTag key={index} label={tag.label} onRemove={tag.onRemove} />
          ))}
        </div>
      )}

      {isFiltered && (
        <p className="text-xs text-muted-foreground">
          {translate("showing")} {totalRows} {translate("of")} {totalUnfiltered}{" "}
          {translate("transactions60858a")}
        </p>
      )}
    </div>
  );
}
