"use client";

import type * as React from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

interface HeaderProps {
  title?: string;
  action?: React.ReactNode;
  shortcut?: string;
  className?: string;
}

export function Header({ title, action, shortcut, className }: HeaderProps) {
  return (
    <header
      className={cn(
        "flex min-h-12 shrink-0 flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2 sm:flex-nowrap",
        className
      )}
    >
      <SidebarTrigger className="-ml-1 md:hidden" />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {title && (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="min-w-0 break-words text-sm font-medium leading-5">{title}</h1>
            {shortcut && (
              <kbd className="pointer-events-none hidden h-5 select-none items-center border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-60 sm:flex">
                {shortcut}
              </kbd>
            )}
          </div>
        )}
      </div>
      {action && (
        <div className="flex max-w-full basis-full flex-wrap items-center justify-start gap-2 sm:ml-auto sm:basis-auto sm:justify-end">
          {action}
        </div>
      )}
    </header>
  );
}
