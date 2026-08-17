"use client";
import { t as translate } from "@/i18n/translate";

import { useState } from "react";
import { RiAddLine } from "@remixicon/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AccountForm } from "@/components/accounts/account-form";

interface AddAccountDialogProps {
  onAccountAdded?: () => void;
}

export function AddAccountDialog({ onAccountAdded }: AddAccountDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <RiAddLine className="mr-2 h-4 w-4" />
        {translate("addAccount")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{translate("addAccount")}</DialogTitle>
          <DialogDescription>
            {translate("createANewAccountToTrackYourFinances")}
          </DialogDescription>
        </DialogHeader>
        <AccountForm
          onSuccess={() => {
            setOpen(false);
            onAccountAdded?.();
          }}
          onCancel={() => setOpen(false)}
          submitLabel="Create Account"
          successMessage="Account created successfully"
        />
      </DialogContent>
    </Dialog>
  );
}
