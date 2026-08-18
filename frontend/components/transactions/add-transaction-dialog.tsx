"use client";
import { t as translate } from "@/i18n/translate";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  RiArrowDownLine,
  RiArrowUpLine,
  RiExchangeLine,
} from "@remixicon/react";
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { SubscriptionDetectionDialog } from "./subscription-detection-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import {
  convertTransactionToTransfer,
  createTransaction,
  createTransferTransaction,
  getUserAccounts,
  updateTransaction,
} from "@/lib/actions/transactions";
import type { TransactionWithRelations } from "@/features/transactions/public";
import { getUserCategories } from "@/lib/actions/categories";
type Account = {
  id: string;
  name: string;
  institution: string | null;
  accountType: string;
  currency: string | null;
};
import type { CategoryDisplay } from "@/shared/domain/display-contracts";
import { getCategoriesForTransactionType } from "@/lib/utils/category-utils";

interface AddTransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories?: CategoryDisplay[];
  transaction?: TransactionWithRelations | null;
  onTransactionUpdated?: (
    id: string,
    updates: Partial<TransactionWithRelations>,
  ) => void;
}

export function AddTransactionDialog({
  open,
  onOpenChange,
  categories: propCategories,
  transaction,
  onTransactionUpdated,
}: AddTransactionDialogProps) {
  const router = useRouter();
  const isEditing = Boolean(transaction);
  const isLinkedTransfer = Boolean(transaction?.internalTransferId);
  const [isLoading, setIsLoading] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<CategoryDisplay[]>([]);

  // Form state
  const [transactionType, setTransactionType] = useState<
    "debit" | "credit" | "transfer"
  >("debit");
  const [accountId, setAccountId] = useState<string>("");
  const [destinationAccountId, setDestinationAccountId] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [bookedAt, setBookedAt] = useState<Date>(new Date());
  const [merchant, setMerchant] = useState<string>("");
  const [markAsRecurring, setMarkAsRecurring] = useState(false);
  const [pendingRecurringTransaction, setPendingRecurringTransaction] =
    useState<{ id: string; categoryId: string | null } | null>(null);

  useEffect(() => {
    if (open) {
      const loadData = async () => {
        const accountsData = await getUserAccounts();
        setAccounts(accountsData);

        // Use prop categories if available, otherwise fetch
        if (propCategories && propCategories.length > 0) {
          setCategories(propCategories);
        } else {
          const categoriesData = await getUserCategories();
          setCategories(categoriesData);
        }

        if (transaction) {
          if (transaction.internalTransfer) {
            setTransactionType("transfer");
            setAccountId(
              transaction.internalTransfer.sourceAccount?.id ||
                transaction.accountId,
            );
            setDestinationAccountId(
              transaction.internalTransfer.pocketAccount?.id ||
                transaction.accountId,
            );
          } else {
            setTransactionType(
              transaction.transactionType === "credit" ? "credit" : "debit",
            );
            setAccountId(transaction.accountId);
            setDestinationAccountId("");
          }
          setAmount(Math.abs(transaction.amount).toFixed(2));
          setDescription(transaction.description || "");
          setCategoryId(transaction.categoryId || "");
          setBookedAt(new Date(transaction.bookedAt));
          setMerchant(transaction.merchant || "");
        } else if (accountsData.length > 0) {
          setAccountId(
            (currentAccountId) => currentAccountId || accountsData[0].id,
          );
        }
      };
      loadData();
    }
  }, [open, propCategories, transaction]);

  const resetForm = () => {
    setTransactionType("debit");
    setDestinationAccountId("");
    setAmount("");
    setDescription("");
    setCategoryId("");
    setBookedAt(new Date());
    setMerchant("");
    setMarkAsRecurring(false);
  };

  const handleTransactionTypeChange = (
    nextType: "debit" | "credit" | "transfer",
  ) => {
    setTransactionType(nextType);
    if (nextType === "transfer") {
      setCategoryId("");
      return;
    }
    if (categoryId) {
      const nextCategories = getCategoriesForTransactionType(
        categories,
        nextType,
      );
      if (!nextCategories.some((category) => category.id === categoryId)) {
        setCategoryId("");
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!accountId) {
      toast.error(translate("pleaseSelectAnAccount"));
      return;
    }

    if (transactionType === "transfer" && !destinationAccountId) {
      toast.error(translate("pleaseSelectADestinationAccount"));
      return;
    }
    if (transactionType === "transfer" && accountId === destinationAccountId) {
      toast.error(translate("sourceAndDestinationAccountsMustBeDifferent"));
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      toast.error(translate("pleaseEnterAValidAmount"));
      return;
    }

    if (!description.trim()) {
      toast.error(translate("pleaseEnterADescription"));
      return;
    }

    setIsLoading(true);

    try {
      if (transactionType === "transfer" && !transaction) {
        const result = await createTransferTransaction({
          sourceAccountId: accountId,
          destinationAccountId,
          amount: parsedAmount,
          description: description.trim(),
          bookedAt,
        });
        if (!result.success) {
          toast.error(result.error || translate("failedToCreateTransfer"));
          return;
        }
        toast.success(translate("transferCreated"));
        resetForm();
        onOpenChange(false);
        router.refresh();
        return;
      }

      if (transactionType === "transfer" && transaction) {
        const result = await convertTransactionToTransfer({
          transactionId: transaction.id,
          sourceAccountId: accountId,
          destinationAccountId,
          amount: parsedAmount,
          description: description.trim(),
          bookedAt,
        });
        if (!result.success) {
          toast.error(
            result.error || translate("failedToConvertTransactionToTransfer"),
          );
          return;
        }
        toast.success(translate("transactionConvertedToTransfer"));
        onOpenChange(false);
        router.refresh();
        return;
      }

      const standardTransactionType =
        transactionType === "transfer" ? "debit" : transactionType;
      const transactionInput = {
        accountId,
        amount: parsedAmount,
        description: description.trim(),
        categoryId: categoryId || null,
        bookedAt,
        transactionType: standardTransactionType,
        merchant: merchant.trim() || undefined,
      };
      const result = transaction
        ? await updateTransaction({
            ...transactionInput,
            transactionId: transaction.id,
          })
        : await createTransaction({
            ...transactionInput,
            categoryId: transactionInput.categoryId || undefined,
          });

      if (result.success) {
        if (transaction) {
          const selectedAccount = accounts.find(
            (account) => account.id === accountId,
          );
          const selectedCategory = categoryId
            ? categories.find((category) => category.id === categoryId) || null
            : null;
          onTransactionUpdated?.(transaction.id, {
            accountId,
            account: selectedAccount
              ? {
                  id: selectedAccount.id,
                  name: selectedAccount.name,
                  institution: selectedAccount.institution,
                  accountType: selectedAccount.accountType,
                  logo:
                    selectedAccount.id === transaction.account?.id
                      ? transaction.account.logo
                      : null,
                }
              : transaction.account,
            amount:
              standardTransactionType === "debit"
                ? -parsedAmount
                : parsedAmount,
            currency: selectedAccount?.currency || transaction.currency,
            description: description.trim(),
            merchant: merchant.trim() || null,
            categoryId: categoryId || null,
            category: selectedCategory,
            bookedAt,
            transactionType: standardTransactionType,
          });
          toast.success(translate("transactionUpdated"));
        } else {
          toast.success(translate("transactionAdded"));
          // Not editing, so `result` came from createTransaction() and carries transactionId.
          const newTransactionId = (result as { transactionId?: string })
            .transactionId;
          if (markAsRecurring && newTransactionId) {
            setPendingRecurringTransaction({
              id: newTransactionId,
              categoryId: categoryId || null,
            });
          }
          resetForm();
        }
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(
          result.error ||
            translate("failedToTransaction", {
              value1: isEditing ? "update" : "add",
            }),
        );
      }
    } catch {
      toast.error(translate("anErrorOccurredPleaseTryAgain"));
    } finally {
      setIsLoading(false);
    }
  };

  // Filter categories based on transaction type
  const filteredCategories = getCategoriesForTransactionType(
    categories,
    transactionType === "transfer" ? "debit" : transactionType,
  );
  const selectedAccount = accounts.find((account) => account.id === accountId);
  const eligibleDestinationAccounts = selectedAccount
    ? accounts.filter(
        (account) =>
          account.id !== accountId &&
          (account.currency || "EUR") === (selectedAccount.currency || "EUR"),
      )
    : [];
  const selectedDestinationAccount = accounts.find(
    (account) => account.id === destinationAccountId,
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {isLinkedTransfer
                ? translate("transferDetails")
                : isEditing
                  ? translate("editTransaction")
                  : translate("addTransaction")}
            </DialogTitle>
            <DialogDescription>
              {isLinkedTransfer
                ? translate("viewTheLinkedEntriesForThisAccountTransfer")
                : isEditing
                  ? translate("updateTheDetailsForYourTransaction")
                  : translate("enterTheDetailsForYourTransaction")}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="grid gap-4 py-4">
              {/* Transaction Type Toggle */}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={transactionType === "debit" ? "default" : "outline"}
                  className="flex-1"
                  disabled={isLinkedTransfer}
                  onClick={() => handleTransactionTypeChange("debit")}
                >
                  <RiArrowDownLine className="mr-2 h-4 w-4" />
                  {translate("expense")}
                </Button>
                <Button
                  type="button"
                  variant={transactionType === "credit" ? "default" : "outline"}
                  className="flex-1"
                  disabled={isLinkedTransfer}
                  onClick={() => handleTransactionTypeChange("credit")}
                >
                  <RiArrowUpLine className="mr-2 h-4 w-4" />
                  {translate("income1c89b1")}
                </Button>
                <Button
                  type="button"
                  variant={
                    transactionType === "transfer" ? "default" : "outline"
                  }
                  className="flex-1"
                  disabled={isLinkedTransfer}
                  onClick={() => handleTransactionTypeChange("transfer")}
                >
                  <RiExchangeLine className="mr-2 h-4 w-4" />
                  {translate("transfer")}
                </Button>
              </div>

              {/* Account Select */}
              <div className="space-y-2">
                <Label htmlFor="account">
                  {transactionType === "transfer"
                    ? translate("fromAccount")
                    : translate("account85dfa3")}
                </Label>
                {accounts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {translate("noAccountsFoundPleaseCreateAnAccountFirst")}
                  </p>
                ) : (
                  <Select
                    value={accountId}
                    disabled={isLinkedTransfer}
                    onValueChange={(value) => {
                      if (!value) return;
                      setAccountId(value);
                      const nextSource = accounts.find(
                        (account) => account.id === value,
                      );
                      const currentDestination = accounts.find(
                        (account) => account.id === destinationAccountId,
                      );
                      if (
                        value === destinationAccountId ||
                        (nextSource?.currency || "EUR") !==
                          (currentDestination?.currency || "EUR")
                      ) {
                        setDestinationAccountId("");
                      }
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={translate("selectAnAccount")}>
                        {selectedAccount
                          ? translate("message50844f", {
                              value1: selectedAccount.name,
                              value2: selectedAccount.currency
                                ? ` (${selectedAccount.currency})`
                                : "",
                            })
                          : translate("selectAnAccount")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="w-auto min-w-[var(--anchor-width)] max-w-[90vw]">
                      {accounts.map((account) => (
                        <SelectItem
                          key={account.id}
                          value={account.id}
                          className="pr-10"
                        >
                          {account.name}
                          {account.currency
                            ? translate("messagecd176d", {
                                value1: account.currency,
                              })
                            : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {transactionType === "transfer" && (
                <div className="space-y-2">
                  <Label htmlFor="destination-account">
                    {translate("toAccount")}
                  </Label>
                  <Select
                    value={destinationAccountId}
                    disabled={isLinkedTransfer}
                    onValueChange={(value) =>
                      value && setDestinationAccountId(value)
                    }
                  >
                    <SelectTrigger id="destination-account" className="w-full">
                      <SelectValue
                        placeholder={translate("selectADestinationAccount")}
                      >
                        {selectedDestinationAccount
                          ? translate("message50844f", {
                              value1: selectedDestinationAccount.name,
                              value2: selectedDestinationAccount.currency
                                ? ` (${selectedDestinationAccount.currency})`
                                : "",
                            })
                          : translate("selectADestinationAccount")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="w-auto min-w-[var(--anchor-width)] max-w-[90vw]">
                      {eligibleDestinationAccounts.map((account) => (
                        <SelectItem
                          key={account.id}
                          value={account.id}
                          className="pr-10"
                        >
                          {account.name}
                          {account.currency
                            ? translate("messagecd176d", {
                                value1: account.currency,
                              })
                            : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedAccount &&
                    eligibleDestinationAccounts.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        {translate("addAnother")}{" "}
                        {selectedAccount.currency || translate("sameCurrency")}{" "}
                        {translate("accountToMakeATransfer")}
                      </p>
                    )}
                </div>
              )}

              {/* Amount */}
              <div className="space-y-2">
                <Label htmlFor="amount">{translate("amount")}</Label>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={amount}
                  disabled={isLinkedTransfer}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>

              {/* Date */}
              <div className="space-y-2">
                <Label>{translate("date")}</Label>
                <Popover>
                  <PopoverTrigger
                    render={
                      <Button
                        variant="outline"
                        disabled={isLinkedTransfer}
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !bookedAt && "text-muted-foreground",
                        )}
                      >
                        {bookedAt
                          ? format(bookedAt, "PPP")
                          : translate("pickADate")}
                      </Button>
                    }
                  />
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={bookedAt}
                      onSelect={(date) => date && setBookedAt(date)}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="description">
                  {translate("description55f8eb")}
                </Label>
                <Textarea
                  id="description"
                  placeholder={
                    transactionType === "transfer"
                      ? translate("eGMoveMoneyToSavings")
                      : translate("enterADescription")
                  }
                  value={description}
                  disabled={isLinkedTransfer}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
              </div>

              {/* Merchant (optional) */}
              {transactionType !== "transfer" && (
                <div className="space-y-2">
                  <Label htmlFor="merchant">
                    {translate("merchantOptional")}
                  </Label>
                  <Input
                    id="merchant"
                    placeholder={translate("eGAmazonStarbucks")}
                    value={merchant}
                    onChange={(e) => setMerchant(e.target.value)}
                  />
                </div>
              )}

              {/* Category */}
              {transactionType !== "transfer" && (
                <div className="space-y-2">
                  <Label htmlFor="category">
                    {translate("categoryOptional")}
                  </Label>
                  <Select
                    value={categoryId}
                    onValueChange={(v) => setCategoryId(v ?? "")}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={translate("selectACategory")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">
                        {translate("noCategory")}
                      </SelectItem>
                      {filteredCategories.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          <div className="flex items-center gap-2">
                            <div
                              className="h-3 w-3 rounded-full"
                              style={{
                                backgroundColor: category.color || "#666",
                              }}
                            />
                            {category.name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Make recurring */}
              {!isEditing && transactionType !== "transfer" && (
                <div className="flex items-center justify-between gap-2">
                  <div className="grid gap-0.5">
                    <Label htmlFor="mark-as-recurring">
                      {translate("makeThisRecurring")}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {translate(
                        "setUpAsASubscriptionAfterSavingSoItSTrackedGoingForward",
                      )}
                    </p>
                  </div>
                  <Switch
                    id="mark-as-recurring"
                    checked={markAsRecurring}
                    onCheckedChange={setMarkAsRecurring}
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              {isLinkedTransfer && (
                <p className="mr-auto text-sm text-muted-foreground">
                  {translate("linkedTransfersCannotBeEditedIndependently")}
                </p>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isLoading}
              >
                {isLinkedTransfer ? translate("close") : translate("cancel")}
              </Button>
              {!isLinkedTransfer && (
                <Button
                  type="submit"
                  disabled={
                    isLoading ||
                    accounts.length === 0 ||
                    (transactionType === "transfer" &&
                      eligibleDestinationAccounts.length === 0)
                  }
                >
                  {isLoading
                    ? isEditing
                      ? translate("saving")
                      : translate("adding")
                    : transactionType === "transfer"
                      ? isEditing
                        ? translate("convertToTransfer")
                        : translate("createTransfer")
                      : isEditing
                        ? translate("saveChangesfa2984")
                        : translate("addTransaction")}
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {pendingRecurringTransaction && (
        <SubscriptionDetectionDialog
          transaction={pendingRecurringTransaction}
          open={true}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setPendingRecurringTransaction(null);
          }}
          onSuccess={() => {
            setPendingRecurringTransaction(null);
            router.refresh();
          }}
          categories={categories}
        />
      )}
    </>
  );
}
