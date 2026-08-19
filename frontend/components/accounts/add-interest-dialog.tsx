"use client";
import { t as translate } from "@/i18n/translate";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { addInterestTransaction } from "@/lib/actions/transactions";

interface AddInterestDialogProps {
  accountId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddInterestDialog({
  accountId,
  open,
  onOpenChange,
}: AddInterestDialogProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [amount, setAmount] = useState<string>("");
  const [bookedAt, setBookedAt] = useState<Date>(new Date());
  const [description, setDescription] = useState<string>("");

  const resetForm = () => {
    setAmount("");
    setBookedAt(new Date());
    setDescription("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      toast.error(translate("pleaseEnterAValidAmount"));
      return;
    }

    setIsLoading(true);
    try {
      const result = await addInterestTransaction({
        accountId,
        amount: parsedAmount,
        bookedAt,
        description: description.trim() || undefined,
      });
      if (!result.success) {
        toast.error(result.error || translate("failedToAddInterest"));
        return;
      }
      toast.success(translate("interestAdded"));
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
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{translate("addInterest")}</DialogTitle>
          <DialogDescription>
            {translate("interestEarnedOnSavingsAccounts")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="interest-amount">{translate("amount")}</Label>
              <Input
                id="interest-amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
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
              <Label htmlFor="interest-description">
                {translate("noteOptional")}
              </Label>
              <Textarea
                id="interest-description"
                placeholder={translate("interestEarned")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
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
              {isLoading ? translate("adding") : translate("addInterest")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
