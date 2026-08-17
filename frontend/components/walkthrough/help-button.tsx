"use client";
import { t as translate } from "@/i18n/translate";

import { usePathname } from "next/navigation";
import { RiInformationLine } from "@remixicon/react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar";
import { useWalkthroughStore, getPageConfig } from "./walkthrough-store";

export function HelpButton() {
  const pathname = usePathname();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const config = getPageConfig(pathname);
  const {
    tutorialsEnabled,
    openOverview,
    startWalkthrough,
    closeOverview,
    showOverview,
    currentPage,
  } = useWalkthroughStore();

  if (!config || !tutorialsEnabled) return null;

  const handleStartTour = () => {
    closeOverview();
    // Defer so popover can unmount before tour overlay appears
    requestAnimationFrame(() => {
      startWalkthrough(config.page);
    });
  };

  const isOpen = showOverview && currentPage === config.page;

  return (
    <Popover open={isOpen} onOpenChange={(open) => !open && closeOverview()}>
      <PopoverTrigger
        render={
          <SidebarMenuButton
            tooltip={translate("help")}
            onClick={() =>
              isOpen ? closeOverview() : openOverview(config.page)
            }
            className="data-[popup-open]:bg-sidebar-accent data-[popup-open]:text-sidebar-accent-foreground"
          >
            <RiInformationLine className="shrink-0" />
            {!isCollapsed && <span>{translate("help")}</span>}
          </SidebarMenuButton>
        }
      />
      <PopoverContent
        side={isCollapsed ? "right" : "top"}
        align="start"
        sideOffset={8}
        className="w-72"
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{config.overview}</p>
          <p className="text-xs text-muted-foreground">
            {translate("youCanAlwaysRestartThisTourFromTheHelp")}
          </p>
          <Button size="sm" onClick={handleStartTour} className="w-full">
            {translate("startTour")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
