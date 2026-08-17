"use client";
import { t as translate } from "@/i18n/translate";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { RiSearchLine } from "@remixicon/react";

export function SearchButton() {
  const handleClick = React.useCallback(() => {
    // Dispatch keyboard event to trigger command palette
    const event = new KeyboardEvent("keydown", {
      key: "k",
      code: "KeyK",
      metaKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event);
  }, []);

  return (
    <Button
      variant="outline"
      className="h-9 w-full justify-between px-3 bg-transparent sm:w-[200px]"
      onClick={handleClick}
    >
      <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <RiSearchLine className="h-4 w-4 shrink-0" />
        <span className="truncate">{translate("search6d7a30")}</span>
      </span>
      <kbd className="pointer-events-none ml-1 hidden h-5 select-none items-center gap-0.5 border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
        <span className="text-xs">⌘</span>K
      </kbd>
    </Button>
  );
}
