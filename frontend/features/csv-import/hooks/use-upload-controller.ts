"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { initializeCsvImport } from "@/lib/actions/csv-import";
import { getUserAccounts } from "@/lib/actions/transactions";
import type { ImportAccount, ImportContext } from "../domain/contracts";
import { getImportContextPolicy } from "../orchestration/import-context";

export function useUploadController(context: ImportContext) {
  const router = useRouter();
  const policy = getImportContextPolicy(context);
  const [isLoading, setIsLoading] = useState(false);
  const [accounts, setAccounts] = useState<ImportAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState("");

  useEffect(() => {
    void getUserAccounts().then((data) => {
      setAccounts(data);
      if (data[0]) setSelectedAccountId(data[0].id);
    });
  }, []);

  const selectFile = (file: File, content: string) => { setSelectedFile(file); setFileContent(content); };
  const continueToMapping = async () => {
    if (!selectedAccountId) { toast.error("Please select an account"); return; }
    if (!selectedFile || !fileContent) { toast.error("Please upload a file"); return; }
    setIsLoading(true);
    try {
      const result = await initializeCsvImport(selectedAccountId, selectedFile.name, fileContent);
      if (result.success && result.importId) router.push(policy.mappingPath(result.importId));
      else toast.error(result.error || "Failed to initialize import");
    } catch { toast.error("An error occurred. Please try again."); }
    finally { setIsLoading(false); }
  };

  return { accounts, selectedAccountId, setSelectedAccountId, selectedFile, isLoading, selectFile, continueToMapping, goBack: () => router.push(policy.uploadBackPath), skip: context === "onboarding" ? () => router.push("/?tour=1") : null };
}
