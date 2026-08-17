"use client";
import { t as translate } from "@/i18n/translate";


import { useRouter } from "next/navigation";
import { RiAddLine, RiEditLine, RiUploadCloud2Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface AddTransactionButtonProps {
  onAddManual: () => void;
  allowCsvImport: boolean;
}

export function AddTransactionButton({
  onAddManual,
  allowCsvImport,
}: AddTransactionButtonProps) {
  const router = useRouter();

  const handleCsvImport = () => {
    router.push("/transactions/import");
  };

  // If CSV option is not available, show a simple button
  if (!allowCsvImport) {
    return (
      <Button onClick={onAddManual}>
        <RiAddLine className="mr-2 h-4 w-4" />
        {translate("addTransaction")}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button>
          <RiAddLine className="mr-2 h-4 w-4" />
          {translate("addTransaction")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onAddManual}>
          <RiEditLine className="mr-2 h-4 w-4" />
          {translate("addManually83d9c9")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleCsvImport}>
          <RiUploadCloud2Line className="mr-2 h-4 w-4" />
          {translate("importFromCsv")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
