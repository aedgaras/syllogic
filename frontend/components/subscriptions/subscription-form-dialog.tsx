"use client";
import { t as translate } from "@/i18n/translate";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { CategorySelect } from "@/components/categories/category-select";
import { AccountSelect } from "@/components/accounts/account-select";
import { CompanyLogo } from "@/components/ui/company-logo";
import { RiSearchLine, RiCloseLine, RiLoader4Line } from "@remixicon/react";
import { toast } from "sonner";
import {
  createSubscription,
  hasLogoApiKey,
  searchLogo,
  updateSubscription,
  verifySuggestion,
} from "@/features/subscriptions/client/actions";
import type {
  SubscriptionCreateInput,
  SubscriptionFrequency,
  SubscriptionSuggestionViewModel,
  SubscriptionUpdateInput,
  SubscriptionViewModel,
} from "@/features/subscriptions/public";
import { withAssetVersion } from "@/lib/utils/asset-url";
import { normalizeDecimalInput } from "@/lib/utils";
import { logger } from "@/lib/logger";

interface SubscriptionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscription?: SubscriptionViewModel | null;
  suggestion?: SubscriptionSuggestionViewModel | null;
  accounts: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string; color: string | null }>;
  onSuccess?: (
    suggestionId?: string,
    newSubscription?: SubscriptionViewModel,
  ) => void;
}

const frequencyOptions = [
  { value: "monthly", label: translate("monthly") },
  { value: "weekly", label: translate("weekly") },
  { value: "biweekly", label: translate("biWeekly") },
  { value: "quarterly", label: translate("quarterly") },
  { value: "yearly", label: translate("yearly") },
];

