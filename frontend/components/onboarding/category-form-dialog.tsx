"use client";
import { t as translate } from "@/i18n/translate";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CategoryColorPicker } from "./category-color-picker";
import { CATEGORY_COLORS } from "@/lib/constants";
import { type CategoryInput } from "@/lib/actions/categories";

export interface CategoryGroupOption {
  id: string;
  name: string;
}

const NO_GROUP_VALUE = "__none__";

interface CategoryFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryType: "expense" | "income" | "transfer";
  category?: CategoryInput | null;
  onSave: (category: CategoryInput) => void;
  existingCount?: number;
  /**
   * Groups of the same category type this category can be filed under. Omit to
   * hide the group picker entirely (onboarding, where nothing has an id yet).
   */
  groups?: CategoryGroupOption[];
  /** Preselected group for a new category. */
  defaultParentId?: string | null;
  /** When true, the dialog creates a group instead of a plain category. */
  createGroup?: boolean;
}

export function CategoryFormDialog({
  open,
  onOpenChange,
  categoryType,
  category,
  onSave,
  existingCount = 0,
  groups,
  defaultParentId = null,
  createGroup = false,
}: CategoryFormDialogProps) {
  const isEditing = !!category;
  const isSystem = !!category?.isSystem;
  const isGroup = createGroup || !!category?.isGroup;
  const showGroupPicker = !!groups && !isGroup && !isSystem;

  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(CATEGORY_COLORS[0].value);
  const [description, setDescription] = useState("");
  const [categorizationInstructions, setCategorizationInstructions] =
    useState("");
  const [parentId, setParentId] = useState<string | null>(null);

  // Reset form when dialog opens or category changes
  useEffect(() => {
    if (open) {
      if (category) {
        setName(category.name);
        setColor(category.color);
        setDescription(category.description || "");
        setCategorizationInstructions(
          category.categorizationInstructions || "",
        );
        setParentId(category.parentId ?? null);
      } else {
        // New category - reset form with default color based on existing count
        setName("");
        setColor(CATEGORY_COLORS[existingCount % CATEGORY_COLORS.length].value);
        setDescription("");
        setCategorizationInstructions("");
        setParentId(defaultParentId);
      }
    }
  }, [open, category, existingCount, defaultParentId]);

  const handleSave = () => {
    if (!name.trim() || !description.trim()) return;

    const updatedCategory: CategoryInput = {
      name: isSystem && category ? category.name : name.trim(),
      categoryType,
      color: isSystem && category ? category.color : color,
      icon: category?.icon || "RiFolderLine",
      description: description.trim(),
      categorizationInstructions:
        categorizationInstructions.trim() || undefined,
      isSystem: category?.isSystem,
      isGroup,
      parentId: isGroup ? null : parentId,
    };

    onSave(updatedCategory);
    onOpenChange(false);
  };

  const getCategoryTypeLabel = () => {
    switch (categoryType) {
      case "expense":
        return "Expense";
      case "income":
        return "Income";
      case "transfer":
        return "Transfer";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing
              ? translate("editCategory")
              : isGroup
                ? translate("addGroup")
                : translate("addCategory", { value1: getCategoryTypeLabel() })}
          </DialogTitle>
          <DialogDescription>
            {isGroup
              ? translate("categoryGroupHelp")
              : isSystem
                ? translate(
                    "systemCategoryOnlyDescriptionAndCategorizationInstructionsCanBe",
                  )
                : isEditing
                  ? translate("updateTheCategoryDetailsBelow")
                  : translate("createANewCategoryToOrganizeYourTransactions")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">
              {translate("name")}
              {isSystem ? "" : " *"}
            </Label>
            <div className="flex items-center gap-3">
              <CategoryColorPicker
                value={color}
                onChange={setColor}
                disabled={isSystem}
              />
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={translate("enterCategoryName")}
                className="flex-1"
                disabled={isSystem}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">
              {translate("descriptionb5bba3")}
            </Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={translate("briefDescriptionOfThisCategory")}
            />
          </div>

          {showGroupPicker && (
            <div className="space-y-2">
              <Label htmlFor="categoryGroup">{translate("group")}</Label>
              <Select
                value={parentId ?? NO_GROUP_VALUE}
                onValueChange={(value) =>
                  setParentId(value === NO_GROUP_VALUE ? null : value)
                }
              >
                <SelectTrigger id="categoryGroup">
                  <SelectValue placeholder={translate("noGroup")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_GROUP_VALUE}>
                    {translate("noGroup")}
                  </SelectItem>
                  {groups?.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2" hidden={isGroup}>
            <Label htmlFor="categorizationInstructions">
              {translate("categorizationInstructions")}
            </Label>
            <Textarea
              id="categorizationInstructions"
              value={categorizationInstructions}
              onChange={(e) => setCategorizationInstructions(e.target.value)}
              placeholder={translate(
                "instructionsForAiToCategorizeTransactionsIntoThisCategory",
              )}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              {translate("helpTheAiUnderstandWhenToUseThisCategory")}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {translate("cancel")}
          </Button>
          <Button
            onClick={handleSave}
            disabled={!name.trim() || !description.trim()}
          >
            {isEditing
              ? translate("saveChangesfa2984")
              : translate("addCategory9c4eb0")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
