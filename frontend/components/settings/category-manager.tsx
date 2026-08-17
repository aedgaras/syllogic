"use client";
import { t as translate } from "@/i18n/translate";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RiAddLine } from "@remixicon/react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CategoryRow } from "@/components/onboarding/category-row";
import { CategoryFormDialog } from "@/components/onboarding/category-form-dialog";
import { DeleteCategoryDialog } from "./delete-category-dialog";
import {
  createCategory,
  updateCategory,
  getCategoryTransactionCount,
  deleteCategoryWithReassignment,
  type CategoryCreateInput,
  type CategoryUpdateInput,
  type CategoryInput,
} from "@/lib/actions/categories";
import type { SettingsCategory } from "@/features/settings/public";
import {
  groupCategoriesByType,
  getCategoryTypeLabel,
  type CategoryType,
} from "@/lib/utils/category-utils";

interface CategoryManagerProps {
  initialCategories: SettingsCategory[];
}

export function CategoryManager({ initialCategories }: CategoryManagerProps) {
  const router = useRouter();
  const [categories, setCategories] =
    useState<SettingsCategory[]>(initialCategories);
  const [activeTab, setActiveTab] = useState<CategoryType>("expense");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] =
    useState<SettingsCategory | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingCategory, setDeletingCategory] =
    useState<SettingsCategory | null>(null);
  const [deleteTransactionCount, setDeleteTransactionCount] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  const groupedCategories = groupCategoriesByType(categories);

  const getCategoriesByType = (type: CategoryType) => groupedCategories[type];

  const handleEdit = (category: SettingsCategory) => {
    setEditingCategory(category);
    setDialogOpen(true);
  };

  const handleDelete = async (category: SettingsCategory) => {
    if (category.isSystem) {
      toast.error(translate("systemCategoriesCannotBeDeleted"));
      return;
    }

    // Fetch transaction count and open delete dialog
    setIsLoading(true);
    try {
      const { count } = await getCategoryTransactionCount(category.id);
      setDeletingCategory(category);
      setDeleteTransactionCount(count);
      setDeleteDialogOpen(true);
    } catch {
      toast.error(translate("failedToCheckCategoryUsage"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmDelete = async (reassignToCategoryId: string | null) => {
    if (!deletingCategory) return;

    setIsDeleting(true);
    try {
      const result = await deleteCategoryWithReassignment(
        deletingCategory.id,
        reassignToCategoryId,
      );
      if (result.success) {
        setCategories(categories.filter((c) => c.id !== deletingCategory.id));
        const message =
          result.reassignedCount && result.reassignedCount > 0
            ? translate("categoryDeletedTransaction", {
                value1: result.reassignedCount,
                value2: result.reassignedCount !== 1 ? "s" : "",
                value3: reassignToCategoryId
                  ? "reassigned"
                  : "set to uncategorized",
              })
            : translate("categoryDeleted");
        toast.success(message);
        router.refresh();
        setDeleteDialogOpen(false);
      } else {
        toast.error(result.error || translate("failedToDeleteCategory"));
      }
    } catch {
      toast.error(translate("anErrorOccurredPleaseTryAgain"));
    } finally {
      setIsDeleting(false);
    }
  };

  const handleAddClick = (type: "expense" | "income" | "transfer") => {
    setEditingCategory(null);
    setActiveTab(type);
    setDialogOpen(true);
  };

  const handleSaveCategory = async (categoryInput: CategoryInput) => {
    setIsLoading(true);
    try {
      if (editingCategory) {
        // Update existing category
        const updateData: CategoryUpdateInput = {
          name: categoryInput.name,
          color: categoryInput.color,
          icon: categoryInput.icon,
          description: categoryInput.description,
          categorizationInstructions: categoryInput.categorizationInstructions,
        };

        const result = await updateCategory(editingCategory.id, updateData);
        if (result.success) {
          // Update local state
          setCategories(
            categories.map((c) =>
              c.id === editingCategory.id
                ? {
                    ...c,
                    name: categoryInput.name,
                    color: categoryInput.color,
                    icon: categoryInput.icon,
                    description: categoryInput.description || null,
                    categorizationInstructions:
                      categoryInput.categorizationInstructions || null,
                  }
                : c,
            ),
          );
          toast.success(translate("categoryUpdated"));
          router.refresh();
        } else {
          toast.error(result.error || translate("failedToUpdateCategory"));
        }
      } else {
        // Create new category
        const createData: CategoryCreateInput = {
          name: categoryInput.name,
          categoryType: categoryInput.categoryType,
          color: categoryInput.color,
          icon: categoryInput.icon,
          description: categoryInput.description,
          categorizationInstructions: categoryInput.categorizationInstructions,
        };

        const result = await createCategory(createData);
        if (result.success && result.categoryId) {
          // Add to local state
          const newCategory: SettingsCategory = {
            id: result.categoryId,
            userId: "", // Will be filled by server
            name: categoryInput.name,
            parentId: null,
            categoryType: categoryInput.categoryType,
            color: categoryInput.color,
            icon: categoryInput.icon,
            description: categoryInput.description || null,
            categorizationInstructions:
              categoryInput.categorizationInstructions || null,
            isSystem: false,
            hideFromSelection: false,
            createdAt: new Date(),
          };
          setCategories([...categories, newCategory]);
          toast.success(translate("categoryCreated"));
          router.refresh();
        } else {
          toast.error(result.error || translate("failedToCreateCategory"));
        }
      }
    } catch {
      toast.error(translate("anErrorOccurredPleaseTryAgain"));
    } finally {
      setIsLoading(false);
      setDialogOpen(false);
    }
  };

  const categoryToInput = (
    category: SettingsCategory | null,
  ): CategoryInput | null => {
    if (!category) return null;
    return {
      name: category.name,
      categoryType: category.categoryType as "expense" | "income" | "transfer",
      color: category.color || "#6b7280",
      icon: category.icon || "RiFolderLine",
      description: category.description || undefined,
      categorizationInstructions:
        category.categorizationInstructions || undefined,
      isSystem: category.isSystem || false,
    };
  };

  const renderCategoryList = (
    categoryList: SettingsCategory[],
    categoryType: "expense" | "income" | "transfer",
  ) => {
    return (
      <div className="flex flex-col">
        {/* Category list */}
        <div className="space-y-1 min-h-[200px] max-h-[400px] overflow-y-auto">
          {categoryList.length === 0 ? (
            <div className="flex h-24 items-center justify-center rounded border border-dashed">
              <p className="text-sm text-muted-foreground">
                {translate("noCategoriesYet")}
              </p>
            </div>
          ) : (
            categoryList.map((category) => {
              const input = categoryToInput(category);
              if (!input) return null;
              return (
                <CategoryRow
                  key={category.id}
                  category={input}
                  onEdit={() => handleEdit(category)}
                  onDelete={() => handleDelete(category)}
                />
              );
            })
          )}
        </div>

        {/* Add button */}
        <div className="pt-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => handleAddClick(categoryType)}
            disabled={isLoading}
          >
            <RiAddLine className="mr-2 h-4 w-4" />
            {translate("add")} {getCategoryTypeLabel(categoryType)}{" "}
            {translate("category")}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{translate("categories")}</CardTitle>
          <CardDescription>
            {translate(
              "manageYourTransactionCategoriesCategoriesHelpYouOrganizeAnd",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as CategoryType)}
          >
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="expense">
                {translate("expenses10fcd2")}
                {groupedCategories.expense.length})
              </TabsTrigger>
              <TabsTrigger value="income">
                {translate("incomec43e68")}
                {groupedCategories.income.length})
              </TabsTrigger>
              <TabsTrigger value="transfer">
                {translate("transfers908301")}
                {groupedCategories.transfer.length})
              </TabsTrigger>
            </TabsList>
            <TabsContent value="expense" className="mt-4">
              {renderCategoryList(groupedCategories.expense, "expense")}
            </TabsContent>
            <TabsContent value="income" className="mt-4">
              {renderCategoryList(groupedCategories.income, "income")}
            </TabsContent>
            <TabsContent value="transfer" className="mt-4">
              {renderCategoryList(groupedCategories.transfer, "transfer")}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <CategoryFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        categoryType={activeTab}
        category={categoryToInput(editingCategory)}
        onSave={handleSaveCategory}
        existingCount={getCategoriesByType(activeTab).length}
      />

      <DeleteCategoryDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        category={deletingCategory}
        transactionCount={deleteTransactionCount}
        sameTypeCategories={
          deletingCategory?.categoryType
            ? getCategoriesByType(deletingCategory.categoryType as CategoryType)
            : []
        }
        onConfirm={handleConfirmDelete}
        isLoading={isDeleting}
      />
    </>
  );
}
