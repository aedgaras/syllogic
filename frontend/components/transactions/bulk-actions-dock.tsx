"use client";
import { t as translate } from "@/i18n/translate";

import { useState, useMemo } from "react";
import {
  RiPriceTag3Line,
  RiDownloadLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiSearchLine,
  RiLineChartLine,
  RiLink,
} from "@remixicon/react";
import { Dock, DockIcon } from "@/components/ui/dock";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import type { CategoryDisplay } from "@/shared/domain/display-contracts";
import type { TransactionWithRelations } from "@/features/transactions/public";
import { filterSelectableCategories } from "@/lib/utils/category-utils";
import { DeleteConfirmationDialog } from "./delete-confirmation-dialog";
import type { BulkTransactionActions } from "@/features/transactions/hooks/use-bulk-transaction-actions";

interface BulkActionsDockProps {
  selectedCount: number;
  selectedIds: string[];
  selectedTransactions: TransactionWithRelations[];
  categories: CategoryDisplay[];
  onClearSelection: () => void;
  onBulkUpdate: (categoryId: string | null) => void;
  onBulkAnalyticsUpdate?: (includeInAnalytics: boolean) => void;
  onLinkSuccess?: () => void;
  onBulkDelete?: (deletedIds: string[]) => void;
  canDelete?: boolean;
  actions: BulkTransactionActions;
}

