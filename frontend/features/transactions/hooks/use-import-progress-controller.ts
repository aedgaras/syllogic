"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { fetchCsvImportStatus } from "@/lib/import/client";
import {
  clearPendingImport,
  getPendingImport,
} from "@/features/csv-import/client/pending-import-storage";
import { useImportStatus } from "@/features/csv-import/hooks/use-import-status";
import { presentImportStatusToast } from "@/features/csv-import/orchestration/import-status-toast-presenter";

type ImportState = "importing" | "completed" | "failed" | null;
type PendingImport = { importId: string; userId: string };

export function useImportProgressController() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const importingId = searchParams.get("importing");
  const [pendingImport, setPendingImport] = React.useState<PendingImport | null>(null);
  const [status, setStatus] = React.useState<ImportState>(null);

  const clearImportingParam = React.useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("importing");
    const query = params.toString();
    router.replace(query ? `/transactions?${query}` : "/transactions");
  }, [router, searchParams]);

  const clearImport = React.useCallback(
    (clearUrl = true) => {
      clearPendingImport();
      setPendingImport(null);
      if (clearUrl && importingId) clearImportingParam();
    },
    [clearImportingParam, importingId]
  );

  React.useEffect(() => {
    if (!userId) {
      clearPendingImport();
      setPendingImport(null);
      setStatus(null);
      return;
    }

    const candidate = importingId
      ? { importId: importingId, userId }
      : getPendingImport();
    if (candidate && candidate.userId !== userId) {
      clearImport(false);
      setStatus(null);
      return;
    }
    setPendingImport(candidate);
  }, [clearImport, importingId, userId]);

  const checkStatus = React.useCallback(async () => {
    if (!pendingImport) return;
    try {
      const { statusCode, body } = await queryClient.fetchQuery({
        queryKey: ["csv-import", "status", pendingImport.importId],
        queryFn: () => fetchCsvImportStatus(pendingImport.importId),
        staleTime: 0,
      });
      if (statusCode === 403 || statusCode === 404) {
        clearImport();
        setStatus(null);
        return;
      }
      if (!body) return;

      const nextStatus = body.status as ImportState | "pending" | "mapping" | "previewing";
      const total = body.total_rows ?? body.totalRows;
      const processed = body.progress_count ?? body.progressCount ?? body.imported_rows ?? body.importedRows;
      const completedByCounts =
        nextStatus === "importing" &&
        typeof total === "number" &&
        total > 0 &&
        typeof processed === "number" &&
        processed >= total;

      setStatus(completedByCounts ? "completed" : ["importing", "completed", "failed"].includes(nextStatus ?? "") ? nextStatus as ImportState : null);
      if (nextStatus === "completed" || nextStatus === "failed" || completedByCounts) {
        clearImport();
        router.refresh();
      }
    } catch {
      // SSE remains authoritative when the status endpoint is temporarily unavailable.
    }
  }, [clearImport, pendingImport, queryClient, router]);

  React.useEffect(() => { void checkStatus(); }, [checkStatus]);

  const stream = useImportStatus(pendingImport?.userId, pendingImport?.importId, {
    onStarted: () => setStatus("importing"),
    onProgress: () => setStatus("importing"),
    onCompleted: () => {
      setStatus("completed");
      router.refresh();
    },
    onFailed: () => {
      setStatus("failed");
      clearImport();
    },
    onSubscriptionsCompleted: () => {
      clearImport();
      router.refresh();
    },
    onEvent: presentImportStatusToast,
  });

  React.useEffect(() => {
    if (!pendingImport || (status !== "importing" && !stream.isImporting)) return;
    const interval = window.setInterval(() => void checkStatus(), 15_000);
    return () => window.clearInterval(interval);
  }, [checkStatus, pendingImport, status, stream.isImporting]);

  return {
    visible: status === "importing",
    progress: stream.progress,
    processedRows: stream.processedRows,
    totalRows: stream.totalRows,
  };
}
