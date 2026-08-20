import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { JetBrains_Mono } from "next/font/google";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { getOnboardingRedirectPath } from "@/lib/actions/onboarding";
import {
  getCachedSession,
  getCachedOnboardingStatus,
  getCachedUserPreferences,
} from "@/lib/data/cached";
import { ImportStatusNotifier } from "@/components/import-status-notifier";
import { MobileAddTransactionFab } from "@/components/transactions/mobile-add-transaction-fab";
import { WalkthroughProvider } from "@/components/walkthrough/walkthrough-provider";
import { HideBalancesProvider } from "@/components/hide-balances/hide-balances-provider";
import { getRegistrationStatus } from "@/lib/registration-settings";

const jbMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jb-mono",
  weight: ["400", "500", "600", "700"],
});

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const sidebarCookie = cookieStore.get("syllogic.sidebar.open")?.value;
  const defaultSidebarOpen = sidebarCookie === "true";

  const session = await getCachedSession();

  if (!session) {
    const registration = await getRegistrationStatus();
    redirect(
      registration.firstUserWillBeAdmin ? "/register?first=1" : "/login",
    );
  }

  // Check onboarding status and redirect if not completed.
  //
  // Note: `redirect()` throws a special Next.js error to trigger navigation.
  // Do NOT wrap this in a broad try/catch, or the redirect will be swallowed.
  const onboardingStatus = await getCachedOnboardingStatus();
  if (onboardingStatus && !onboardingStatus.isCompleted) {
    const redirectPath = await getOnboardingRedirectPath(
      onboardingStatus.status,
    );
    redirect(redirectPath);
  }

  const preferences = await getCachedUserPreferences();

  return (
    <SidebarProvider defaultOpen={defaultSidebarOpen}>
      <HideBalancesProvider initialHideBalances={preferences.hideBalances}>
        <WalkthroughProvider
          initialTutorialsEnabled={preferences.tutorialsEnabled}
        >
          <AppSidebar initialUser={session.user} />
          <SidebarInset className={cn(jbMono.variable, "pb-24 md:pb-0")}>
            {children}
          </SidebarInset>
          <ImportStatusNotifier />
          <MobileAddTransactionFab />
        </WalkthroughProvider>
      </HideBalancesProvider>
    </SidebarProvider>
  );
}
