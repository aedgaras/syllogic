"use client";
import { t as translate } from "@/i18n/translate";

import { RiArrowLeftLine, RiArrowRightLine } from "@remixicon/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Header } from "@/components/layout/header";
import { CsvUploadDropzone } from "@/components/transactions/csv-upload-dropzone";
import { useUploadController } from "@/features/csv-import/hooks/use-upload-controller";

export default function CsvImportPage() {
  const {
    accounts,
    selectedAccountId,
    setSelectedAccountId,
    selectedFile,
    isLoading,
    selectFile,
    continueToMapping,
    goBack,
  } = useUploadController("dashboard");

  return (
    <>
      <Header title={translate("importTransactions28eaf7")} />
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4 pt-0">
        <Card className="w-full max-w-2xl">
          <CardHeader>
            <CardTitle>{translate("importTransactions28eaf7")}</CardTitle>
            <CardDescription>
              {translate("uploadACsvOrExcelFileWithYourTransactions")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>{translate("selectAccount")}</Label>
              {accounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {translate("noAccountsFoundPleaseCreateAnAccountFirst")}
                </p>
              ) : (
                <Select
                  value={selectedAccountId}
                  onValueChange={(v) => v && setSelectedAccountId(v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={translate("selectAnAccount")}>
                      {accounts.find((a) => a.id === selectedAccountId)?.name ??
                        translate("selectAnAccount")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="w-auto min-w-[var(--anchor-width)] max-w-[90vw]">
                    {accounts.map((account) => (
                      <SelectItem
                        key={account.id}
                        value={account.id}
                        className="pr-10"
                      >
                        {account.name} ({account.currency})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2">
              <Label>{translate("uploadFile")}</Label>
              <CsvUploadDropzone
                onFileSelect={selectFile}
                isUploading={isLoading}
              />
            </div>
          </CardContent>
          <CardFooter className="justify-between">
            <Button type="button" variant="outline" onClick={goBack}>
              <RiArrowLeftLine className="mr-2 h-4 w-4" />
              {translate("cancel")}
            </Button>
            <Button
              onClick={continueToMapping}
              disabled={isLoading || !selectedFile || accounts.length === 0}
            >
              {isLoading ? translate("processing") : translate("continue")}
              <RiArrowRightLine className="ml-2 h-4 w-4" />
            </Button>
          </CardFooter>
        </Card>
      </div>
    </>
  );
}
