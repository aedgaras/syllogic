"use client";
import { t as translate } from "@/i18n/translate";

import { type ColumnDef } from "@tanstack/react-table";
import { useRouter, useSearchParams } from "next/navigation";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import type { TransactionWithRelations } from "@/features/transactions/public";
import {
  RiArrowUpLine,
  RiArrowDownLine,
  RiSubtractLine,
  RiCheckLine,
  RiLink,
} from "@remixicon/react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { format } from "date-fns";
import { AccountLogo } from "@/components/ui/account-logo";
import { parseGlobalFiltersFromSearchParams } from "@/lib/filters/global-filters";
import { buildCategorySpendingQuery } from "@/lib/category-spending/query-params";

function AccountCell({
  accountId,
  accountName,
  logo,
  maxWidth,
}: {
  accountId: string;
  accountName: string;
  logo: {
    id: string;
    logoUrl: string | null;
    updatedAt?: Date | null;
  } | null;
  maxWidth: number;
}) {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.location.href = `/accounts/${accountId}`;
  };

  return (
    <button
      onClick={handleClick}
      className="flex items-center justify-start gap-1.5 text-muted-foreground transition-colors hover:text-foreground hover:underline md:mx-auto md:justify-center"
      style={{ maxWidth: `${maxWidth}px` }}
      title={accountName}
    >
      <AccountLogo
        name={accountName}
        logoUrl={logo?.logoUrl}
        updatedAt={logo?.updatedAt}
        size="sm"
        className="!size-4"
      />
      <span className="truncate md:text-center">{accountName}</span>
    </button>
  );
}

