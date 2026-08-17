"use client";

import {
  useImportStatus as useFeatureImportStatus,
  type UseImportStatusOptions as FeatureOptions,
} from "@/features/csv-import/hooks/use-import-status";
import { presentImportStatusToast } from "@/features/csv-import/orchestration/import-status-toast-presenter";

export type UseImportStatusOptions = FeatureOptions & { showToasts?: boolean };

/** Compatibility adapter. New feature code should use the feature hook directly. */
export function useImportStatus(
  userId: string | null | undefined,
  importId: string | null | undefined,
  options: UseImportStatusOptions = {}
) {
  const { showToasts = true, onEvent, ...callbacks } = options;
  return useFeatureImportStatus(userId, importId, {
    ...callbacks,
    onEvent: (event) => {
      if (showToasts) presentImportStatusToast(event);
      onEvent?.(event);
    },
  });
}

export {
  clearPendingImport,
  getPendingImport,
  PENDING_IMPORT_STORAGE_KEY,
  setPendingImport,
} from "@/features/csv-import/client/pending-import-storage";
export type {
  ImportCompletedEvent,
  ImportFailedEvent,
  ImportProgressEvent,
  ImportStartedEvent,
  ImportStatusEvent,
  SubscriptionsCompletedEvent,
  SubscriptionsStartedEvent,
} from "@/features/csv-import/hooks/use-import-status";
