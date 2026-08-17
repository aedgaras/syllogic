"use client";
import { t as translate } from "@/i18n/translate";

import { useState } from "react";
import { RiArrowDownSLine, RiArrowRightSLine } from "@remixicon/react";
import { formatCurrency } from "@/lib/utils";
import { WeightBarVisualizer } from "./weight-bar-visualizer";
import type { AssetCategory, AssetAccount, AssetCategoryKey } from "./types";

interface AssetsTableProps {
  categories: AssetCategory[];
  currency: string;
}

// Asset categories that are bank accounts (navigable to account detail)
const ACCOUNT_CATEGORY_KEYS: AssetCategoryKey[] = [
  "cash",
  "savings",
  "investment",
  "crypto",
];

function AccountRow({
  account,
  currency,
  color,
  isLinkable = false,
  categoryKey,
}: {
  account: AssetAccount;
  currency: string;
  color: string;
  isLinkable?: boolean;
  categoryKey?: AssetCategoryKey;
}) {
  const handleClick = () => {
    if (!isLinkable) return;
    if (categoryKey === "investment") {
      window.location.href = `/investments`;
    } else {
      window.location.href = `/accounts/${account.id}`;
    }
  };

  return (
    <div
      className={`flex flex-col gap-2 border-t border-border/50 py-2 pl-4 pr-4 sm:flex-row sm:items-center sm:pl-8 ${isLinkable ? "hover:bg-muted/50 cursor-pointer transition-colors" : ""}`}
      onClick={handleClick}
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div
          className="h-3 w-3 shrink-0 rounded-sm"
          style={{ backgroundColor: color }}
        />
        <div className="truncate">
          <span className="text-sm">{account.name}</span>
          {account.institution && (
            <span className="text-xs text-muted-foreground ml-2">
              {account.institution}
            </span>
          )}
        </div>
      </div>
      <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto sm:gap-4 sm:shrink-0">
        <div className="flex min-w-36 flex-1 items-center gap-2 sm:w-36 sm:flex-none">
          <WeightBarVisualizer percentage={account.percentage} color={color} />
          <span className="text-sm text-muted-foreground w-12 text-right">
            {account.percentage.toFixed(0)}%
          </span>
        </div>
        <span className="ml-auto text-sm font-medium sm:w-24 sm:text-right">
          {formatCurrency(account.value, currency)}
        </span>
      </div>
    </div>
  );
}

function CategoryRow({
  category,
  currency,
  defaultOpen = false,
}: {
  category: AssetCategory;
  currency: string;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const hasAccounts = category.accounts.length > 0;

  if (!category.isActive) {
    return (
      <div className="flex flex-col gap-2 border-t px-4 py-3 sm:flex-row sm:items-center">
        <div className="flex flex-1 items-center gap-2">
          <div className="w-4 h-4" /> {/* Spacer for alignment */}
          <span className="text-sm text-muted-foreground">
            {category.label}
          </span>
        </div>
        <div className="flex w-full items-center gap-4 sm:w-auto">
          <span className="min-w-36 flex-1 text-sm text-muted-foreground sm:w-36 sm:flex-none sm:text-center">
            -
          </span>
          <span className="text-sm text-muted-foreground sm:w-24 sm:text-right">
            {formatCurrency(0, currency)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        className="flex cursor-pointer flex-col gap-2 border-t px-4 py-3 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center"
        onClick={() => hasAccounts && setIsOpen(!isOpen)}
      >
        <div className="flex flex-1 items-center gap-2">
          {hasAccounts ? (
            isOpen ? (
              <RiArrowDownSLine className="h-4 w-4 text-muted-foreground" />
            ) : (
              <RiArrowRightSLine className="h-4 w-4 text-muted-foreground" />
            )
          ) : (
            <div className="w-4 h-4" />
          )}
          <span className="text-sm font-medium">{category.label}</span>
        </div>
        <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto sm:gap-4">
          <div className="flex min-w-36 flex-1 items-center gap-2 sm:w-36 sm:flex-none">
            <WeightBarVisualizer
              percentage={category.percentage}
              color={category.color}
            />
            <span className="text-sm text-muted-foreground w-12 text-right">
              {category.percentage.toFixed(0)}%
            </span>
          </div>
          <span className="ml-auto text-sm font-medium sm:w-24 sm:text-right">
            {formatCurrency(category.value, currency)}
          </span>
        </div>
      </div>
      {hasAccounts && isOpen && (
        <div>
          {category.accounts.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              currency={currency}
              color={category.color}
              isLinkable={ACCOUNT_CATEGORY_KEYS.includes(category.key)}
              categoryKey={category.key}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function AssetsTable({ categories, currency }: AssetsTableProps) {
  return (
    <div className="rounded-md border">
      {/* Header */}
      <div className="hidden items-center px-4 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground sm:flex">
        <div className="flex-1">{translate("name")}</div>
        <div className="w-36 text-center">{translate("weight")}</div>
        <div className="w-24 text-right">{translate("value")}</div>
      </div>

      {/* Rows */}
      {categories.map((category, index) => (
        <CategoryRow
          key={category.key}
          category={category}
          currency={currency}
          defaultOpen={index === 0 && category.isActive}
        />
      ))}
    </div>
  );
}
