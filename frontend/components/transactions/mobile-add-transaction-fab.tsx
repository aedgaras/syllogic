"use client";
import { t as translate } from "@/i18n/translate";

import { useState } from "react";
import { RiAddLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { AddTransactionDialog } from "./add-transaction-dialog";

export function MobileAddTransactionFab() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="fixed bottom-6 right-6 z-50 md:hidden">
        <Button
          type="button"
          size="icon-lg"
          className="size-14 rounded-full shadow-lg"
          aria-label={translate("addTransaction")}
          onClick={() => setOpen(true)}
        >
          <RiAddLine className="size-6" />
        </Button>
      </div>
      <AddTransactionDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
