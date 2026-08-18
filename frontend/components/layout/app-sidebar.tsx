"use client";
import { t as translate } from "@/i18n/translate";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { useTheme } from "next-themes";
import {
  RiHomeLine,
  RiExchangeLine,
  RiSettings3Line,
  RiLogoutBoxLine,
  RiWallet3Line,
  RiArrowUpDownLine,
  RiLoopRightLine,
  RiPieChart2Line,
  RiLineChartLine,
  RiFileTextLine,
  RiArrowRightSLine,
  RiArrowLeftSLine,
  RiCloseLine,
  RiGlobalLine,
  RiComputerLine,
  RiMoonLine,
  RiSunLine,
} from "@remixicon/react";
import { HelpButton } from "@/components/walkthrough/help-button";
import { signOut, useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  GLOBAL_FILTER_STORAGE_KEY,
  normalizeGlobalFilterQueryString,
} from "@/lib/filters/global-filters";
import {
  localeCookieName,
  localeNameKeys,
  locales,
  type Locale,
} from "@/i18n/config";

type SidebarUser = {
  name?: string | null;
  email?: string | null;
  profilePhotoPath?: string | null;
  image?: string | null;
};

interface AppSidebarProps {
  initialUser?: SidebarUser | null;
}

const navItems = [
  {
    title: translate("home"),
    href: "/",
    icon: RiHomeLine,
  },
  {
    title: translate("transactions"),
    href: "/transactions",
    icon: RiExchangeLine,
  },
  {
    title: translate("subscriptions"),
    href: "/subscriptions",
    icon: RiLoopRightLine,
  },
  {
    title: translate("budgets"),
    href: "/budgets",
    icon: RiPieChart2Line,
  },
  {
    title: translate("investments"),
    href: "/investments",
    icon: RiLineChartLine,
  },
  {
    title: translate("assets"),
    href: "/assets",
    icon: RiWallet3Line,
  },
  {
    title: translate("reports"),
    href: "/reports",
    icon: RiFileTextLine,
  },
  {
    title: translate("settings"),
    href: "/settings",
    icon: RiSettings3Line,
  },
];

