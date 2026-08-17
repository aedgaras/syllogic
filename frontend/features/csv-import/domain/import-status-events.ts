export interface ImportStartedEvent {
  type: "import_started";
  import_id: string;
  total_rows: number;
  timestamp: string;
}
export interface ImportProgressEvent {
  type: "import_progress";
  import_id: string;
  processed_rows: number;
  total_rows: number;
  percentage: number;
  timestamp: string;
}
export interface ImportCompletedEvent {
  type: "import_completed";
  import_id: string;
  imported_count: number;
  skipped_count: number;
  timestamp: string;
  categorization_summary?: {
    total: number;
    categorized: number;
    deterministic: number;
    llm: number;
    uncategorized: number;
    tokens_used: number;
    cost_usd: number;
  };
}
export interface ImportFailedEvent {
  type: "import_failed";
  import_id: string;
  error: string;
  timestamp: string;
}
export interface SubscriptionsStartedEvent {
  type: "subscriptions_started";
  import_id: string;
  timestamp: string;
}
export interface SubscriptionsCompletedEvent {
  type: "subscriptions_completed";
  import_id: string;
  matched_count: number;
  detected_count: number;
  timestamp: string;
}

export type ImportStatusEvent =
  | ImportStartedEvent
  | ImportProgressEvent
  | ImportCompletedEvent
  | ImportFailedEvent
  | SubscriptionsStartedEvent
  | SubscriptionsCompletedEvent;
const eventTypes = new Set<ImportStatusEvent["type"]>([
  "import_started",
  "import_progress",
  "import_completed",
  "import_failed",
  "subscriptions_started",
  "subscriptions_completed",
]);

export function parseImportStatusEvent(raw: string): ImportStatusEvent | null {
  try {
    const value = JSON.parse(raw) as Partial<ImportStatusEvent>;
    if (
      !value ||
      typeof value !== "object" ||
      typeof value.type !== "string" ||
      !eventTypes.has(value.type as ImportStatusEvent["type"])
    )
      return null;
    if (
      typeof value.import_id !== "string" ||
      typeof value.timestamp !== "string"
    )
      return null;
    return value as ImportStatusEvent;
  } catch {
    return null;
  }
}
