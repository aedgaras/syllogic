"use client";
import { t as translate } from "@/i18n/translate";

import { useCallback, useState } from "react";
import { RiCloseLine, RiUploadCloud2Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ReceiptUploadDropzoneProps {
  onFileSelect: (file: File) => void;
  onClear: () => void;
  previewUrl: string | null;
  selectedFile: File | null;
  isUploading?: boolean;
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export function ReceiptUploadDropzone({
  onFileSelect,
  onClear,
  previewUrl,
  selectedFile,
  isUploading,
}: ReceiptUploadDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const processFile = useCallback(
    (file: File) => {
      setError(null);

      const isValidType =
        file.type.startsWith("image/") || file.type === "";
      if (!isValidType) {
        setError(translate("pleaseUploadAPhotoOfYourReceipt"));
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        setError(translate("fileSizeMustBeLessThan10mb"));
        return;
      }

      onFileSelect(file);
    },
    [onFileSelect],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  if (selectedFile && previewUrl) {
    return (
      <div className="rounded-lg border border-dashed p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview, not a remote/optimizable image */}
            <img
              src={previewUrl}
              alt={translate("receiptPreview")}
              className="h-16 w-16 rounded-md object-cover"
            />
            <div>
              <p className="font-medium">{selectedFile.name}</p>
              <p className="text-xs text-muted-foreground">
                {(selectedFile.size / 1024).toFixed(1)} {translate("kb")}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClear}
            disabled={isUploading}
            aria-label={translate("removeFile")}
          >
            <RiCloseLine className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border-2 border-dashed p-8 text-center transition-colors cursor-pointer",
        isDragging
          ? "border-primary bg-primary/5"
          : "border-muted-foreground/25",
        error && "border-destructive",
      )}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={() => document.getElementById("receipt-file-input")?.click()}
    >
      <input
        id="receipt-file-input"
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileInput}
      />
      <div className="flex flex-col items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <RiUploadCloud2Line className="h-8 w-8 text-muted-foreground" />
        </div>
        <div>
          <p className="text-lg font-medium">
            {isDragging
              ? translate("dropYourFileHere")
              : translate("uploadAPhotoOfYourReceipt")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {translate("dragAndDropOrClickToBrowse")}
          </p>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <p className="text-xs text-muted-foreground">
          {translate("imageMax10mb")}
        </p>
      </div>
    </div>
  );
}
