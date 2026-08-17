"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { enqueueBackgroundImport, getCsvImportSession, previewImportedTransactions } from "@/lib/actions/csv-import";
import { useSession } from "@/lib/auth-client";
import { setPendingImport } from "../client/pending-import-storage";
import type { BalanceVerification, ImportContext, PreviewTransaction } from "../domain/contracts";
import { getImportContextPolicy } from "../orchestration/import-context";

export function usePreviewController(context: ImportContext) {
  const router = useRouter();
  const importId = useSearchParams().get("id");
  const policy = getImportContextPolicy(context);
  const { data: session } = useSession();
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [hasStartedImport, setHasStartedImport] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [transactions, setTransactions] = useState<PreviewTransaction[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [balanceVerification, setBalanceVerification] = useState<BalanceVerification | null>(null);

  const load = useCallback(async () => {
    if (!importId) { toast.error("Import ID not found"); router.push(policy.rootPath); return; }
    try {
      const importSession = await getCsvImportSession(importId);
      if (!importSession) { toast.error("Import session not found"); router.push(policy.rootPath); return; }
      if (!importSession.columnMapping) { toast.error("Column mapping not found"); router.push(policy.mappingPath(importId)); return; }
      const result = await previewImportedTransactions(importId);
      if (!result.success || !result.transactions) { toast.error(result.error || "Failed to preview transactions"); router.push(policy.mappingPath(importId)); return; }
      setTransactions(result.transactions);
      setSelectedIndices(result.transactions.filter((tx) => !tx.isDuplicate).map((tx) => tx.rowIndex));
      setBalanceVerification(result.balanceVerification ?? null);
    } catch { toast.error("Failed to load preview"); router.push(policy.rootPath); }
    finally { setIsLoading(false); }
  }, [importId, policy, router]);

  useEffect(() => { void load(); }, [load]);
  const groups = useMemo(() => ({
    toImport: transactions.filter((tx) => selectedIndices.includes(tx.rowIndex)),
    skipped: transactions.filter((tx) => !selectedIndices.includes(tx.rowIndex)),
  }), [selectedIndices, transactions]);

  const enqueue = async () => {
    if (!importId) return;
    if (!selectedIndices.length) { toast.error("Please select at least one transaction to import"); return; }
    if (!session?.user?.id) { toast.error("Not authenticated"); return; }
    setIsImporting(true);
    try {
      const result = await enqueueBackgroundImport(importId, selectedIndices);
      if (!result.success || !result.importId) { toast.error(result.error || "Failed to start import"); return; }
      setPendingImport(result.importId, session.user.id);
      setHasStartedImport(true);
      const completionPath = policy.completionPath(result.importId);
      if (completionPath) {
        toast.info(`Starting import of ${result.totalTransactions || selectedIndices.length} transactions...`, { description: "You'll be notified when complete." });
        router.push(completionPath);
      } else setShowSuccessModal(true);
    } catch { toast.error("Failed to start import"); }
    finally { setIsImporting(false); }
  };

  return { importId, isLoading, isImporting, hasStartedImport, showSuccessModal, setShowSuccessModal, selectedIndices, setSelectedIndices, balanceVerification, ...groups, enqueue, goBack: () => importId && router.push(policy.mappingPath(importId)) };
}
