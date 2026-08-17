import type { ColumnMapping, ImportContext } from "./contracts";

export type ImportStep = "upload" | "mapping" | "preview" | "enqueue" | "complete" | "failed";

export interface CsvImportWorkflowState {
  context: ImportContext;
  step: ImportStep;
  importId: string | null;
  error: string | null;
}

export type CsvImportWorkflowEvent =
  | { type: "UPLOAD_COMPLETED"; importId: string }
  | { type: "MAPPING_COMPLETED" }
  | { type: "PREVIEW_COMPLETED" }
  | { type: "ENQUEUE_COMPLETED" }
  | { type: "IMPORT_COMPLETED" }
  | { type: "FAILED"; error: string }
  | { type: "RETRY" };

export function createImportWorkflow(context: ImportContext): CsvImportWorkflowState {
  return { context, step: "upload", importId: null, error: null };
}

export function csvImportWorkflowReducer(
  state: CsvImportWorkflowState,
  event: CsvImportWorkflowEvent
): CsvImportWorkflowState {
  switch (event.type) {
    case "UPLOAD_COMPLETED":
      return { ...state, step: "mapping", importId: event.importId, error: null };
    case "MAPPING_COMPLETED":
      return state.importId ? { ...state, step: "preview", error: null } : state;
    case "PREVIEW_COMPLETED":
      return state.importId ? { ...state, step: "enqueue", error: null } : state;
    case "ENQUEUE_COMPLETED":
    case "IMPORT_COMPLETED":
      return { ...state, step: "complete", error: null };
    case "FAILED":
      return { ...state, step: "failed", error: event.error };
    case "RETRY":
      return { ...state, step: state.importId ? "mapping" : "upload", error: null };
  }
}

export function sanitizeMappingForContext(
  mapping: ColumnMapping,
  context: ImportContext
): ColumnMapping {
  if (context === "onboarding") return mapping;
  return { ...mapping, merchant: null, transactionType: null };
}
