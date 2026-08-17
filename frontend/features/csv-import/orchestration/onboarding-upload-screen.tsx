"use client";

import { useRouter } from "next/navigation";
import { RiArrowLeftLine, RiArrowRightLine, RiSkipForwardLine } from "@remixicon/react";
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
import { OnboardingProgress } from "@/components/onboarding/onboarding-progress";
import { CsvUploadDropzone } from "@/components/transactions/csv-upload-dropzone";
import { useUploadController } from "@/features/csv-import/hooks/use-upload-controller";

export default function StepFourImportPage() {
  const router = useRouter();
  const { accounts, selectedAccountId, setSelectedAccountId, selectedFile, isLoading, selectFile, continueToMapping, goBack, skip } = useUploadController("onboarding");

  return (
    <div className="space-y-8">
      <OnboardingProgress currentStep={4} />
      <Card className="min-h-[640px] h-[640px] flex flex-col">
        <CardHeader>
          <CardTitle>Import your transactions</CardTitle>
          <CardDescription>
            Upload a CSV or Excel file. We&apos;ll help you map the columns to the
            correct fields.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 space-y-6">
          <div className="space-y-2">
            <Label>Select Account</Label>
            {accounts.length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground space-y-2">
                <p>No accounts found. Create one first to continue.</p>
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 text-xs"
                  onClick={() => router.push("/step-3")}
                >
                  Go to Bank Accounts
                </Button>
              </div>
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
            <CsvUploadDropzone onFileSelect={selectFile} isUploading={isLoading} />
          </div>
        </CardContent>
        <CardFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="outline" onClick={goBack}>
            <RiArrowLeftLine className="mr-2 h-4 w-4" />
            Back
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => skip?.()} disabled={isLoading}>
              Skip for now
              <RiSkipForwardLine className="ml-2 h-4 w-4" />
            </Button>
            <Button
              onClick={continueToMapping}
              disabled={isLoading || !selectedFile || accounts.length === 0}
            >
              {isLoading ? "Processing..." : "Continue"}
              <RiArrowRightLine className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