function subscribeToGlobalFilterStorage(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

function getStoredGlobalFilterQueryString() {
  try {
    return normalizeGlobalFilterQueryString(
      localStorage.getItem(GLOBAL_FILTER_STORAGE_KEY),
    );
  } catch {
    return "";
  }
}

function getServerGlobalFilterQueryString() {
  return "";
}

export function AppSidebar({ initialUser }: AppSidebarProps) {
  const activeLocale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const { theme, setTheme } = useTheme();
  const { isMobile, state, setOpen, setOpenMobile } = useSidebar();
  const [hasMarkError, setHasMarkError] = useState(false);
  const [avatarLoadError, setAvatarLoadError] = useState(false);
  const storedFilterQueryString = useSyncExternalStore(
    subscribeToGlobalFilterStorage,
    getStoredGlobalFilterQueryString,
    getServerGlobalFilterQueryString,
  );
  const isCollapsed = !isMobile && state === "collapsed";
  const brandImageSrc =
    isCollapsed && !hasMarkError
      ? "/brand/syllogic-mark.png"
      : "/brand/syllogic-logo.png";
  const resolvedUser: SidebarUser | undefined =
    (session?.user as SidebarUser | undefined) ?? initialUser ?? undefined;
  const avatarSrc =
    resolvedUser?.profilePhotoPath ?? resolvedUser?.image ?? undefined;
  const showAvatarFallback = !avatarSrc || avatarLoadError;

  const currentFilterQueryString = useMemo(
    () => normalizeGlobalFilterQueryString(searchParams.toString()),
    [searchParams],
  );

  const sharedFilterQueryString =
    currentFilterQueryString || storedFilterQueryString;
  const homePathWithFilters = sharedFilterQueryString
    ? `/?${sharedFilterQueryString}`
    : "/";
  const transactionsPathWithFilters = sharedFilterQueryString
    ? `/transactions?${sharedFilterQueryString}`
    : "/transactions";

  const handleSignOut = async () => {
    await signOut();
    window.location.href = "/login";
  };

  const handleLocaleChange = (locale: string) => {
    if (!locales.includes(locale as Locale) || locale === activeLocale) return;

    document.cookie = `${localeCookieName}=${encodeURIComponent(locale)}; Path=/; Max-Age=31536000; SameSite=Lax`;
    router.refresh();
  };

  const getInitials = (name?: string | null) => {
    if (!name) return "U";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center gap-1">
              <SidebarMenuButton
                size="lg"
                onClick={() => router.push(homePathWithFilters)}
                className={isCollapsed ? "justify-center" : "w-full"}
              >
                <div className="bg-sidebar-accent border-sidebar-border flex aspect-square size-8 items-center justify-center overflow-hidden border shrink-0">
                  <img
                    src={brandImageSrc}
                    alt={translate("syllogic")}
                    className="h-full w-full object-contain"
                    onError={() => {
                      if (isCollapsed) {
                        setHasMarkError(true);
                      }
                    }}
                  />
                </div>
                {!isCollapsed && (
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">
                      {translate("syllogic")}
                    </span>
                  </div>
                )}
              </SidebarMenuButton>
              {isMobile && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={translate("closeSidebar")}
                  className="shrink-0"
                  onClick={() => setOpenMobile(false)}
                >
                  <RiCloseLine className="size-4" />
                </Button>
              )}
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {navItems.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname === item.href ||
                    pathname.startsWith(item.href + "/");
              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={isActive}
                    render={
                      <Link
                        href={
                          item.href === "/"
                            ? homePathWithFilters
                            : item.href === "/transactions"
                              ? transactionsPathWithFilters
                              : item.href
                        }
                        prefetch
                        onClick={() => {
                          if (isMobile) {
                            setOpenMobile(false);
                          }
                        }}
                        title={isCollapsed ? item.title : undefined}
                      />
                    }
                  >
                    <item.icon className="shrink-0" />
                    {!isCollapsed && <span>{item.title}</span>}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
        {!isMobile && (
          <SidebarGroup className="mt-auto pt-2">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => setOpen((prev) => !prev)}
                  aria-label={
                    isCollapsed
                      ? translate("expandSidebar")
                      : translate("collapseSidebar")
                  }
                >
                  {isCollapsed ? (
                    <RiArrowRightSLine className="shrink-0" />
                  ) : (
                    <RiArrowLeftSLine className="shrink-0" />
                  )}
                  {!isCollapsed && <span>{translate("collapse")}</span>}
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <HelpButton />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <Avatar className="h-8 w-8 shrink-0">
                    {avatarSrc && !avatarLoadError && (
                      <img
                        src={avatarSrc}
                        alt={resolvedUser?.name || translate("user")}
                        loading="eager"
                        decoding="async"
                        className="size-full object-cover"
                        onError={() => setAvatarLoadError(true)}
                      />
                    )}
                    {showAvatarFallback && (
                      <AvatarFallback>
                        {getInitials(resolvedUser?.name)}
                      </AvatarFallback>
                    )}
                  </Avatar>
                  {!isCollapsed && (
                    <>
                      <div className="grid flex-1 text-left text-sm leading-tight">
                        <span className="truncate font-medium">
                          {resolvedUser?.name || translate("user")}
                        </span>
                        <span className="truncate text-xs">
                          {resolvedUser?.email}
                        </span>
                      </div>
                      <RiArrowUpDownLine className="ml-auto size-4" />
                    </>
                  )}
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="min-w-56"
                side={isMobile ? "bottom" : "right"}
                align="end"
                sideOffset={4}
              >
                <DropdownMenuItem onClick={() => router.push("/settings")}>
                  <RiSettings3Line className="mr-2" />
                  {translate("settings")}
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <RiGlobalLine className="mr-2" />
                    {translate("language")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuRadioGroup
                      value={activeLocale}
                      onValueChange={handleLocaleChange}
                    >
                      {locales.map((locale) => (
                        <DropdownMenuRadioItem key={locale} value={locale}>
                          {translate(localeNameKeys[locale])}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    {theme === "light" ? (
                      <RiSunLine className="mr-2" />
                    ) : theme === "dark" ? (
                      <RiMoonLine className="mr-2" />
                    ) : (
                      <RiComputerLine className="mr-2" />
                    )}
                    {translate("theme")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuRadioGroup
                      value={theme ?? "system"}
                      onValueChange={setTheme}
                    >
                      <DropdownMenuRadioItem value="light">
                        <RiSunLine />
                        {translate("light")}
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="dark">
                        <RiMoonLine />
                        {translate("dark")}
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="system">
                        <RiComputerLine />
                        {translate("system")}
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <RiLogoutBoxLine className="mr-2" />
                  {translate("logOut")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
