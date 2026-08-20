"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { updateHideBalances } from "@/lib/actions/settings";

type HideBalancesContextValue = {
  hideBalances: boolean;
  setHideBalances: (hide: boolean) => void;
};

// Default when rendered outside a provider (e.g. surfaces mounted in the
// root layout, like the command palette, that render on unauthenticated
// pages too): show balances unmasked, ignore toggle attempts.
const defaultContextValue: HideBalancesContextValue = {
  hideBalances: false,
  setHideBalances: () => {},
};

const HideBalancesContext = createContext<HideBalancesContextValue>(
  defaultContextValue,
);

export function HideBalancesProvider({
  initialHideBalances,
  children,
}: {
  initialHideBalances: boolean;
  children: React.ReactNode;
}) {
  const [hideBalances, setHideBalancesState] = useState(initialHideBalances);

  const setHideBalances = useCallback((hide: boolean) => {
    setHideBalancesState(hide);
    void updateHideBalances(hide);
  }, []);

  return (
    <HideBalancesContext.Provider value={{ hideBalances, setHideBalances }}>
      {children}
    </HideBalancesContext.Provider>
  );
}

export function useHideBalances(): HideBalancesContextValue {
  return useContext(HideBalancesContext);
}