export function SubscriptionFormDialog({
  open,
  onOpenChange,
  subscription,
  suggestion,
  accounts,
  categories,
  onSuccess,
}: SubscriptionFormDialogProps) {
  const [accountId, setAccountId] = useState<string>("");
  const [name, setName] = useState("");
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [isVariable, setIsVariable] = useState(false);
  const [categoryId, setCategoryId] = useState<string>("");
  const [importance, setImportance] = useState(2);
  const [frequency, setFrequency] = useState<SubscriptionFrequency>("monthly");
  const [description, setDescription] = useState("");
  const [autoGenerate, setAutoGenerate] = useState(false);
  const [nextDueDate, setNextDueDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Logo state
  const [logoId, setLogoId] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoSearch, setLogoSearch] = useState("");
  const [isSearchingLogo, setIsSearchingLogo] = useState(false);
  const [logoSearchAttempted, setLogoSearchAttempted] = useState(false);
  const [logoApiEnabled, setLogoApiEnabled] = useState(false);

  const isEditMode = !!subscription;
  const isVerifyMode = !!suggestion;

  // Check if logo API is enabled
  useEffect(() => {
    hasLogoApiKey().then(setLogoApiEnabled);
  }, []);

  // Reset form when dialog opens/closes or subscription/suggestion changes
  useEffect(() => {
    if (open) {
      if (subscription) {
        // Edit mode - populate with existing data
        setAccountId(subscription.accountId || accounts[0]?.id || "");
        setName(subscription.name);
        setMerchant(subscription.merchant || "");
        setAmount(subscription.amount);
        setIsVariable(subscription.isVariable ?? false);
        setCategoryId(subscription.categoryId || "");
        // Cap importance at 3 for existing subscriptions with higher values
        setImportance(Math.min(subscription.importance, 3));
        setFrequency(subscription.frequency as SubscriptionFrequency);
        setDescription(subscription.description || "");
        setAutoGenerate(subscription.autoGenerate ?? false);
        setNextDueDate(subscription.nextDueDate || "");
        setEndDate(subscription.endDate || "");
        // Set logo
        setLogoId(subscription.logoId || null);
        setLogoUrl(
          withAssetVersion(
            subscription.logo?.logoUrl,
            subscription.logo?.updatedAt,
          ),
        );
        setLogoSearch("");
        setLogoSearchAttempted(false);
      } else if (suggestion) {
        // Verify mode - populate with suggestion data
        setAccountId(suggestion.accountId || accounts[0]?.id || "");
        setName(suggestion.suggestedName);
        setMerchant(suggestion.suggestedMerchant || "");
        setAmount(suggestion.suggestedAmount);
        setIsVariable(suggestion.isVariableAmount ?? false);
        setCategoryId(suggestion.suggestedCategoryId || "");
        setImportance(2);
        setFrequency(suggestion.detectedFrequency as SubscriptionFrequency);
        setDescription("");
        setAutoGenerate(false);
        setNextDueDate("");
        setEndDate("");
        // Reset logo
        setLogoId(null);
        setLogoUrl(null);
        setLogoSearch("");
        setLogoSearchAttempted(false);
      } else {
        // Create mode - reset to defaults
        setAccountId(accounts[0]?.id ?? "");
        setName("");
        setMerchant("");
        setAmount("");
        setIsVariable(false);
        setCategoryId("");
        setImportance(2);
        setFrequency("monthly");
        setDescription("");
        setAutoGenerate(false);
        setNextDueDate("");
        setEndDate("");
        // Reset logo
        setLogoId(null);
        setLogoUrl(null);
        setLogoSearch("");
        setLogoSearchAttempted(false);
      }
    }
  }, [open, subscription, suggestion, accounts]);

  // Handle logo search
  const handleLogoSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      return;
    }

    setIsSearchingLogo(true);
    setLogoSearchAttempted(true);

    try {
      const result = await searchLogo(query);

      if (result.success && result.logo) {
        setLogoId(result.logo.id);
        setLogoUrl(
          withAssetVersion(result.logo.logoUrl, result.logo.updatedAt),
        );
        toast.success(translate("logoFound"));
      } else if (result.success) {
        toast.info(translate("noLogoFoundForThisCompany"));
      } else {
        toast.error(result.error || translate("failedToSearchForLogo"));
      }
    } catch {
      toast.error(translate("failedToSearchForLogo"));
    } finally {
      setIsSearchingLogo(false);
    }
  }, []);

  // Auto-search for logo when name changes (only on create/verify mode, debounced)
  useEffect(() => {
    if (
      !open ||
      isEditMode ||
      logoSearchAttempted ||
      !name.trim() ||
      logoId ||
      !logoApiEnabled
    ) {
      return;
    }

    const timer = setTimeout(() => {
      handleLogoSearch(name);
    }, 1000);

    return () => clearTimeout(timer);
  }, [
    name,
    open,
    isEditMode,
    logoSearchAttempted,
    logoId,
    logoApiEnabled,
    handleLogoSearch,
  ]);

  // Clear logo
  const handleClearLogo = () => {
    setLogoId(null);
    setLogoUrl(null);
    setLogoSearch("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (!name.trim()) {
      toast.error(translate("nameIsRequired"));
      return;
    }

    if (!accountId) {
      toast.error(translate("accountIsRequired"));
      return;
    }

    const amountNum = parseFloat(amount);
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      toast.error(translate("amountMustBeGreaterThan0"));
      return;
    }

    if (importance < 1 || importance > 3) {
      toast.error(translate("importanceMustBeBetween1And3"));
      return;
    }

    if (autoGenerate && !nextDueDate) {
      toast.error(translate("nextDueDateIsRequiredToAutoGenerateTransactions"));
      return;
    }

    if (endDate && nextDueDate && endDate < nextDueDate) {
      toast.error(translate("endDateMustBeAfterNextDueDate"));
      return;
    }

    setIsSubmitting(true);

    try {
      if (isEditMode) {
        // Update existing
        const input: SubscriptionUpdateInput = {
          accountId,
          name: name.trim(),
          merchant: merchant.trim() || undefined,
          amount: amountNum,
          isVariable,
          categoryId: categoryId || undefined,
          logoId: logoId || null,
          importance,
          frequency,
          description: description.trim() || undefined,
          autoGenerate,
          nextDueDate: autoGenerate ? nextDueDate : null,
          endDate: autoGenerate ? endDate || null : null,
        };

        const result = await updateSubscription(subscription.id, input);

        if (result.success) {
          toast.success(translate("subscriptionUpdated"));
          onOpenChange(false);
          // Pass the updated subscription data for immediate UI update
          const selectedCategory = categoryId
            ? categories.find((category) => category.id === categoryId)
            : null;
          const updatedSubscription = {
            ...subscription,
            accountId,
            name: name.trim(),
            merchant: merchant.trim() || null,
            amount: amountNum.toFixed(2),
            isVariable,
            categoryId: categoryId || null,
            category: selectedCategory
              ? {
                  id: selectedCategory.id,
                  name: selectedCategory.name,
                  color: selectedCategory.color,
                }
              : null,
            logoId: logoId || null,
            importance,
            frequency,
            description: description.trim() || null,
            autoGenerate,
            nextDueDate: autoGenerate ? nextDueDate : null,
            endDate: autoGenerate ? endDate || null : null,
            logo:
              logoId && logoUrl
                ? { id: logoId, logoUrl, updatedAt: new Date() }
                : null,
            account:
              accounts.find((account) => account.id === accountId) || null,
            updatedAt: new Date(),
          };
          onSuccess?.(undefined, updatedSubscription);
        } else {
          toast.error(result.error || translate("failedToUpdate"));
        }
      } else if (isVerifyMode) {
        // Verify suggestion - creates subscription and links transactions
        // Pass form values as overrides to allow user customization
        const result = await verifySuggestion(suggestion.id, {
          accountId,
          name: name.trim(),
          merchant: merchant.trim() || undefined,
          amount: amountNum,
          isVariable,
          categoryId: categoryId || undefined,
          logoId: logoId || undefined,
          importance,
          frequency,
          description: description.trim() || undefined,
        });

        if (result.success) {
          const skipped = result.skippedCountDifferentAccount || 0;
          const message =
            skipped > 0
              ? translate(
                  "subscriptionCreatedLinkedTransactionSSkippedFromOtherAccount",
                  { value1: result.linkedCount || 0, skipped: skipped },
                )
              : translate("subscriptionCreatedAndTransactionSLinked", {
                  value1: result.linkedCount || 0,
                });
          toast.success(message);
          onOpenChange(false);
          onSuccess?.(
            suggestion.id,
            result.subscription as SubscriptionViewModel,
          );
        } else {
          toast.error(result.error || translate("failedToVerify"));
        }
      } else {
        // Create new
        const input: SubscriptionCreateInput = {
          accountId,
          name: name.trim(),
          merchant: merchant.trim() || undefined,
          amount: amountNum,
          isVariable,
          categoryId: categoryId || undefined,
          logoId: logoId || undefined,
          importance,
          frequency,
          description: description.trim() || undefined,
          autoGenerate,
          nextDueDate: autoGenerate ? nextDueDate : null,
          endDate: autoGenerate ? endDate || null : null,
        };

        const result = await createSubscription(input);

        if (result.success) {
          toast.success(translate("subscriptionCreated"));
          onOpenChange(false);
          if (result.subscription) {
            onSuccess?.(undefined, result.subscription);
          } else {
            onSuccess?.();
          }
        } else {
          toast.error(result.error || translate("failedToCreate"));
        }
      }
    } catch (error) {
      logger.error("Submit error", { error });
      toast.error(translate("anErrorOccurred"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {isEditMode
              ? translate("editSubscription")
              : isVerifyMode
                ? translate("verifySubscription")
                : translate("addSubscription")}
          </DialogTitle>
          <DialogDescription>
            {isEditMode
              ? translate("updateTheDetailsOfThisSubscription")
              : isVerifyMode
                ? translate(
                    "weDetectedThisRecurringPaymentPatternReviewAndConfirm",
                    { value1: suggestion?.matchCount || 0 },
                  )
                : translate(
                    "createANewSubscriptionToTrackRecurringPaymentsAnd",
                  )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto overflow-x-hidden py-4 pr-1">
            {/* Name */}
            <div className="grid gap-2">
              <Label htmlFor="name">
                {translate("name")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                placeholder={translate("eGNetflixRentGymMembership")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            {/* Merchant */}
            <div className="grid gap-2">
              <Label htmlFor="merchant">{translate("merchant")}</Label>
              <Input
                id="merchant"
                placeholder={translate("eGNetflixInc")}
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
              />
            </div>

            {/* Company Logo - only show if API key is configured */}
            {logoApiEnabled && (
              <div className="grid gap-2">
                <Label>{translate("companyLogo")}</Label>
                <div className="flex items-center gap-2">
                  {/* Current logo preview - size-9 matches input height */}
                  <div className="size-9 shrink-0">
                    <CompanyLogo
                      name={name || "Company"}
                      logoUrl={logoUrl}
                      className="!size-9"
                    />
                  </div>
                  <div className="flex-1 flex gap-2">
                    <Input
                      placeholder={translate("searchByDomainEGNetflixCom")}
                      value={logoSearch}
                      onChange={(e) => setLogoSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleLogoSearch(logoSearch || name);
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => handleLogoSearch(logoSearch || name)}
                      disabled={isSearchingLogo}
                    >
                      {isSearchingLogo ? (
                        <RiLoader4Line className="h-4 w-4 animate-spin" />
                      ) : (
                        <RiSearchLine className="h-4 w-4" />
                      )}
                    </Button>
                    {logoId && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={handleClearLogo}
                      >
                        <RiCloseLine className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {translate("searchForACompanyLogoByNameOrDomain")}
                </p>
              </div>
            )}

            {/* Amount */}
            <div className="grid gap-2">
              <Label htmlFor="amount">
                {isVariable
                  ? translate("estimatedAmount")
                  : translate("amount")}{" "}
                <span className="text-destructive">*</span>
              </Label>
              <Input
                id="amount"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(normalizeDecimalInput(e.target.value))}
                required
              />
            </div>

            {/* Variable amount */}
            <div className="flex items-center justify-between gap-2">
              <div className="grid gap-0.5">
                <Label htmlFor="isVariable">
                  {translate("variableAmount")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {translate(
                    "thisSubscriptionSAmountChangesEachBillingCycleEG",
                  )}
                </p>
              </div>
              <Switch
                id="isVariable"
                checked={isVariable}
                onCheckedChange={setIsVariable}
              />
            </div>

            {/* Account */}
            <div className="grid gap-2">
              <Label htmlFor="account">
                {translate("account85dfa3")}{" "}
                <span className="text-destructive">*</span>
              </Label>
              {isVerifyMode && suggestion?.accountId ? (
                <div className="flex h-8 items-center rounded-none border border-input px-2.5 text-xs">
                  {accounts.find((account) => account.id === accountId)?.name ||
                    suggestion.accountName ||
                    translate("detectedAccount")}
                </div>
              ) : (
                <AccountSelect
                  accounts={accounts}
                  value={accountId}
                  onChange={setAccountId}
                  placeholder={translate("selectAnAccount")}
                />
              )}
            </div>

            {/* Category */}
            <div className="grid gap-2">
              <Label htmlFor="category">{translate("category")}</Label>
              <CategorySelect
                categories={categories}
                value={categoryId}
                onChange={setCategoryId}
                noneLabel={translate("uncategorized")}
                placeholder={translate("selectACategory")}
                showSwatch={false}
              />
            </div>

            {/* Frequency */}
            <div className="grid gap-2">
              <Label htmlFor="frequency">
                {translate("frequency")}{" "}
                <span className="text-destructive">*</span>
              </Label>
              <Select
                value={frequency}
                onValueChange={(value) =>
                  setFrequency((value ?? "monthly") as SubscriptionFrequency)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {frequencyOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Auto-generate transactions on schedule */}
            {!isVerifyMode && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <div className="grid gap-0.5">
                    <Label htmlFor="autoGenerate">
                      {translate("autoCreateTransactions")}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {translate(
                        "automaticallyAddATransactionOnEachDueDate",
                      )}
                    </p>
                  </div>
                  <Switch
                    id="autoGenerate"
                    checked={autoGenerate}
                    onCheckedChange={setAutoGenerate}
                  />
                </div>

                {autoGenerate && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="nextDueDate">
                        {translate("nextDueDate")}{" "}
                        <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="nextDueDate"
                        type="date"
                        value={nextDueDate}
                        onChange={(e) => setNextDueDate(e.target.value)}
                        required={autoGenerate}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="endDate">
                        {translate("endDateOptional")}
                      </Label>
                      <Input
                        id="endDate"
                        type="date"
                        min={nextDueDate || undefined}
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Importance - 3 blocks */}
            <div className="grid gap-2">
              <Label>
                {translate("importance")}{" "}
                <span className="text-destructive">*</span>
              </Label>
              <div className="flex items-center gap-1">
                {Array.from({ length: 3 }).map((_, i) => {
                  const blockValue = i + 1;
                  const isSelected = blockValue <= importance;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setImportance(blockValue)}
                      className={`h-3 w-5 border transition-colors cursor-pointer hover:border-foreground ${
                        isSelected
                          ? "bg-foreground border-foreground"
                          : "bg-background border-border"
                      }`}
                    />
                  );
                })}
                <span className="ml-2 text-sm text-muted-foreground">
                  ({importance}/3)
                </span>
              </div>
            </div>

            {/* Description */}
            <div className="grid gap-2">
              <Label htmlFor="description">
                {translate("description55f8eb")}
              </Label>
              <Textarea
                id="description"
                placeholder={translate("optionalNotesAboutThisSubscription")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter className="mt-4 flex-col-reverse gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              {translate("cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? translate("saving") : translate("confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
