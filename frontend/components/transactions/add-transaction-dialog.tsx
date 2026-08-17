"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RiArrowDownLine, RiArrowUpLine, RiExchangeLine } from "@remixicon/react";
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
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import {
  createTransaction,
  createTransferTransaction,
  getUserAccounts,
  updateTransaction,
  type TransactionWithRelations,
} from "@/lib/actions/transactions";
import { getUserCategories } from "@/lib/actions/categories";
type Account = { id: string; name: string; institution: string | null; accountType: string; currency: string | null };
import type { CategoryDisplay } from "@/types";
import { getCategoriesForTransactionType } from "@/lib/utils/category-utils";

interface AddTransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories?: CategoryDisplay[];
  transaction?: TransactionWithRelations | null;
  onTransactionUpdated?: (
    id: string,
    updates: Partial<TransactionWithRelations>
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
  const [transactionType, setTransactionType] = useState<"debit" | "credit" | "transfer">("debit");
  const [accountId, setAccountId] = useState<string>("");
  const [destinationAccountId, setDestinationAccountId] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [bookedAt, setBookedAt] = useState<Date>(new Date());
  const [merchant, setMerchant] = useState<string>("");

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
              transaction.internalTransfer.sourceAccount?.id || transaction.accountId
            );
            setDestinationAccountId(
              transaction.internalTransfer.pocketAccount?.id || transaction.accountId
            );
          } else {
            setTransactionType(transaction.transactionType === "credit" ? "credit" : "debit");
            setAccountId(transaction.accountId);
            setDestinationAccountId("");
          }
          setAmount(Math.abs(transaction.amount).toFixed(2));
          setDescription(transaction.description || "");
          setCategoryId(transaction.categoryId || "");
          setBookedAt(new Date(transaction.bookedAt));
          setMerchant(transaction.merchant || "");
        } else if (accountsData.length > 0) {
          setAccountId((currentAccountId) => currentAccountId || accountsData[0].id);
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
  };

  const handleTransactionTypeChange = (nextType: "debit" | "credit" | "transfer") => {
    setTransactionType(nextType);
    if (nextType === "transfer") {
      setCategoryId("");
      return;
    }
    if (categoryId) {
      const nextCategories = getCategoriesForTransactionType(categories, nextType);
      if (!nextCategories.some((category) => category.id === categoryId)) {
        setCategoryId("");
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!accountId) {
      toast.error("Please select an account");
      return;
    }

    if (transactionType === "transfer" && !destinationAccountId) {
      toast.error("Please select a destination account");
      return;
    }
    if (transactionType === "transfer" && accountId === destinationAccountId) {
      toast.error("Source and destination accounts must be different");
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    if (!description.trim()) {
      toast.error("Please enter a description");
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
          toast.error(result.error || "Failed to create transfer");
          return;
        }
        toast.success("Transfer created");
        resetForm();
        onOpenChange(false);
        router.refresh();
        return;
      }

      const standardTransactionType = transactionType === "transfer" ? "debit" : transactionType;
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
          const selectedAccount = accounts.find((account) => account.id === accountId);
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
                  logo: selectedAccount.id === transaction.account?.id
                    ? transaction.account.logo
                    : null,
                }
              : transaction.account,
            amount: standardTransactionType === "debit" ? -parsedAmount : parsedAmount,
            currency: selectedAccount?.currency || transaction.currency,
            description: description.trim(),
            merchant: merchant.trim() || null,
            categoryId: categoryId || null,
            category: selectedCategory,
            bookedAt,
            transactionType: standardTransactionType,
          });
          toast.success("Transaction updated");
        } else {
          toast.success("Transaction added");
          resetForm();
        }
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(result.error || `Failed to ${isEditing ? "update" : "add"} transaction`);
      }
    } catch {
      toast.error("An error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // Filter categories based on transaction type
  const filteredCategories = getCategoriesForTransactionType(
    categories,
    transactionType === "transfer" ? "debit" : transactionType
  );
  const selectedAccount = accounts.find((account) => account.id === accountId);
  const eligibleDestinationAccounts = selectedAccount
    ? accounts.filter(
        (account) =>
          account.id !== accountId &&
          (account.currency || "EUR") === (selectedAccount.currency || "EUR")
      )
    : [];
  const selectedDestinationAccount = accounts.find(
    (account) => account.id === destinationAccountId
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {isLinkedTransfer ? "Transfer Details" : isEditing ? "Edit Transaction" : "Add Transaction"}
          </DialogTitle>
          <DialogDescription>
            {isLinkedTransfer
              ? "View the linked entries for this account transfer."
              : isEditing
              ? "Update the details for your transaction."
              : "Enter the details for your transaction."}
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
                Expense
              </Button>
              <Button
                type="button"
                variant={transactionType === "credit" ? "default" : "outline"}
                className="flex-1"
                disabled={isLinkedTransfer}
                onClick={() => handleTransactionTypeChange("credit")}
              >
                <RiArrowUpLine className="mr-2 h-4 w-4" />
                Income
              </Button>
              {(!isEditing || isLinkedTransfer) && (
                <Button
                  type="button"
                  variant={transactionType === "transfer" ? "default" : "outline"}
                  className="flex-1"
                  disabled={isLinkedTransfer}
                  onClick={() => handleTransactionTypeChange("transfer")}
                >
                  <RiExchangeLine className="mr-2 h-4 w-4" />
                  Transfer
                </Button>
              )}
            </div>

            {/* Account Select */}
            <div className="space-y-2">
              <Label htmlFor="account">
                {transactionType === "transfer" ? "From account" : "Account"}
              </Label>
              {accounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No accounts found. Please create an account first.
                </p>
              ) : (
                <Select
                  value={accountId}
                  disabled={isLinkedTransfer}
                  onValueChange={(value) => {
                    if (!value) return;
                    setAccountId(value);
                    const nextSource = accounts.find((account) => account.id === value);
                    const currentDestination = accounts.find(
                      (account) => account.id === destinationAccountId
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
                    <SelectValue placeholder="Select an account">
                      {selectedAccount
                        ? `${selectedAccount.name}${selectedAccount.currency ? ` (${selectedAccount.currency})` : ""}`
                        : "Select an account"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="w-auto min-w-[var(--anchor-width)] max-w-[90vw]">
                    {accounts.map((account) => (
                      <SelectItem key={account.id} value={account.id} className="pr-10">
                        {account.name}{account.currency ? ` (${account.currency})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {transactionType === "transfer" && (
              <div className="space-y-2">
                <Label htmlFor="destination-account">To account</Label>
                <Select
                  value={destinationAccountId}
                  disabled={isLinkedTransfer}
                  onValueChange={(value) => value && setDestinationAccountId(value)}
                >
                  <SelectTrigger id="destination-account" className="w-full">
                    <SelectValue placeholder="Select a destination account">
                      {selectedDestinationAccount
                        ? `${selectedDestinationAccount.name}${selectedDestinationAccount.currency ? ` (${selectedDestinationAccount.currency})` : ""}`
                        : "Select a destination account"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="w-auto min-w-[var(--anchor-width)] max-w-[90vw]">
                    {eligibleDestinationAccounts.map((account) => (
                      <SelectItem key={account.id} value={account.id} className="pr-10">
                        {account.name}{account.currency ? ` (${account.currency})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedAccount && eligibleDestinationAccounts.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Add another {selectedAccount.currency || "same-currency"} account to make a transfer.
                  </p>
                )}
              </div>
            )}

            {/* Amount */}
            <div className="space-y-2">
              <Label htmlFor="amount">Amount</Label>
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
              <Label>Date</Label>
              <Popover>
                <PopoverTrigger
                  render={
                    <Button
                      variant="outline"
                      disabled={isLinkedTransfer}
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !bookedAt && "text-muted-foreground"
                      )}
                    >
                      {bookedAt ? format(bookedAt, "PPP") : "Pick a date"}
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
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder={
                  transactionType === "transfer"
                    ? "e.g., Move money to savings"
                    : "Enter a description"
                }
                value={description}
                disabled={isLinkedTransfer}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>

            {/* Merchant (optional) */}
            {transactionType !== "transfer" && <div className="space-y-2">
              <Label htmlFor="merchant">Merchant (optional)</Label>
              <Input
                id="merchant"
                placeholder="e.g., Amazon, Starbucks"
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
              />
            </div>}

            {/* Category */}
            {transactionType !== "transfer" && <div className="space-y-2">
              <Label htmlFor="category">Category (optional)</Label>
              <Select value={categoryId} onValueChange={(v) => setCategoryId(v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No category</SelectItem>
                  {filteredCategories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      <div className="flex items-center gap-2">
                        <div
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: category.color || "#666" }}
                        />
                        {category.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>}
          </div>
          <DialogFooter>
            {isLinkedTransfer && (
              <p className="mr-auto text-sm text-muted-foreground">
                Linked transfers cannot be edited independently.
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              {isLinkedTransfer ? "Close" : "Cancel"}
            </Button>
            {!isLinkedTransfer && <Button
              type="submit"
              disabled={
                isLoading ||
                accounts.length === 0 ||
                (transactionType === "transfer" && eligibleDestinationAccounts.length === 0)
              }
            >
              {isLoading
                ? isEditing ? "Saving..." : "Adding..."
                : isEditing ? "Save Changes" : transactionType === "transfer" ? "Create Transfer" : "Add Transaction"}
            </Button>}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
