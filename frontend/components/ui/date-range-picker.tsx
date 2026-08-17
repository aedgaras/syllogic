"use client";
import { t as translate } from "@/i18n/translate";

import * as React from "react";
import { type DateRange } from "react-day-picker";
import {
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfQuarter,
  endOfQuarter,
  startOfYear,
  endOfYear,
  subMonths,
  subQuarters,
  subYears,
  format,
} from "date-fns";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { RiCalendarLine, RiArrowDownSLine } from "@remixicon/react";
import { cn } from "@/lib/utils";

// Date range presets
const datePresets = [
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
    label: translate("lastMonth20fe4f"),
    getValue: () => ({
      from: startOfMonth(subMonths(new Date(), 1)),
      to: endOfMonth(subMonths(new Date(), 1)),
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
    label: translate("lastQuarter"),
    getValue: () => ({
      from: startOfQuarter(subQuarters(new Date(), 1)),
      to: endOfQuarter(subQuarters(new Date(), 1)),
    }),
  },
  {
    label: translate("thisYear"),
    getValue: () => ({
      from: startOfYear(new Date()),
      to: endOfYear(new Date()),
    }),
  },
  {
    label: translate("lastYear"),
    getValue: () => ({
      from: startOfYear(subYears(new Date(), 1)),
      to: endOfYear(subYears(new Date(), 1)),
    }),
  },
];

interface DateRangePickerProps {
  value: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
  className?: string;
  placeholder?: string;
  showIcon?: boolean;
  showSelectedText?: boolean;
  active?: boolean;
}

export function DateRangePicker({
  value,
  onChange,
  className,
  placeholder = "All time",
  showIcon = true,
  showSelectedText = true,
  active = false,
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);

  const getDisplayText = () => {
    if (!value?.from) return placeholder;
    if (!showSelectedText) return placeholder;
    if (!value.to) return format(value.from, "MMM d, yyyy");
    return `${format(value.from, "MMM d")} - ${format(value.to, "MMM d, yyyy")}`;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "flex items-center justify-between gap-2 border border-input px-2.5 text-xs transition-colors",
          active
            ? "bg-primary text-primary-foreground hover:bg-primary/90"
            : "bg-transparent text-foreground hover:bg-muted",
          className,
        )}
      >
        {showIcon && (
          <RiCalendarLine
            className={cn(
              "h-4 w-4",
              active ? "text-primary-foreground" : "text-muted-foreground",
            )}
          />
        )}
        <span className="truncate">{getDisplayText()}</span>
        <RiArrowDownSLine
          className={cn(
            "h-4 w-4 shrink-0",
            active ? "text-primary-foreground" : "text-muted-foreground",
          )}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <div className="flex">
          <div className="border-r p-2 space-y-0.5 w-32">
            <button
              type="button"
              onClick={() => {
                onChange(undefined);
                setOpen(false);
              }}
              className={cn(
                "w-full whitespace-nowrap px-2 py-1.5 text-left text-xs hover:bg-accent",
                !value?.from && "bg-accent",
              )}
            >
              {translate("allTime")}
            </button>
            {datePresets.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  onChange(preset.getValue());
                  setOpen(false);
                }}
                className="w-full whitespace-nowrap px-2 py-1.5 text-left text-xs hover:bg-accent"
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="p-2">
            <Calendar
              mode="range"
              selected={value}
              onSelect={(range) => onChange(range)}
              numberOfMonths={1}
              defaultMonth={value?.from}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
