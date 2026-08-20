"use client";

import { useHideBalances } from "@/components/hide-balances/hide-balances-provider";

/** Renders a formatted amount, or a mask when the user has hidden balances. */
export function MaskableAmount({
  value,
  mask = "••••",
}: {
  value: string;
  mask?: string;
}) {
  const { hideBalances } = useHideBalances();
  if (hideBalances) {
    return <span aria-hidden="true">{mask}</span>;
  }
  return <>{value}</>;
}
