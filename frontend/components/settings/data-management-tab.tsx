"use client";
import { t as translate } from "@/i18n/translate";

import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  RiDownload2Line,
  RiUploadCloud2Line,
  RiFileTextLine,
  RiCloseLine,
} from "@remixicon/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { exportUserData, importUserData } from "@/lib/actions/data-export";

export function DataManagementTab() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const result = await exportUserData();
      if (!result.success || !result.data) {
        toast.error(result.error || translate("failedToExportData"));
        return;
      }
      const blob = new Blob([result.data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.fileName || "syllogic-export.json";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success(translate("dataExportedSuccessfully"));
    } catch {
      toast.error(translate("failedToExportData"));
    } finally {
      setExporting(false);
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPendingFile(file);
    setConfirmOpen(true);
  }

  function resetFileInput() {
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleConfirmImport() {
    if (!pendingFile) return;
    setImporting(true);
    try {
      const text = await pendingFile.text();
      const result = await importUserData(text);
      if (!result.success) {
        toast.error(result.error || translate("failedToImportData"));
        return;
      }
      const total = Object.values(result.summary ?? {}).reduce(
        (sum, n) => sum + n,
        0,
      );
      toast.success(translate("importedRecordsSuccessfully", { count: total }));
      setTimeout(() => window.location.reload(), 1200);
    } catch {
      toast.error(translate("failedToImportData"));
    } finally {
      setImporting(false);
      setPendingFile(null);
      setConfirmOpen(false);
      resetFileInput();
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <RiDownload2Line className="size-4" />
            {translate("exportYourData")}
          </CardTitle>
          <CardDescription>
            {translate(
              "downloadEverythingSyllogicKnowsAboutYourFinancesAsA",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleExport} disabled={exporting}>
            <RiDownload2Line />
            {exporting ? translate("exporting") : translate("exportData")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <RiUploadCloud2Line className="size-4" />
            {translate("importData")}
          </CardTitle>
          <CardDescription>
            {translate(
              "restoreOrMergeDataFromAPreviousSyllogicExportImportedRecords",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleFileChange}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
          >
            <RiFileTextLine />
            {translate("chooseExportFile")}
          </Button>
        </CardContent>
      </Card>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!importing) {
            setConfirmOpen(open);
            if (!open) {
              setPendingFile(null);
              resetFileInput();
            }
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{translate("importData")}</AlertDialogTitle>
            <AlertDialogDescription>
              {translate("thisAddsTheRecordsFromFileNameToYourAccount", {
                fileName: pendingFile?.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={importing}>
              <RiCloseLine />
              {translate("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmImport} disabled={importing}>
              {importing ? translate("importing") : translate("importData")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
