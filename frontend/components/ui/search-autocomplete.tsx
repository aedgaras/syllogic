"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface SearchAutocompleteProps<T> {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onSelect: (item: T) => void;
  items: T[];
  getItemKey: (item: T) => string;
  renderItem: (item: T, active: boolean) => React.ReactNode;
  loading?: boolean;
  loadingLabel?: string;
  placeholder?: string;
  className?: string;
}

export function SearchAutocomplete<T>({
  id,
  value,
  onChange,
  onSelect,
  items,
  getItemKey,
  renderItem,
  loading = false,
  loadingLabel,
  placeholder,
  className,
}: SearchAutocompleteProps<T>) {
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDismissed(false);
    setActiveIndex(-1);
  }, [items]);

  const open = !dismissed && items.length > 0;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setDismissed(true);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = (item: T) => {
    onSelect(item);
    setDismissed(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      handleSelect(items[activeIndex]);
    } else if (e.key === "Escape") {
      setDismissed(true);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      {loading && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          {loadingLabel}
        </span>
      )}
      {open && items.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full overflow-hidden rounded-none border bg-popover shadow-md">
          {items.map((item, i) => (
            <li
              key={getItemKey(item)}
              className={cn(
                "cursor-pointer px-3 py-2 text-xs hover:bg-accent",
                i === activeIndex && "bg-accent",
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(item);
              }}
            >
              {renderItem(item, i === activeIndex)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
