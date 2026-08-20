"use client";
import { t as translate } from "@/i18n/translate";

import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CURRENCIES } from "@/lib/constants/currencies";
import { normalizeDecimalInput } from "@/lib/utils";
import { CategoryMultiSelect } from "./category-multi-select";
import {
  budgetEditSchema,
  type BudgetEditFormValues,
} from "@/features/budgets/public";
import { getCategoryBudgetUsage } from "@/features/budgets/client/actions";
import type { BudgetPeriod, BudgetViewModel } from "@/features/budgets/public";

interface BudgetEditFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  budget?: BudgetViewModel | null;
  categories: Array<{ id: string; name: string; color: string | null }>;
  defaultCurrency: string;
  pending: boolean;
  onSubmit: (values: BudgetEditFormValues) => Promise<void>;
}

const periodOptions: Array<{ value: BudgetPeriod; label: string }> = [
  { value: "monthly", label: translate("monthly") },
  { value: "weekly", label: translate("weekly") },
  { value: "yearly", label: translate("yearly") },
];

function defaultValuesFor(
  budget: BudgetViewModel | null | undefined,
  defaultCurrency: string,
): BudgetEditFormValues {
  if (budget) {
    return {
      name: budget.name,
      amount: budget.amount,
      currency: budget.currency,
      period: budget.period,
      categories: budget.categories.map((c) => ({
        categoryId: c.id,
        subLimit: c.subLimit,
      })),
    };
  }
  return {
    name: "",
    amount: 0,
    currency: defaultCurrency,
    period: "monthly",
    categories: [],
  };
}

export function BudgetEditForm({
  open,
  onOpenChange,
  budget,
  categories,
  defaultCurrency,
  pending,
  onSubmit,
}: BudgetEditFormProps) {
  const isEditMode = !!budget;
  const [usage, setUsage] = useState<
    Record<string, Array<{ budgetId: string; budgetName: string }>>
  >({});

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<BudgetEditFormValues>({
    resolver: zodResolver(budgetEditSchema),
    defaultValues: defaultValuesFor(budget, defaultCurrency),
  });

  useEffect(() => {
    if (open) {
      reset(defaultValuesFor(budget, defaultCurrency));
      getCategoryBudgetUsage().then(setUsage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, budget]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {isEditMode ? translate("editBudget") : translate("createBudget")}
          </DialogTitle>
        </DialogHeader>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto overflow-x-hidden py-4 pr-1">
            <div className="grid gap-2">
              <Label htmlFor="budget-name">{translate("budgetName")}</Label>
              <Input id="budget-name" {...register("name")} />
              {errors.name?.message && (
                <p className="text-xs text-destructive">
                  {errors.name.message}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="budget-amount">
                  {translate("budgetAmount")}
                </Label>
                <Input
                  id="budget-amount"
                  type="text"
                  inputMode="decimal"
                  {...register("amount", { setValueAs: normalizeDecimalInput })}
                />
                {errors.amount?.message && (
                  <p className="text-xs text-destructive">
                    {errors.amount.message}
                  </p>
                )}
              </div>

              <Controller
                control={control}
                name="currency"
                render={({ field }) => (
                  <div className="grid gap-2">
                    <Label>{translate("currency")}</Label>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map((currency) => (
                          <SelectItem key={currency.code} value={currency.code}>
                            {currency.code}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              />
            </div>

            <Controller
              control={control}
              name="period"
              render={({ field }) => (
                <div className="grid gap-2">
                  <Label>{translate("budgetPeriod")}</Label>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {periodOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            />

            <Controller
              control={control}
              name="categories"
              render={({ field }) => {
                const selectedIds = field.value.map((c) => c.categoryId);
                const subLimits = Object.fromEntries(
                  field.value.map((c) => [
                    c.categoryId,
                    c.subLimit == null ? "" : String(c.subLimit),
                  ]),
                );
                return (
                  <CategoryMultiSelect
                    label={translate("budgetCategoriesOptional")}
                    options={categories}
                    value={selectedIds}
                    onChange={(ids) => {
                      const bySubLimit = new Map(
                        field.value.map((c) => [c.categoryId, c.subLimit]),
                      );
                      field.onChange(
                        ids.map((categoryId) => ({
                          categoryId,
                          subLimit: bySubLimit.get(categoryId) ?? null,
                        })),
                      );
                    }}
                    usage={usage}
                    subLimits={subLimits}
                    onSubLimitChange={(categoryId, value) => {
                      field.onChange(
                        field.value.map((c) =>
                          c.categoryId === categoryId
                            ? { ...c, subLimit: value === "" ? null : Number(value) }
                            : c,
                        ),
                      );
                    }}
                  />
                );
              }}
            />
          </div>

          <DialogFooter className="mt-4 flex-col-reverse gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              {translate("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? translate("saving") : translate("confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
