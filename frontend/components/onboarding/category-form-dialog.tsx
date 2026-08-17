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
import { CategoryColorPicker } from "./category-color-picker";
import { CATEGORY_COLORS } from "@/lib/constants";
import { type CategoryInput } from "@/lib/actions/categories";

interface CategoryFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryType: "expense" | "income" | "transfer";
  category?: CategoryInput | null;
  onSave: (category: CategoryInput) => void;
  existingCount?: number;
}

export function CategoryFormDialog({
  open,
  onOpenChange,
  categoryType,
  category,
  onSave,
  existingCount = 0,
}: CategoryFormDialogProps) {
  const isEditing = !!category;
  const isSystem = !!category?.isSystem;

  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(CATEGORY_COLORS[0].value);
  const [description, setDescription] = useState("");
  const [categorizationInstructions, setCategorizationInstructions] =
    useState("");

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
      } else {
        // New category - reset form with default color based on existing count
        setName("");
        setColor(CATEGORY_COLORS[existingCount % CATEGORY_COLORS.length].value);
        setDescription("");
        setCategorizationInstructions("");
      }
    }
  }, [open, category, existingCount]);

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
              : translate("addCategory", { value1: getCategoryTypeLabel() })}
          </DialogTitle>
          <DialogDescription>
            {isSystem
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

          <div className="space-y-2">
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
