"use client";
import { t as translate } from "@/i18n/translate";

import {
  RiAddLine,
  RiArrowLeftLine,
  RiArrowRightLine,
  RiDeleteBinLine,
  RiScissorsCutLine,
} from "@remixicon/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Header } from "@/components/layout/header";
import { ReceiptUploadDropzone } from "@/components/transactions/receipt-upload-dropzone";
import { useReceiptScanController } from "../hooks/use-receipt-scan-controller";

export default function ReceiptScanScreen() {
  const {
    accounts,
    categories,
    selectedAccountId,
    setSelectedAccountId,
    step,
    selectedFile,
    previewUrl,
    isUploading,
    isSubmitting,
    selectFile,
    clearFile,
    extract,
    merchantName,
    receiptTotal,
    items,
    itemsTotal,
    updateItem,
    removeItem,
    splitItem,
    addBlankItem,
    confirm,
    goBack,
  } = useReceiptScanController();

  const detectedTotal = receiptTotal ? Number(receiptTotal) : null;
  const totalMismatch =
    detectedTotal !== null && Math.abs(detectedTotal - itemsTotal) > 0.01;

  if (step === "upload") {
    return (
      <>
        <Header title={translate("scanReceipt")} />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4 pt-0">
          <Card className="w-full max-w-2xl">
            <CardHeader>
              <CardTitle>{translate("scanReceipt")}</CardTitle>
              <CardDescription>
                {translate("uploadAPhotoOfYourReceiptToSplitTransactions")}
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
                        {accounts.find((a) => a.id === selectedAccountId)
                          ?.name ?? translate("selectAnAccount")}
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
                <Label>{translate("receiptPhoto")}</Label>
                <ReceiptUploadDropzone
                  onFileSelect={selectFile}
                  onClear={clearFile}
                  previewUrl={previewUrl}
                  selectedFile={selectedFile}
                  isUploading={isUploading}
                />
              </div>
            </CardContent>
            <CardFooter className="justify-between">
              <Button type="button" variant="outline" onClick={goBack}>
                <RiArrowLeftLine className="mr-2 h-4 w-4" />
                {translate("cancel")}
              </Button>
              <Button
                onClick={extract}
                disabled={isUploading || !selectedFile || accounts.length === 0}
              >
                {isUploading ? translate("processing") : translate("continue")}
                <RiArrowRightLine className="ml-2 h-4 w-4" />
              </Button>
            </CardFooter>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title={translate("reviewReceiptItems")} />
      <div className="flex flex-1 flex-col items-center gap-4 p-4 pt-0">
        <Card className="w-full max-w-3xl">
          <CardHeader>
            <CardTitle>{translate("reviewReceiptItems")}</CardTitle>
            <CardDescription>
              {merchantName
                ? translate("editTheItemsDetectedAtMerchant", {
                    merchant: merchantName,
                  })
                : translate("editTheDetectedItemsSplitOrAdjustAsNeeded")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              {items.map((item) => (
                <div
                  key={item.key}
                  className="grid grid-cols-1 gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_120px_1fr_auto]"
                >
                  <Input
                    aria-label={translate("description55f8eb")}
                    placeholder={translate("description55f8eb")}
                    value={item.description}
                    onChange={(e) =>
                      updateItem(item.key, { description: e.target.value })
                    }
                  />
                  <Input
                    aria-label={translate("amount")}
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    placeholder="0.00"
                    value={item.amount}
                    onChange={(e) =>
                      updateItem(item.key, { amount: e.target.value })
                    }
                  />
                  <Select
                    value={item.categoryId ?? ""}
                    onValueChange={(v) =>
                      updateItem(item.key, {
                        categoryId: v || null,
                        categoryName:
                          categories.find((c) => c.id === v)?.name ?? null,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={translate("selectACategory")}>
                        {item.categoryId
                          ? (categories.find((c) => c.id === item.categoryId)
                              ?.name ?? translate("noCategory"))
                          : translate("noCategory")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">
                        {translate("noCategory")}
                      </SelectItem>
                      {categories.map((category) => (
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
                  <div className="flex items-center gap-1 justify-self-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title={translate("splitThisItem")}
                      onClick={() => splitItem(item.key)}
                    >
                      <RiScissorsCutLine className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title={translate("removeThisItem")}
                      onClick={() => removeItem(item.key)}
                      disabled={items.length === 1}
                    >
                      <RiDeleteBinLine className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addBlankItem}
            >
              <RiAddLine className="mr-2 h-4 w-4" />
              {translate("addItem")}
            </Button>

            <div
              className={`rounded-none border p-3 text-xs ${
                totalMismatch
                  ? "border-warning/50 bg-warning/10 text-warning"
                  : "border-muted bg-muted/40"
              }`}
            >
              <div className="flex items-center justify-between">
                <span>{translate("itemsTotal")}</span>
                <span className="font-medium">{itemsTotal.toFixed(2)}</span>
              </div>
              {detectedTotal !== null && (
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>{translate("receiptTotalDetected")}</span>
                  <span>{detectedTotal.toFixed(2)}</span>
                </div>
              )}
            </div>
          </CardContent>
          <CardFooter className="justify-between">
            <Button type="button" variant="outline" onClick={goBack}>
              <RiArrowLeftLine className="mr-2 h-4 w-4" />
              {translate("back")}
            </Button>
            <Button onClick={confirm} disabled={isSubmitting}>
              {isSubmitting
                ? translate("saving")
                : translate("createTransactions")}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </>
  );
}
