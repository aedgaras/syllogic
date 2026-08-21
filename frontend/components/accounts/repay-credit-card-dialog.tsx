"use client";
import { t as translate } from "@/i18n/translate";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RiAddLine, RiCloseLine } from "@remixicon/react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn, normalizeDecimalInput } from "@/lib/utils";
import { format } from "date-fns";
import { getUserAccounts, repayCreditCard } from "@/lib/actions/transactions";

interface Account {
  id: string;
  name: string;
  institution: string | null;
  accountType: string;
  currency: string | null;
}

interface SourceRow {
  key: number;
  accountId: string;
  amount: string;
}

interface RepayCreditCardDialogProps {
  creditCardAccountId: string;
  currency: string;
  outstandingBalance: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

let nextRowKey = 0;

function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "EUR",
  }).format(value);
}

export function RepayCreditCardDialog({
  creditCardAccountId,
  currency,
  outstandingBalance,
  open,
  onOpenChange,
}: RepayCreditCardDialogProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [totalAmount, setTotalAmount] = useState<string>("");
  const [bookedAt, setBookedAt] = useState<Date>(new Date());
  const [description, setDescription] = useState<string>("Credit card payment");
  const [sources, setSources] = useState<SourceRow[]>([
    { key: nextRowKey++, accountId: "", amount: "" },
  ]);

  useEffect(() => {
    if (open) {
      getUserAccounts().then((accountsData) => {
        setAccounts(
          accountsData.filter(
            (account) =>
              account.id !== creditCardAccountId &&
              (account.currency || "EUR") === (currency || "EUR"),
          ),
        );
      });
    }
  }, [open, creditCardAccountId, currency]);

  const resetForm = () => {
    setTotalAmount("");
    setBookedAt(new Date());
    setDescription("Credit card payment");
    setSources([{ key: nextRowKey++, accountId: "", amount: "" }]);
  };

  const allocated = sources.reduce(
    (sum, source) => sum + (parseFloat(source.amount) || 0),
    0,
  );
  const target = parseFloat(totalAmount) || 0;
  const remaining = Math.round((target - allocated) * 100) / 100;

  const updateSource = (key: number, patch: Partial<SourceRow>) => {
    setSources((rows) =>
      rows.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  };

  const addSourceRow = () => {
    setSources((rows) => [...rows, { key: nextRowKey++, accountId: "", amount: "" }]);
  };

  const removeSourceRow = (key: number) => {
    setSources((rows) => rows.filter((row) => row.key !== key));
  };

  const usedAccountIds = new Set(sources.map((row) => row.accountId).filter(Boolean));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const parsedTotal = parseFloat(totalAmount);
    if (isNaN(parsedTotal) || parsedTotal <= 0) {
      toast.error(translate("pleaseEnterAValidAmount"));
      return;
    }
    if (!description.trim()) {
      toast.error(translate("pleaseEnterADescription"));
      return;
    }
    if (sources.some((row) => !row.accountId)) {
      toast.error(translate("pleaseSelectAnAccount"));
      return;
    }
    const accountIds = sources.map((row) => row.accountId);
    if (new Set(accountIds).size !== accountIds.length) {
      toast.error(translate("eachSourceAccountCanOnlyBeUsedOnce"));
      return;
    }
    for (const row of sources) {
      const amount = parseFloat(row.amount);
      if (isNaN(amount) || amount <= 0) {
        toast.error(translate("pleaseEnterAValidAmount"));
        return;
      }
    }
    if (remaining !== 0) {
      toast.error(translate("sourceAmountsMustAddUpToTheTotalAmount"));
      return;
    }

    setIsLoading(true);
    try {
      const result = await repayCreditCard({
        creditCardAccountId,
        sources: sources.map((row) => ({
          sourceAccountId: row.accountId,
          amount: parseFloat(row.amount),
        })),
        description: description.trim(),
        bookedAt,
      });
      if (!result.success) {
        toast.error(result.error || translate("failedToRepayCreditCard"));
        return;
      }
      toast.success(translate("paymentRecorded"));
      resetForm();
      onOpenChange(false);
      router.refresh();
    } catch {
      toast.error(translate("anErrorOccurredPleaseTryAgain"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{translate("repayCreditCard")}</DialogTitle>
          <DialogDescription>
            {translate("payDownYourCreditCardBalanceFromOneOrMoreAccounts")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="repay-amount">{translate("amount")}</Label>
              <div className="flex gap-2">
                <Input
                  id="repay-amount"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(normalizeDecimalInput(e.target.value))}
                />
                {outstandingBalance > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setTotalAmount(outstandingBalance.toFixed(2))}
                  >
                    {translate("payFullBalance")}
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>{translate("fromAccount")}</Label>
              <div className="space-y-2">
                {sources.map((row) => (
                  <div key={row.key} className="flex gap-2">
                    <Select
                      value={row.accountId}
                      onValueChange={(value) =>
                        value && updateSource(row.key, { accountId: value })
                      }
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder={translate("selectAnAccount")} />
                      </SelectTrigger>
                      <SelectContent>
                        {accounts.map((account) => (
                          <SelectItem
                            key={account.id}
                            value={account.id}
                            disabled={
                              usedAccountIds.has(account.id) &&
                              account.id !== row.accountId
                            }
                          >
                            {account.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      className="w-28"
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={row.amount}
                      onChange={(e) =>
                        updateSource(row.key, {
                          amount: normalizeDecimalInput(e.target.value),
                        })
                      }
                    />
                    {sources.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeSourceRow(row.key)}
                      >
                        <RiCloseLine className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addSourceRow}>
                <RiAddLine className="mr-2 h-4 w-4" />
                {translate("addAnotherAccount")}
              </Button>
              {target > 0 && (
                <p
                  className={cn(
                    "text-xs",
                    remaining === 0 ? "text-muted-foreground" : "text-destructive",
                  )}
                >
                  {translate("remainingToAllocate", {
                    value1: formatCurrency(remaining, currency),
                  })}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>{translate("date")}</Label>
              <Popover>
                <PopoverTrigger
                  render={
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !bookedAt && "text-muted-foreground",
                      )}
                    >
                      {bookedAt ? format(bookedAt, "PPP") : translate("pickADate")}
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

            <div className="space-y-2">
              <Label htmlFor="repay-description">{translate("description55f8eb")}</Label>
              <Input
                id="repay-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              {translate("cancel")}
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? translate("repaying") : translate("repay")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
