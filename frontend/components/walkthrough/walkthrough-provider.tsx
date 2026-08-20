"use client";

import { Suspense, useEffect } from "react";
import { usePathname } from "next/navigation";
import { WalkthroughOverlay } from "./walkthrough-overlay";
import { WalkthroughPopover } from "./walkthrough-popover";
import { WalkthroughAutoStart } from "./walkthrough-auto-start";
import {
  useWalkthroughStore,
  PAGE_CONFIGS,
  getPageConfig,
} from "./walkthrough-store";

export function WalkthroughProvider({
  initialTutorialsEnabled,
  children,
}: {
  initialTutorialsEnabled: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const {
    isActive,
    currentPage,
    currentStepIndex,
    skipWalkthrough,
    nextStep,
    previousStep,
    hydrateTutorialsEnabled,
  } = useWalkthroughStore();

  // Sync tutorialsEnabled from the DB-backed value on load, overriding any
  // stale localStorage value from before this became a per-user DB setting.
  useEffect(() => {
    hydrateTutorialsEnabled(initialTutorialsEnabled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTutorialsEnabled]);

  // Close walkthrough when navigating to a different page
  useEffect(() => {
    if (isActive && currentPage) {
      const expectedPage = getPageConfig(pathname)?.page ?? null;
      if (expectedPage !== currentPage) {
        skipWalkthrough();
      }
    }
  }, [pathname, isActive, currentPage, skipWalkthrough]);

  const config = currentPage
    ? PAGE_CONFIGS[currentPage as keyof typeof PAGE_CONFIGS]
    : null;
  const step = config?.steps?.[currentStepIndex] ?? null;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActive) return;
      if (e.key === "Escape") {
        skipWalkthrough();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        nextStep();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        previousStep();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isActive, nextStep, previousStep, skipWalkthrough]);

  return (
    <>
      <Suspense fallback={null}>
        <WalkthroughAutoStart />
      </Suspense>
      {children}
      {isActive && step && (
        <>
          <WalkthroughOverlay step={step} />
          <WalkthroughPopover step={step} />
        </>
      )}
    </>
  );
}
