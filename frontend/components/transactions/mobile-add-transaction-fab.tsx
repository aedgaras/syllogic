"use client";
import { t as translate } from "@/i18n/translate";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RiAddLine, RiCameraLine, RiEditLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AddTransactionDialog } from "./add-transaction-dialog";

export function MobileAddTransactionFab() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="fixed bottom-6 right-6 z-50 md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon-lg"
              className="size-14 rounded-full shadow-lg"
              aria-label={translate("addTransaction")}
            >
              <RiAddLine className="size-6" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setOpen(true)}>
              <RiEditLine className="mr-2 h-4 w-4" />
              {translate("addManually83d9c9")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => router.push("/transactions/scan-receipt")}
            >
              <RiCameraLine className="mr-2 h-4 w-4" />
              {translate("scanReceipt")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <AddTransactionDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
