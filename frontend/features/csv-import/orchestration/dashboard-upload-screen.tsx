"use client";

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
  const { accounts, selectedAccountId, setSelectedAccountId, selectedFile, isLoading, selectFile, continueToMapping, goBack } = useUploadController("dashboard");

  return (
    <>
      <Header title="Import Transactions" />
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4 pt-0">
        <Card className="w-full max-w-2xl">
          <CardHeader>
            <CardTitle>Import Transactions</CardTitle>
            <CardDescription>
              Upload a CSV or Excel file with your transactions. We&apos;ll help you map
              the columns to the correct fields.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>Select Account</Label>
              {accounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No accounts found. Please create an account first.
                </p>
              ) : (
                <Select value={selectedAccountId} onValueChange={(v) => v && setSelectedAccountId(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select an account">
                      {accounts.find((a) => a.id === selectedAccountId)?.name ?? "Select an account"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="w-auto min-w-[var(--anchor-width)] max-w-[90vw]">
                    {accounts.map((account) => (
                      <SelectItem key={account.id} value={account.id} className="pr-10">
                        {account.name} ({account.currency})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2">
              <Label>Upload File</Label>
              <CsvUploadDropzone
                onFileSelect={selectFile}
                isUploading={isLoading}
              />
            </div>
          </CardContent>
          <CardFooter className="justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={goBack}
            >
              <RiArrowLeftLine className="mr-2 h-4 w-4" />
              Cancel
            </Button>
            <Button
              onClick={continueToMapping}
              disabled={isLoading || !selectedFile || accounts.length === 0}
            >
              {isLoading ? "Processing..." : "Continue"}
              <RiArrowRightLine className="ml-2 h-4 w-4" />
            </Button>
          </CardFooter>
        </Card>
      </div>
    </>
  );
}
