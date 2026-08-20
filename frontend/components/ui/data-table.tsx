"use client";
import { t as translate } from "@/i18n/translate";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  type ColumnSizingState,
  type OnChangeFn,
  type RowSelectionState,
  type PaginationState,
  type Table as TanStackTable,
} from "@tanstack/react-table";

import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  onRowClick?: (row: TData) => void;
  enableColumnResizing?: boolean;
  enableRowSelection?: boolean;
  enablePagination?: boolean;
  manualPagination?: boolean;
  manualSorting?: boolean;
  pageCount?: number;
  rowCount?: number;
  paginationState?: PaginationState;
  onPaginationStateChange?: OnChangeFn<PaginationState>;
  sortingState?: SortingState;
  onSortingStateChange?: OnChangeFn<SortingState>;
  pageSize?: number;
  initialColumnFilters?: ColumnFiltersState;
  onColumnFiltersChange?: (filters: ColumnFiltersState) => void;
  toolbar?: (table: TanStackTable<TData>) => React.ReactNode;
  pagination?: (table: TanStackTable<TData>) => React.ReactNode;
  bulkActions?: (table: TanStackTable<TData>) => React.ReactNode;
  footer?: React.ReactNode;
  wrapperClassName?: string;
  tableContainerClassName?: string;
  tableContainerProps?: React.HTMLAttributes<HTMLDivElement>;
  mobileCards?: boolean;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  onRowClick,
  enableColumnResizing = true,
  enableRowSelection = true,
  enablePagination = true,
  manualPagination = false,
  manualSorting = false,
  pageCount,
  rowCount,
  paginationState,
  onPaginationStateChange,
  sortingState,
  onSortingStateChange,
  pageSize = 20,
  initialColumnFilters = [],
  onColumnFiltersChange,
  toolbar,
  pagination,
  bulkActions,
  footer,
  wrapperClassName,
  tableContainerClassName,
  tableContainerProps,
  mobileCards = false,
}: DataTableProps<TData, TValue>) {
  const [uncontrolledSorting, setUncontrolledSorting] =
    React.useState<SortingState>([]);
  const resolvedSorting = sortingState ?? uncontrolledSorting;
  const setResolvedSorting: OnChangeFn<SortingState> = (updater) => {
    if (onSortingStateChange) {
      onSortingStateChange(updater);
      return;
    }
    setUncontrolledSorting(updater);
  };
  const [columnFilters, setColumnFilters] =
    React.useState<ColumnFiltersState>(initialColumnFilters);

  // Notify parent when filters change
  React.useEffect(() => {
    onColumnFiltersChange?.(columnFilters);
  }, [columnFilters, onColumnFiltersChange]);
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [columnSizing, setColumnSizing] = React.useState<ColumnSizingState>({});
  const [uncontrolledPagination, setUncontrolledPagination] =
    React.useState<PaginationState>({
      pageIndex: 0,
      pageSize,
    });
  const resolvedPagination = paginationState ?? uncontrolledPagination;
  const setResolvedPagination: OnChangeFn<PaginationState> = (updater) => {
    if (onPaginationStateChange) {
      onPaginationStateChange(updater);
      return;
    }
    setUncontrolledPagination(updater);
  };

  const table = useReactTable({
    data,
    columns,
    onSortingChange: setResolvedSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel:
      enablePagination && !manualPagination
        ? getPaginationRowModel()
        : undefined,
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
    manualPagination,
    manualSorting,
    pageCount,
    rowCount,
    onPaginationChange: enablePagination ? setResolvedPagination : undefined,
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: enableRowSelection ? setRowSelection : undefined,
    onColumnSizingChange: setColumnSizing,
    enableColumnResizing,
    columnResizeMode: "onChange",
    state: {
      sorting: resolvedSorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      columnSizing,
      pagination: resolvedPagination,
    },
    initialState: {
      pagination: {
        pageSize,
      },
    },
  });

  const tableContainerRest = { ...tableContainerProps };
  delete tableContainerRest.className;

  const handleMobileCardKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
    row: TData,
  ) => {
    if (!onRowClick || (event.key !== "Enter" && event.key !== " ")) {
      return;
    }

    event.preventDefault();
    onRowClick(row);
  };

  return (
    <div className={cn("w-full", wrapperClassName)}>
      {toolbar && <div className="shrink-0 mb-4">{toolbar(table)}</div>}
      {mobileCards && (
        <div
          className={cn(
            "space-y-2 md:hidden",
            tableContainerClassName,
            tableContainerProps?.className,
          )}
          {...tableContainerRest}
        >
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => {
              const mobileCells = row
                .getVisibleCells()
                .filter(
                  (cell) =>
                    cell.column.columnDef.meta?.mobilePriority !== "hidden",
                );
              const primaryCells = mobileCells.filter(
                (cell) =>
                  cell.column.columnDef.meta?.mobilePriority === "primary",
              );
              const secondaryCells = mobileCells.filter(
                (cell) =>
                  cell.column.columnDef.meta?.mobilePriority !== "primary",
              );

              return (
                <div
                  key={row.id}
                  role={onRowClick ? "button" : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  data-state={row.getIsSelected() && "selected"}
                  onClick={() => onRowClick?.(row.original)}
                  onKeyDown={(event) =>
                    handleMobileCardKeyDown(event, row.original)
                  }
                  className={cn(
                    "border border-border bg-background p-3 text-xs shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    onRowClick && "cursor-pointer",
                  )}
                >
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    {primaryCells.map((cell) => (
                      <div
                        key={cell.id}
                        className={cn(
                          "min-w-0",
                          cell.column.columnDef.meta?.mobileClassName,
                        )}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </div>
                    ))}
                  </div>
                  {secondaryCells.length > 0 && (
                    <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                      {secondaryCells.map((cell) => {
                        const meta = cell.column.columnDef.meta;
                        const cellDef = cell.column.columnDef.cell;
                        const cellContent =
                          typeof cellDef === "function"
                            ? cellDef(cell.getContext())
                            : flexRender(cellDef, cell.getContext());
                        if (
                          cellContent === null ||
                          cellContent === undefined ||
                          cellContent === ""
                        ) {
                          return null;
                        }
                        const label =
                          meta?.mobileLabel ??
                          (typeof cell.column.columnDef.header === "string"
                            ? cell.column.columnDef.header
                            : cell.column.id);

                        return (
                          <div key={cell.id} className="min-w-0">
                            <dt className="text-2xs uppercase text-muted-foreground">
                              {label}
                            </dt>
                            <dd
                              className={cn(
                                "mt-0.5 min-w-0",
                                meta?.mobileClassName,
                              )}
                            >
                              {cellContent}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  )}
                </div>
              );
            })
          ) : (
            <div className="border border-border p-6 text-center text-xs text-muted-foreground">
              {translate("noResults")}
            </div>
          )}
        </div>
      )}
      <div
        className={cn(
          "overflow-auto rounded-md border relative",
          mobileCards && "hidden md:block",
          tableContainerClassName,
          tableContainerProps?.className,
        )}
        {...tableContainerRest}
      >
        <table className="w-full table-fixed caption-bottom text-xs">
          <TableHeader className="bg-muted sticky top-0 z-20 shadow-sm">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow
                key={headerGroup.id}
                className="border-b hover:bg-transparent"
              >
                {headerGroup.headers.map((header, index) => {
                  const isLastColumn = index === headerGroup.headers.length - 1;
                  return (
                    <TableHead
                      key={header.id}
                      style={{
                        width: isLastColumn ? "auto" : header.getSize(),
                        maxWidth: isLastColumn ? undefined : header.getSize(),
                        position: "relative",
                      }}
                      className={cn(
                        "font-medium bg-muted overflow-hidden",
                        enableColumnResizing && "select-none",
                      )}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                      {enableColumnResizing && header.column.getCanResize() && (
                        <div
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          className={cn(
                            "absolute -right-1 top-0 h-full w-3 cursor-col-resize select-none touch-none",
                            "after:absolute after:right-1 after:top-0 after:h-full after:w-px after:bg-transparent",
                            "hover:after:bg-primary/50",
                            header.column.getIsResizing() && "after:bg-primary",
                          )}
                        />
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  onClick={() => onRowClick?.(row.original)}
                  className={cn(onRowClick && "cursor-pointer")}
                >
                  {row.getVisibleCells().map((cell, index) => {
                    const isLastColumn =
                      index === row.getVisibleCells().length - 1;
                    return (
                      <TableCell
                        key={cell.id}
                        className="overflow-hidden"
                        style={{
                          width: isLastColumn ? "auto" : cell.column.getSize(),
                          maxWidth: isLastColumn
                            ? undefined
                            : cell.column.getSize(),
                        }}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  {translate("noResults")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </table>
      </div>
      {footer && <div className="shrink-0">{footer}</div>}
      {pagination && <div className="shrink-0 mt-4">{pagination(table)}</div>}
      {bulkActions && bulkActions(table)}
    </div>
  );
}

export { type TanStackTable };
