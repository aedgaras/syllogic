"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import {
  getPendingImport,
  clearPendingImport,
} from "@/features/csv-import/client/pending-import-storage";
import { useImportStatus } from "@/features/csv-import/hooks/use-import-status";
import { presentImportStatusToast } from "@/features/csv-import/orchestration/import-status-toast-presenter";
import { logger } from "@/lib/logger";

export function ImportStatusNotifier() {
  const router = useRouter();
  const { data: session } = useSession();
  const [pendingImport, setPendingImport] = useState<{
    importId: string;
    userId: string;
  } | null>(null);

  useEffect(() => {
    if (!session?.user?.id) return;
    const stored = getPendingImport();
    logger.debug("[ImportStatusNotifier] Checking for pending import", { stored });
    if (!stored) return;
    if (stored.userId !== session.user.id) {
      clearPendingImport();
      return;
    }
    logger.debug("[ImportStatusNotifier] Setting pending import", { stored });
    setPendingImport(stored);
  }, [session?.user?.id]);

  useImportStatus(pendingImport?.userId, pendingImport?.importId, {
    onEvent: presentImportStatusToast,
    onStarted: (event) => {
      logger.debug("[ImportStatusNotifier] import_started callback", { event });
    },
    onCompleted: (event) => {
      logger.debug("[ImportStatusNotifier] import_completed callback", { event });
      // Import completed, but keep pending until subscriptions finish
      router.refresh();
    },
    onFailed: () => {
      logger.debug("[ImportStatusNotifier] import_failed callback");
      clearPendingImport();
      setPendingImport(null);
    },
    onSubscriptionsCompleted: (event) => {
      logger.debug("[ImportStatusNotifier] subscriptions_completed callback", {
        event,
      });
      // Full flow complete (import + subscriptions)
      clearPendingImport();
      setPendingImport(null);
      router.refresh();
    },
  });

  return null;
}
