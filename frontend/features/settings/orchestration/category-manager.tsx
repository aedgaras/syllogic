"use client";
import { t as translate } from "@/i18n/translate";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RiAddLine, RiFolderAddLine } from "@remixicon/react";
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
import { DeleteCategoryDialog } from "@/components/settings/delete-category-dialog";
import {
  createCategory,
  updateCategory,
  getCategoryTransactionCount,
  deleteCategoryWithReassignment,
  type CategoryCreateInput,
  type CategoryUpdateInput,
  type CategoryInput,
} from "@/features/settings/client/actions";
import type { SettingsCategory } from "@/features/settings/public";
import { categoryToFormInput } from "@/features/settings/domain/category-mapping";
import {
  groupCategoriesByType,
  getCategoryTypeLabel,
  isCategoryGroup,
  splitCategoriesIntoSections,
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

  // Group being added to, and whether the dialog is creating a group itself.
  const [addingParentId, setAddingParentId] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);

  const groupedCategories = groupCategoriesByType(categories);

  const getCategoriesByType = (type: CategoryType) => groupedCategories[type];

  const groupsByType = (type: CategoryType) =>
    groupedCategories[type].filter((category) =>
      isCategoryGroup(category, categories),
    );

  const handleEdit = (category: SettingsCategory) => {
    setEditingCategory(category);
    setCreatingGroup(false);
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
        setCategories(
          categories
            .filter((c) => c.id !== deletingCategory.id)
            .map((c) =>
              c.parentId === deletingCategory.id ? { ...c, parentId: null } : c,
            ),
        );
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
        toast.success(message, {
          description:
            result.ungroupedCount && result.ungroupedCount > 0
              ? translate("deletingAGroupLeavesItsCategoriesUngrouped")
              : undefined,
        });
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

  const handleAddClick = (
    type: "expense" | "income" | "transfer",
    parentId: string | null = null,
    asGroup = false,
  ) => {
    setEditingCategory(null);
    setActiveTab(type);
    setAddingParentId(parentId);
    setCreatingGroup(asGroup);
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
          ...(categoryInput.isGroup
            ? {}
            : { parentId: categoryInput.parentId ?? null }),
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
                    parentId: categoryInput.isGroup
                      ? null
                      : (categoryInput.parentId ?? null),
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
          parentId: categoryInput.isGroup
            ? null
            : (categoryInput.parentId ?? null),
          isGroup: categoryInput.isGroup,
        };

        const result = await createCategory(createData);
        if (result.success && result.categoryId) {
          // Add to local state
          const newCategory: SettingsCategory = {
            id: result.categoryId,
            userId: "", // Will be filled by server
            name: categoryInput.name,
            parentId: categoryInput.isGroup
              ? null
              : (categoryInput.parentId ?? null),
            categoryType: categoryInput.categoryType,
            color: categoryInput.color,
            icon: categoryInput.icon,
            description: categoryInput.description || null,
            categorizationInstructions:
              categoryInput.categorizationInstructions || null,
            isSystem: false,
            hideFromSelection: categoryInput.isGroup ?? false,
            systemKey: null,
            createdAt: new Date(),
          };
          setCategories([...categories, newCategory]);
          toast.success(
            categoryInput.isGroup
              ? translate("categoryGroupCreated")
              : translate("categoryCreated"),
          );
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

  const categoryToInput = categoryToFormInput;

  const renderCategoryRow = (category: SettingsCategory) => {
    const input = categoryToInput(
      category,
      isCategoryGroup(category, categories),
    );
    if (!input) return null;
    return (
      <CategoryRow
        key={category.id}
        category={input}
        onEdit={() => handleEdit(category)}
        onDelete={() => handleDelete(category)}
      />
    );
  };

  const renderCategoryList = (
    categoryList: SettingsCategory[],
    categoryType: "expense" | "income" | "transfer",
  ) => {
    const sections = splitCategoriesIntoSections(categoryList);

    return (
      <div className="flex flex-col">
        {/* Grouped category list: one block per group, then the ungrouped rest */}
        <div className="space-y-4 min-h-[200px] max-h-[400px] overflow-y-auto">
          {categoryList.length === 0 ? (
            <div className="flex h-24 items-center justify-center rounded border border-dashed">
              <p className="text-sm text-muted-foreground">
                {translate("noCategoriesYet")}
              </p>
            </div>
          ) : (
            sections.map((section) => (
              <div key={section.group?.id ?? "ungrouped"}>
                <div className="mb-1 flex items-center gap-2 border-b pb-1">
                  {section.group && (
                    <div
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{
                        backgroundColor: section.group.color ?? "#6b7280",
                      }}
                    />
                  )}
                  <h3 className="flex-1 truncate text-sm font-semibold">
                    {section.group?.name ?? translate("ungrouped")}{" "}
                    <span className="font-normal text-muted-foreground">
                      ({section.categories.length})
                    </span>
                  </h3>
                  {section.group && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() =>
                        handleAddClick(categoryType, section.group?.id ?? null)
                      }
                      disabled={isLoading}
                    >
                      <RiAddLine className="mr-1 h-3 w-3" />
                      {translate("add")}
                    </Button>
                  )}
                </div>
                <div className="space-y-1">
                  {section.group && renderCategoryRow(section.group)}
                  {section.categories.length === 0 ? (
                    <p className="px-1 py-2 text-sm text-muted-foreground">
                      {translate("noCategories")}
                    </p>
                  ) : (
                    <div className="space-y-1 sm:pl-6">
                      {section.categories.map((category) =>
                        renderCategoryRow(category),
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Add buttons */}
        <div className="flex flex-col gap-2 pt-4 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => handleAddClick(categoryType)}
            disabled={isLoading}
          >
            <RiAddLine className="mr-2 h-4 w-4" />
            {translate("add")} {getCategoryTypeLabel(categoryType)}{" "}
            {translate("category")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => handleAddClick(categoryType, null, true)}
            disabled={isLoading}
          >
            <RiFolderAddLine className="mr-2 h-4 w-4" />
            {translate("addGroup")}
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
        category={categoryToInput(
          editingCategory,
          editingCategory
            ? isCategoryGroup(editingCategory, categories)
            : false,
        )}
        onSave={handleSaveCategory}
        existingCount={getCategoriesByType(activeTab).length}
        groups={groupsByType(activeTab).map((group) => ({
          id: group.id,
          name: group.name,
        }))}
        defaultParentId={addingParentId}
        createGroup={creatingGroup}
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
