"use client";
import { t as translate } from "@/i18n/translate";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  RiLoader4Line,
  RiLink,
  RiSearchLine,
  RiCalendarLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiFilter3Line,
  RiBankLine,
  RiMoneyDollarCircleLine,
} from "@remixicon/react";
import { format, subDays } from "date-fns";
import { cn, formatAmount } from "@/lib/utils";
import type {
  SuggestedTransactionLink,
  TransactionLinkAccountOption,
  TransactionLinkSearchFilters,
  TransactionWithRelations,
} from "@/features/transactions/public";
import { useLinkTransactionsController } from "@/features/transactions/hooks/use-link-transactions-controller";
import type { DateRange } from "react-day-picker";

interface LinkReimbursementsDialogProps {
  transaction: TransactionWithRelations;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

const PAGE_SIZE = 20;

export function LinkReimbursementsDialog({
  transaction,
  open,
  onOpenChange,
  onSuccess,
}: LinkReimbursementsDialogProps) {
  const controller = useLinkTransactionsController();
  const [isLoading, setIsLoading] = useState(true);
  const [isLinking, setIsLinking] = useState(false);
  const [transactions, setTransactions] = useState<SuggestedTransactionLink[]>(
    [],
  );
  const [totalCount, setTotalCount] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [accounts, setAccounts] = useState<TransactionLinkAccountOption[]>([]);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null,
  );
  const [accountPopoverOpen, setAccountPopoverOpen] = useState(false);
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [filterPopoverOpen, setFilterPopoverOpen] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);

  const isExpense = transaction.amount < 0;
  const linkType = isExpense ? "reimbursement" : "expense";
  const dialogTitle = isExpense
    ? translate("linkReimbursements")
    : translate("linkExpenses");
  const dialogDescription = isExpense
    ? translate("findAndLinkReimbursementPaymentsToOffsetThisExpense")
    : translate("findAndLinkExpensesAgainstThisIncomeOrAllowance");

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Calculate net amount from selected transactions
  const netAmount = transactions
    .filter((t) => selectedIds.has(t.id))
    .reduce((sum, t) => sum + t.amount, transaction.amount);

  // Count active filters
  const activeFilterCount =
    (debouncedSearch ? 1 : 0) +
    (dateRange?.from ? 1 : 0) +
    (selectedAccountId ? 1 : 0) +
    (minAmount || maxAmount ? 1 : 0);

  // Fetch transactions with current filters
  const fetchTransactions = useCallback(async () => {
    setIsLoading(true);
    try {
      const filters: TransactionLinkSearchFilters = {
        searchQuery: debouncedSearch || undefined,
        accountId: selectedAccountId || undefined,
        dateFrom: dateRange?.from,
        dateTo: dateRange?.to,
        minAmount: minAmount ? parseFloat(minAmount) : undefined,
        maxAmount: maxAmount ? parseFloat(maxAmount) : undefined,
        page: currentPage,
        pageSize: PAGE_SIZE,
      };

      const result = await controller.search(
        transaction.id,
        isExpense,
        filters,
      );
      if (result) {
        setTransactions(result.transactions);
        setTotalCount(result.totalCount);
      }
    } finally {
      setIsLoading(false);
    }
  }, [
    transaction.id,
    isExpense,
    debouncedSearch,
    selectedAccountId,
    dateRange,
    minAmount,
    maxAmount,
    currentPage,
    controller,
  ]);

  // Fetch accounts and initial transactions when dialog opens
  useEffect(() => {
    if (open && transaction) {
      // Reset state
      setSearchQuery("");
      setDebouncedSearch("");
      setDateRange(undefined);
      setSelectedAccountId(null);
      setMinAmount("");
      setMaxAmount("");
      setCurrentPage(1);
      setSelectedIds(new Set());

      // Load accounts
      controller.loadAccounts().then(setAccounts);
    }
  }, [controller, open, transaction?.id]);

  // Fetch transactions when filters change
  useEffect(() => {
    if (open && transaction) {
      fetchTransactions();
    }
  }, [open, transaction?.id, fetchTransactions]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, selectedAccountId, dateRange, minAmount, maxAmount]);

  const handleLink = async () => {
    setIsLinking(true);
    try {
      if (
        await controller.link(transaction.id, Array.from(selectedIds), linkType)
      ) {
        onSuccess();
        onOpenChange(false);
      }
    } finally {
      setIsLinking(false);
    }
  };

  const toggleTransaction = (txnId: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(txnId)) {
      newSet.delete(txnId);
    } else {
      newSet.add(txnId);
    }
    setSelectedIds(newSet);
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const clearFilters = () => {
    setSearchQuery("");
    setDateRange(undefined);
    setSelectedAccountId(null);
    setMinAmount("");
    setMaxAmount("");
  };

  const TransactionRow = ({ item }: { item: SuggestedTransactionLink }) => (
    <label className="flex items-center gap-3 p-2.5 hover:bg-muted/50 cursor-pointer">
      <input
        type="checkbox"
        checked={selectedIds.has(item.id)}
        onChange={() => toggleTransaction(item.id)}
        className="h-4 w-4 shrink-0"
      />
      <div className="flex-1 min-w-0 grid grid-cols-[1fr_auto] gap-2 items-center">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">
            {item.merchant || item.description || translate("transaction")}
          </p>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{format(new Date(item.bookedAt), "MMM d, yyyy")}</span>
            {item.accountName && (
              <>
                <span>•</span>
                <span className="truncate">{item.accountName}</span>
              </>
            )}
          </div>
        </div>
        <span
          className={cn(
            "text-sm font-mono font-medium shrink-0 text-right min-w-[80px]",
            item.amount > 0 && "text-emerald-600",
          )}
        >
          {item.amount > 0 ? "+" : ""}
          {Math.abs(item.amount).toFixed(2)}
        </span>
      </div>
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <RiLink className="h-5 w-5" />
            {dialogTitle}
          </DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {/* Primary Transaction */}
          <div className="p-3 bg-muted/50 border shrink-0">
            <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {transaction.merchant || transaction.description}
                </p>
                <p className="text-xs text-muted-foreground">
                  {format(new Date(transaction.bookedAt), "MMM d, yyyy")}
                </p>
              </div>
              <Badge variant="secondary">{translate("primary")}</Badge>
              <div
                className={cn(
                  "text-sm font-mono font-medium text-right min-w-[80px]",
                  transaction.amount > 0 && "text-emerald-600",
                )}
              >
                {formatAmount(
                  transaction.amount,
                  transaction.currency || "EUR",
                )}
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-2 py-3 shrink-0">
            <div className="relative flex-1">
              <RiSearchLine className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={translate("searchTransactions")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9"
              />
            </div>

            {/* Filters popover */}
            <Popover
              open={filterPopoverOpen}
              onOpenChange={setFilterPopoverOpen}
            >
              <PopoverTrigger
                nativeButton={true}
                render={
                  <Button variant="outline" className="h-9 px-3">
                    <RiFilter3Line className="h-4 w-4 mr-2" />
                    <span className="text-xs">{translate("filters")}</span>
                    {activeFilterCount > 0 && (
                      <span className="ml-1.5 flex h-5 min-w-5 items-center justify-center bg-muted px-1 text-[10px] font-medium">
                        {activeFilterCount}
                      </span>
                    )}
                  </Button>
                }
              />
              <PopoverContent className="w-72 p-4" align="end">
                <div className="space-y-4">
                  {/* Date Range */}
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <RiCalendarLine className="h-4 w-4" />
                      {translate("dateRange")}
                    </Label>
                    <Popover
                      open={datePopoverOpen}
                      onOpenChange={setDatePopoverOpen}
                    >
                      <PopoverTrigger
                        nativeButton={true}
                        render={
                          <Button
                            variant="outline"
                            className={cn(
                              "w-full h-8 justify-start text-left text-xs font-normal",
                              dateRange?.from && "text-foreground",
                            )}
                          >
                            {dateRange?.from ? (
                              dateRange.to ? (
                                <span>
                                  {format(dateRange.from, "MMM d")} -{" "}
                                  {format(dateRange.to, "MMM d")}
                                </span>
                              ) : (
                                <span>
                                  {format(dateRange.from, "MMM d, yyyy")}
                                </span>
                              )
                            ) : (
                              <span className="text-muted-foreground">
                                {translate("selectDates")}
                              </span>
                            )}
                          </Button>
                        }
                      />
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="range"
                          selected={dateRange}
                          onSelect={setDateRange}
                          numberOfMonths={1}
                          defaultMonth={subDays(new Date(), 30)}
                        />
                        <div className="p-2 border-t flex justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setDateRange(undefined);
                              setDatePopoverOpen(false);
                            }}
                          >
                            {translate("clear")}
                          </Button>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>

                  {/* Account Filter */}
                  {accounts.length > 0 && (
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <RiBankLine className="h-4 w-4" />
                        {translate("account85dfa3")}
                      </Label>
                      <Popover
                        open={accountPopoverOpen}
                        onOpenChange={setAccountPopoverOpen}
                      >
                        <PopoverTrigger
                          nativeButton={true}
                          render={
                            <Button
                              variant="outline"
                              className={cn(
                                "w-full h-8 justify-start text-left text-xs font-normal",
                                selectedAccountId && "text-foreground",
                              )}
                            >
                              {selectedAccountId ? (
                                accounts.find((a) => a.id === selectedAccountId)
                                  ?.name
                              ) : (
                                <span className="text-muted-foreground">
                                  {translate("allAccounts6a19f2")}
                                </span>
                              )}
                            </Button>
                          }
                        />
                        <PopoverContent className="w-56 p-1" align="start">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedAccountId(null);
                              setAccountPopoverOpen(false);
                            }}
                            className={cn(
                              "w-full px-2 py-1.5 text-left text-xs hover:bg-accent",
                              !selectedAccountId && "bg-accent",
                            )}
                          >
                            {translate("allAccounts6a19f2")}
                          </button>
                          {accounts.map((account) => (
                            <button
                              key={account.id}
                              type="button"
                              onClick={() => {
                                setSelectedAccountId(account.id);
                                setAccountPopoverOpen(false);
                              }}
                              className={cn(
                                "w-full px-2 py-1.5 text-left text-xs hover:bg-accent truncate",
                                selectedAccountId === account.id && "bg-accent",
                              )}
                            >
                              {account.name}
                            </button>
                          ))}
                        </PopoverContent>
                      </Popover>
                    </div>
                  )}

                  {/* Amount Range */}
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <RiMoneyDollarCircleLine className="h-4 w-4" />
                      {translate("amountRange")}
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        placeholder={translate("min")}
                        value={minAmount}
                        onChange={(e) => setMinAmount(e.target.value)}
                        className="h-8 text-xs"
                      />
                      <span className="text-muted-foreground text-xs">
                        {translate("to")}
                      </span>
                      <Input
                        type="number"
                        placeholder={translate("max")}
                        value={maxAmount}
                        onChange={(e) => setMaxAmount(e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>

                  {/* Clear all */}
                  {activeFilterCount > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearFilters}
                      className="w-full text-xs"
                    >
                      {translate("clearAllFilters")}
                    </Button>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto min-h-0 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">
                {isExpense ? translate("credits") : translate("debits")} (
                {totalCount})
              </Label>
              {selectedIds.size > 0 && (
                <Button variant="ghost" size="sm" onClick={clearSelection}>
                  {translate("clearSelectionfae58c")}
                </Button>
              )}
            </div>

            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2">
                <RiLoader4Line className="h-6 w-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {translate("loadingb04ba4")}
                </p>
              </div>
            ) : transactions.length > 0 ? (
              <>
                <div className="border divide-y">
                  {transactions.map((item) => (
                    <TransactionRow key={item.id} item={item} />
                  ))}
                </div>
                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-xs text-muted-foreground">
                      {translate("page")} {currentPage} {translate("of")}{" "}
                      {totalPages}
                    </span>
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        disabled={currentPage === 1}
                        onClick={() => setCurrentPage((p) => p - 1)}
                      >
                        <RiArrowLeftSLine className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        disabled={currentPage === totalPages}
                        onClick={() => setCurrentPage((p) => p + 1)}
                      >
                        <RiArrowRightSLine className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                {translate("noTransactionsFoundMatchingYourFilters")}
              </p>
            )}
          </div>

          {/* Net Amount Preview */}
          {selectedIds.size > 0 && (
            <>
              <Separator className="shrink-0" />
              <div className="flex items-center justify-between p-3 bg-muted/30 border shrink-0">
                <div>
                  <p className="text-sm font-medium">
                    {translate("netAmount")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {selectedIds.size} {translate("transactionSSelected")}
                  </p>
                </div>
                <div
                  className={cn(
                    "text-lg font-mono font-semibold",
                    netAmount > 0 && "text-emerald-600",
                  )}
                >
                  {formatAmount(netAmount, transaction.currency || "EUR")}
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="shrink-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLinking}
          >
            {translate("cancel")}
          </Button>
          <Button
            onClick={handleLink}
            disabled={isLoading || isLinking || selectedIds.size === 0}
          >
            {isLinking
              ? translate("linking")
              : translate("linkTransactionS", { value1: selectedIds.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
