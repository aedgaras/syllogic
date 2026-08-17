"use client";
import { t as translate } from "@/i18n/translate";


import { useState, useEffect } from "react";
import { RiAlertLine } from "@remixicon/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SettingsCategory } from "@/features/settings/public";

interface DeleteCategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: SettingsCategory | null;
  transactionCount: number;
  sameTypeCategories: SettingsCategory[];
  onConfirm: (reassignToCategoryId: string | null) => Promise<void>;
  isLoading?: boolean;
}

export function DeleteCategoryDialog({
  open,
  onOpenChange,
  category,
  transactionCount,
  sameTypeCategories,
  onConfirm,
  isLoading = false,
}: DeleteCategoryDialogProps) {
  const [confirmText, setConfirmText] = useState("");
  const [reassignOption, setReassignOption] = useState<"uncategorized" | "reassign">("uncategorized");
  const [reassignCategoryId, setReassignCategoryId] = useState<string>("");

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setConfirmText("");
      setReassignOption("uncategorized");
      setReassignCategoryId("");
    }
  }, [open]);

  if (!category) return null;

  const isConfirmValid = confirmText === category.name;
  const hasTransactions = transactionCount > 0;
  const availableCategories = sameTypeCategories.filter((c) => c.id !== category.id);

  const handleConfirm = async () => {
    const targetCategoryId = reassignOption === "reassign" ? reassignCategoryId : null;
    await onConfirm(targetCategoryId);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
              <RiAlertLine className="h-5 w-5 text-destructive" />
            </div>
            <AlertDialogTitle>{translate("delete63346e")}{category.name}"?</AlertDialogTitle>
          </div>
          <AlertDialogDescription>
            {hasTransactions ? (
              <>
                {translate("thisCategoryHas")} <span className="font-semibold text-foreground">{transactionCount} {translate("transaction41c48b")}{transactionCount !== 1 ? "s" : ""}</span> {translate("assignedToIt")}
              </>
            ) : (
              <>{translate("thisCategoryHasNoTransactionsItWillBePermanently")}</>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {hasTransactions && (
          <div className="space-y-3 py-2">
            <Label>{translate("whatShouldHappenToTheseTransactions")}</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={reassignOption === "uncategorized" ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => setReassignOption("uncategorized")}
              >
                {translate("leaveUncategorized")}
              </Button>
              <Button
                type="button"
                variant={reassignOption === "reassign" ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => setReassignOption("reassign")}
                disabled={availableCategories.length === 0}
              >
                {translate("reassign")}
              </Button>
            </div>

            {reassignOption === "reassign" && availableCategories.length > 0 && (
              <Select
                value={reassignCategoryId}
                onValueChange={(value) => value && setReassignCategoryId(value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={translate("selectACategory")}>
                    {reassignCategoryId ? (
                      <div className="flex items-center gap-2">
                        <div
                          className="h-3 w-3 rounded-full shrink-0"
                          style={{
                            backgroundColor:
                              availableCategories.find((c) => c.id === reassignCategoryId)?.color || "#666",
                          }}
                        />
                        <span>
                          {availableCategories.find((c) => c.id === reassignCategoryId)?.name}
                        </span>
                      </div>
                    ) : (
                      translate("selectACategory")
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {availableCategories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      <div className="flex items-center gap-2">
                        <div
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: cat.color || "#666" }}
                        />
                        {cat.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="confirm-name">
            {translate("type")} <span className="font-semibold text-foreground">{category.name}</span> {translate("toConfirm")}
          </Label>
          <Input
            id="confirm-name"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={category.name}
            autoComplete="off"
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>{translate("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={
              !isConfirmValid ||
              isLoading ||
              (reassignOption === "reassign" && !reassignCategoryId)
            }
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isLoading ? translate("deleting") : translate("deleteCategoryea9ac9")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