export function BulkActionsDock({
  selectedCount,
  selectedIds,
  selectedTransactions,
  categories,
  onClearSelection,
  onBulkUpdate,
  onBulkAnalyticsUpdate,
  onLinkSuccess,
  onBulkDelete,
  canDelete = true,
  actions,
}: BulkActionsDockProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [categoryPopoverOpen, setCategoryPopoverOpen] = useState(false);
  const [analyticsPopoverOpen, setAnalyticsPopoverOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Check if any selected transaction is already linked
  const hasLinkedTransactions = selectedTransactions.some(
    (t) => t.transactionLink !== null,
  );

  // Filter out categories hidden from selection, then apply search filter
  const selectableCategories = useMemo(
    () => filterSelectableCategories(categories),
    [categories],
  );

  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return selectableCategories;
    return selectableCategories.filter((cat) =>
      cat.name.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [selectableCategories, searchQuery]);

  if (selectedCount === 0) {
    return null;
  }

  const handleCategorize = async (categoryId: string | null) => {
    setIsLoading(true);
    try {
      if (await actions.categorize(selectedIds, categoryId)) {
        onBulkUpdate(categoryId);
        onClearSelection();
        setCategoryPopoverOpen(false);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleExport = () => {
    actions.exportCsv(selectedTransactions);
  };

  const handleAnalyticsUpdate = async (includeInAnalytics: boolean) => {
    setIsAnalyticsLoading(true);
    try {
      if (await actions.setAnalytics(selectedIds, includeInAnalytics)) {
        onBulkAnalyticsUpdate?.(includeInAnalytics);
        onClearSelection();
        setAnalyticsPopoverOpen(false);
      }
    } finally {
      setIsAnalyticsLoading(false);
    }
  };

  const handleLinkTransactions = async () => {
    setIsLinking(true);
    try {
      if (await actions.link(selectedIds)) {
        onLinkSuccess?.();
        onClearSelection();
      }
    } finally {
      setIsLinking(false);
    }
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
      <Dock
        direction="middle"
        className="h-14 px-4 gap-3 bg-background/95 border shadow-lg"
        disableMagnification
      >
        {/* Selection count */}
        <div className="flex items-center gap-2 px-2 text-sm font-medium">
          <span>
            {selectedCount} {translate("selected")}
          </span>
        </div>

        <Separator orientation="vertical" className="h-8" />

        {/* Categorize */}
        <Popover
          open={categoryPopoverOpen}
          onOpenChange={(open) => {
            setCategoryPopoverOpen(open);
            if (!open) setSearchQuery("");
          }}
        >
          <PopoverTrigger
            nativeButton={false}
            render={
              <DockIcon
                className="bg-muted hover:bg-muted/80"
                title={translate("categorize")}
              />
            }
          >
            <RiPriceTag3Line className="size-5" />
          </PopoverTrigger>
          <PopoverContent
            className="w-56 p-0"
            align="center"
            side="top"
            sideOffset={12}
          >
            <div className="p-2 border-b space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                {translate("selectCategory")}
              </p>
              <div className="relative">
                <RiSearchLine className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={translate("search6d7a30")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 pl-8 text-sm"
                />
              </div>
            </div>
            <div className="max-h-48 overflow-y-auto p-1">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-muted-foreground"
                onClick={() => handleCategorize(null)}
                disabled={isLoading}
              >
                <RiDeleteBinLine className="mr-2 h-4 w-4" />
                {translate("removeCategory")}
              </Button>
              {filteredCategories.map((category) => (
                <Button
                  key={category.id}
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => handleCategorize(category.id)}
                  disabled={isLoading}
                >
                  <div
                    className="mr-2 h-3 w-3 rounded-full shrink-0"
                    style={{ backgroundColor: category.color || "#666" }}
                  />
                  <span className="truncate">{category.name}</span>
                </Button>
              ))}
              {filteredCategories.length === 0 && searchQuery && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  {translate("noCategoriesFound")}
                </p>
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* Analytics */}
        <Popover
          open={analyticsPopoverOpen}
          onOpenChange={setAnalyticsPopoverOpen}
        >
          <PopoverTrigger
            nativeButton={false}
            render={
              <DockIcon
                className="bg-muted hover:bg-muted/80"
                title={translate("analytics")}
              />
            }
          >
            <RiLineChartLine className="size-5" />
          </PopoverTrigger>
          <PopoverContent
            className="w-48 p-0"
            align="center"
            side="top"
            sideOffset={12}
          >
            <div className="p-2 border-b">
              <p className="text-xs font-medium text-muted-foreground">
                {translate("analytics")}
              </p>
            </div>
            <div className="p-1">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => handleAnalyticsUpdate(true)}
                disabled={isAnalyticsLoading}
              >
                {translate("includeInAnalytics")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-muted-foreground"
                onClick={() => handleAnalyticsUpdate(false)}
                disabled={isAnalyticsLoading}
              >
                {translate("excludeFromAnalytics")}
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        {/* Link Transactions */}
        {selectedCount >= 2 && (
          <Tooltip>
            <TooltipTrigger
              render={
                <DockIcon
                  className={`bg-muted ${
                    hasLinkedTransactions
                      ? "opacity-50 cursor-not-allowed"
                      : "hover:bg-muted/80"
                  }`}
                  onClick={
                    hasLinkedTransactions ? undefined : handleLinkTransactions
                  }
                />
              }
            >
              {isLinking ? (
                <span className="size-5 animate-pulse">...</span>
              ) : (
                <RiLink className="size-5" />
              )}
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}>
              <p>
                {hasLinkedTransactions
                  ? translate("someTransactionsAlreadyLinked")
                  : translate("linkAsReimbursementGroup")}
              </p>
            </TooltipContent>
          </Tooltip>
        )}

        {/* Delete */}
        {canDelete && (
          <Tooltip>
            <TooltipTrigger
              render={
                <DockIcon
                  className="bg-muted hover:bg-destructive/20 hover:text-destructive"
                  onClick={() => setShowDeleteDialog(true)}
                />
              }
            >
              <RiDeleteBinLine className="size-5" />
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}>
              <p>{translate("deleteSelected")}</p>
            </TooltipContent>
          </Tooltip>
        )}

        {/* Export */}
        <Tooltip>
          <TooltipTrigger
            render={
              <DockIcon
                className="bg-muted hover:bg-muted/80"
                onClick={handleExport}
              />
            }
          >
            <RiDownloadLine className="size-5" />
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>
            <p>{translate("exportCsv")}</p>
          </TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="h-8" />

        {/* Clear selection */}
        <Tooltip>
          <TooltipTrigger
            render={
              <DockIcon
                className="bg-muted hover:bg-destructive/20 hover:text-destructive"
                onClick={onClearSelection}
              />
            }
          >
            <RiCloseLine className="size-5" />
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>
            <p>{translate("clearSelection")}</p>
          </TooltipContent>
        </Tooltip>
      </Dock>

      <DeleteConfirmationDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        transactionIds={selectedIds}
        onSuccess={(deletedIds) => {
          onBulkDelete?.(deletedIds);
          onClearSelection();
        }}
      />
    </div>
  );
}
