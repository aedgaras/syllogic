import type {
  ImportCompletedEvent,
  ImportStatusEvent,
  SubscriptionsCompletedEvent,
} from "./import-status-events";

export interface ImportStatusState {
  progress: number | null;
  totalRows: number | null;
  processedRows: number | null;
  isImporting: boolean;
  isProcessingSubscriptions: boolean;
  isComplete: boolean;
  error: string | null;
  result: ImportCompletedEvent | null;
  subscriptionsResult: SubscriptionsCompletedEvent | null;
}
export const initialImportStatusState: ImportStatusState = {
  progress: null,
  totalRows: null,
  processedRows: null,
  isImporting: false,
  isProcessingSubscriptions: false,
  isComplete: false,
  error: null,
  result: null,
  subscriptionsResult: null,
};

export function importStatusReducer(
  state: ImportStatusState,
  event: ImportStatusEvent | { type: "reset" },
): ImportStatusState {
  switch (event.type) {
    case "reset":
      return initialImportStatusState;
    case "import_started":
      return {
        ...state,
        totalRows: event.total_rows,
        isImporting: true,
        error: null,
      };
    case "import_progress":
      return {
        ...state,
        progress: event.percentage,
        processedRows: event.processed_rows,
        totalRows: event.total_rows,
        isImporting: true,
      };
    case "import_completed":
      return { ...state, isImporting: false, progress: 100, result: event };
    case "import_failed":
      return {
        ...state,
        isComplete: true,
        isImporting: false,
        error: event.error,
      };
    case "subscriptions_started":
      return { ...state, isProcessingSubscriptions: true };
    case "subscriptions_completed":
      return {
        ...state,
        isProcessingSubscriptions: false,
        isComplete: true,
        subscriptionsResult: event,
      };
  }
}