function CategoryCell({
  transaction,
  maxWidth,
}: {
  transaction: TransactionWithRelations;
  maxWidth: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const displayCategory = transaction.category ?? transaction.categorySystem;

  if (!displayCategory) {
    return (
      <div className="text-muted-foreground md:text-center">
        {translate("uncategorized")}
      </div>
    );
  }

  return (
    <div className="flex justify-start md:justify-center">
      <button
        type="button"
        className="inline-flex items-center px-2 py-0.5 text-xs text-white truncate transition-opacity hover:opacity-90"
        style={{
          backgroundColor: displayCategory.color ?? "#6B7280",
          maxWidth: `${maxWidth}px`,
        }}
        title={displayCategory.name}
        onClick={(event) => {
          event.stopPropagation();
          const globalFilters =
            parseGlobalFiltersFromSearchParams(searchParams);
          const query = buildCategorySpendingQuery({
            categoryId: displayCategory.id,
            accountIds: globalFilters.accountIds,
            dateFrom: globalFilters.from,
            dateTo: globalFilters.to,
            horizon: globalFilters.horizon,
          });
          router.push(
            query ? `/category-spending?${query}` : "/category-spending",
          );
        }}
      >
        {displayCategory.name}
      </button>
    </div>
  );
}

export const transactionColumns: ColumnDef<TransactionWithRelations>[] = [
  {
    id: "select",
    header: ({ table }) => {
      const allRowsSelected = table.getIsAllRowsSelected();
      const allPageRowsSelected = table.getIsAllPageRowsSelected();
      const someRowsSelected = table.getIsSomeRowsSelected();

      // Determine checkbox state:
      // - Checked (✓): all rows across all pages are selected
      // - Indeterminate (-): only current page is selected (or some rows)
      // - Unchecked: nothing selected
      const isChecked = allRowsSelected;
      const isIndeterminate =
        !allRowsSelected && (allPageRowsSelected || someRowsSelected);

      const handleClick = () => {
        if (allRowsSelected) {
          // All selected -> deselect all
          table.toggleAllRowsSelected(false);
        } else if (allPageRowsSelected) {
          // Page selected -> select all rows
          table.toggleAllRowsSelected(true);
        } else {
          // Nothing/some selected -> select current page
          table.toggleAllPageRowsSelected(true);
        }
      };

      return (
        <Checkbox
          checked={isChecked}
          indeterminate={isIndeterminate}
          onCheckedChange={handleClick}
          aria-label={translate("selectAll")}
        />
      );
    },
    cell: ({ row }) => (
      <div onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label={translate("selectRow")}
        />
      </div>
    ),
    size: 50,
    enableSorting: false,
    enableHiding: false,
    enableResizing: false,
    meta: {
      mobilePriority: "primary",
      mobileClassName: "shrink-0 pt-0.5",
    },
  },
  {
    accessorKey: "bookedAt",
    header: ({ column }) => {
      const sorted = column.getIsSorted();
      return (
        <div
          className="flex items-center gap-1 cursor-pointer"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          {translate("date")}
          {sorted === "asc" ? (
            <RiArrowUpLine className="h-4 w-4" />
          ) : sorted === "desc" ? (
            <RiArrowDownLine className="h-4 w-4" />
          ) : null}
        </div>
      );
    },
    cell: ({ row }) => (
      <span className="whitespace-nowrap">
        {format(new Date(row.getValue("bookedAt")), "MMM d, yyyy")}
      </span>
    ),
    size: 120,
    meta: {
      mobileLabel: "Date",
      mobilePriority: "secondary",
    },
    sortingFn: "datetime",
    filterFn: (row, id, filterValue) => {
      if (!filterValue || !filterValue.from) return true;
      const rowDate = row.getValue("bookedAt") as Date;
      const from = new Date(filterValue.from);
      const to = filterValue.to ? new Date(filterValue.to) : from;
      from.setHours(0, 0, 0, 0);
      to.setHours(23, 59, 59, 999);
      return rowDate >= from && rowDate <= to;
    },
  },
  {
    accessorKey: "description",
    header: "Description",
    cell: ({ row, column }) => {
      const columnSize = column.getSize();
      const isExcludedFromAnalytics = row.original.includeInAnalytics === false;
      return (
        <div className="flex items-center gap-1.5">
          {isExcludedFromAnalytics && (
            <Tooltip>
              <TooltipTrigger render={<span className="shrink-0" />}>
                <RiSubtractLine className="h-4 w-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>{translate("excludedFromAnalytics")}</p>
              </TooltipContent>
            </Tooltip>
          )}
          <div
            className="truncate"
            style={{
              maxWidth: `${columnSize - (isExcludedFromAnalytics ? 24 : 0)}px`,
            }}
            title={row.getValue("description") || ""}
          >
            {row.getValue("description")}
          </div>
        </div>
      );
    },
    size: 280,
    meta: {
      mobilePriority: "primary",
      mobileClassName: "flex-1",
    },
    filterFn: "includesString",
  },
  {
    accessorKey: "merchant",
    header: "Merchant",
    cell: ({ row, column }) => {
      const merchant = row.original.merchant;
      const columnSize = column.getSize();
      return merchant ? (
        <div
          className="truncate"
          style={{ maxWidth: `${columnSize}px` }}
          title={merchant}
        >
          {merchant}
        </div>
      ) : (
        <span className="text-muted-foreground">-</span>
      );
    },
    size: 150,
    meta: {
      mobileLabel: "Merchant",
      mobilePriority: "secondary",
    },
  },
  {
    accessorKey: "category",
    header: () => (
      <div
        className="text-center"
        data-walkthrough="walkthrough-category-badge"
      >
        {translate("category")}
      </div>
    ),
    cell: ({ row, column }) => {
      const columnSize = column.getSize();
      return <CategoryCell transaction={row.original} maxWidth={columnSize} />;
    },
    size: 140,
    meta: {
      mobileLabel: "Category",
      mobilePriority: "secondary",
    },
    filterFn: (row, id, filterValue) => {
      if (
        !filterValue ||
        !Array.isArray(filterValue) ||
        filterValue.length === 0
      )
        return true;
      if (filterValue.includes("uncategorized") && !row.original.category)
        return true;
      return filterValue.includes(row.original.category?.id);
    },
  },
  {
    accessorKey: "amount",
    header: ({ column }) => {
      const sorted = column.getIsSorted();
      return (
        <div
          className="flex cursor-pointer items-center justify-center gap-1"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          {translate("amount")}
          {sorted === "asc" ? (
            <RiArrowUpLine className="h-4 w-4" />
          ) : sorted === "desc" ? (
            <RiArrowDownLine className="h-4 w-4" />
          ) : null}
        </div>
      );
    },
    cell: ({ row }) => {
      const amount = row.getValue("amount") as number;
      const type = row.original.transactionType;
      const isCredit = type === "credit";
      return (
        <span className="block whitespace-nowrap text-center font-mono">
          {isCredit ? "+" : "-"}
          {Math.abs(amount).toFixed(2)}
        </span>
      );
    },
    size: 110,
    meta: {
      mobilePriority: "primary",
      mobileClassName: "shrink-0 text-right",
    },
    filterFn: (row, id, filterValue) => {
      if (!filterValue || (!filterValue.min && !filterValue.max)) return true;
      const amount = Math.abs(row.getValue("amount") as number);
      const min = filterValue.min ? parseFloat(filterValue.min) : -Infinity;
      const max = filterValue.max ? parseFloat(filterValue.max) : Infinity;
      return amount >= min && amount <= max;
    },
  },
  {
    accessorKey: "account",
    header: () => (
      <div className="text-center">{translate("account85dfa3")}</div>
    ),
    cell: ({ row, column }) => {
      const columnSize = column.getSize();
      const account = row.original.account;
      if (!account) {
        return (
          <div className="text-muted-foreground md:text-center">
            {translate("unknown")}
          </div>
        );
      }
      return (
        <div className="flex justify-start md:justify-center">
          <AccountCell
            accountId={account.id}
            accountName={account.name}
            logo={account.logo}
            maxWidth={columnSize}
          />
        </div>
      );
    },
    size: 140,
    meta: {
      mobileLabel: "Account",
      mobilePriority: "secondary",
    },
    filterFn: (row, id, filterValue) => {
      if (
        !filterValue ||
        !Array.isArray(filterValue) ||
        filterValue.length === 0
      )
        return true;
      const account = row.original.account;
      if (!account) return false;
      return filterValue.includes(account.id);
    },
  },
  {
    accessorKey: "recurringTransaction",
    header: () => <div className="text-center">{translate("sub")}</div>,
    cell: ({ row }) => {
      const recurring = row.original.recurringTransaction;
      if (!recurring) {
        return <div className="text-center text-muted-foreground">-</div>;
      }
      return (
        <div className="flex justify-center">
          <span
            title={translate("message", {
              value1: recurring.name,
              value2: recurring.frequency,
            })}
          >
            <RiCheckLine className="h-4 w-4 text-success" />
          </span>
        </div>
      );
    },
    size: 60,
    meta: {
      mobilePriority: "hidden",
    },
    filterFn: (row, id, filterValue) => {
      if (
        !filterValue ||
        !Array.isArray(filterValue) ||
        filterValue.length === 0
      )
        return true;
      if (
        filterValue.includes("no_subscription") &&
        !row.original.recurringTransaction
      )
        return true;
      if (row.original.recurringTransaction) {
        return filterValue.includes(row.original.recurringTransaction.id);
      }
      return false;
    },
  },
  {
    accessorKey: "transactionLink",
    header: () => <div className="text-center">{translate("linkd05170")}</div>,
    cell: ({ row }) => {
      const link = row.original.transactionLink;
      if (!link) {
        return <div className="text-center text-muted-foreground">-</div>;
      }
      const roleLabel =
        link.linkRole === "primary"
          ? "Primary"
          : link.linkRole === "reimbursement"
            ? "Reimbursement"
            : "Expense";
      return (
        <div className="flex justify-center">
          <Tooltip>
            <TooltipTrigger render={<span />}>
              <RiLink className="h-4 w-4 text-info" />
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>
                {translate("linked")}
                {roleLabel})
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
      );
    },
    size: 60,
    meta: {
      mobilePriority: "hidden",
    },
    filterFn: (row, id, filterValue) => {
      if (
        !filterValue ||
        !Array.isArray(filterValue) ||
        filterValue.length === 0
      )
        return true;
      if (filterValue.includes("not_linked") && !row.original.transactionLink)
        return true;
      if (filterValue.includes("linked") && row.original.transactionLink)
        return true;
      return false;
    },
  },
  {
    accessorKey: "pending",
    header: "Status",
    cell: ({ row }) => {
      const pending = row.getValue("pending") as boolean;
      return pending ? (
        <Badge variant="outline">{translate("pending")}</Badge>
      ) : null;
    },
    size: 80,
    meta: {
      mobileLabel: "Status",
      mobilePriority: "secondary",
    },
    filterFn: (row, id, filterValue) => {
      if (
        !filterValue ||
        !Array.isArray(filterValue) ||
        filterValue.length === 0
      )
        return true;
      if (filterValue.includes("pending") && row.original.pending) return true;
      if (filterValue.includes("completed") && !row.original.pending)
        return true;
      return false;
    },
  },
  {
    accessorKey: "includeInAnalytics",
    header: "Analytics",
    cell: () => null, // Hidden column used for filtering only
    size: 0,
    enableHiding: true,
    meta: {
      mobilePriority: "hidden",
    },
    filterFn: (row, id, filterValue) => {
      if (
        !filterValue ||
        !Array.isArray(filterValue) ||
        filterValue.length === 0
      )
        return true;
      const includeInAnalytics = row.original.includeInAnalytics ?? true;
      if (filterValue.includes("included") && includeInAnalytics) return true;
      if (filterValue.includes("excluded") && !includeInAnalytics) return true;
      return false;
    },
  },
];

export const categorySpendingTransactionColumns: ColumnDef<TransactionWithRelations>[] =
  transactionColumns.filter((column) => {
    const key = String(
      ("accessorKey" in column ? column.accessorKey : undefined) ??
        ("id" in column ? column.id : ""),
    );

    return ![
      "merchant",
      "recurringTransaction",
      "transactionLink",
      "pending",
      "includeInAnalytics",
    ].includes(key);
  });
