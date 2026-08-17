"use client";

import { RiComputerLine, RiMoonLine, RiSunLine } from "@remixicon/react";
import { useTheme } from "next-themes";
import { t as translate } from "@/i18n/translate";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const themeOptions = [
  { value: "light", label: translate("light"), icon: RiSunLine },
  { value: "dark", label: translate("dark"), icon: RiMoonLine },
  { value: "system", label: translate("system"), icon: RiComputerLine },
] as const;

export function ThemeSelector({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const selectedTheme = theme ?? "system";

  return (
    <div
      role="radiogroup"
      aria-label={translate("theme")}
      className={cn("grid grid-cols-3 gap-2", className)}
    >
      {themeOptions.map((option) => {
        const isSelected = selectedTheme === option.value;

        return (
          <Button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            variant={isSelected ? "default" : "outline"}
            className="h-auto min-h-16 flex-col gap-1.5"
            onClick={() => setTheme(option.value)}
          >
            <option.icon className="size-4" />
            <span>{option.label}</span>
          </Button>
        );
      })}
    </div>
  );
}
