import { describe, expect, it } from "vitest";
import {
  createImportWorkflow,
  csvImportWorkflowReducer,
  sanitizeMappingForContext,
} from "./workflow";
import type { ColumnMapping } from "./contracts";

const mapping: ColumnMapping = {
  date: "Date",
  amount: "Amount",
  description: "Description",
  merchant: "Merchant",
  transactionType: "Type",
  fee: null,
  state: null,
  startingBalance: null,
  endingBalance: null,
};

describe("CSV import workflow", () => {
  it("advances through upload, mapping, preview, and completion", () => {
    let state = createImportWorkflow("dashboard");
    state = csvImportWorkflowReducer(state, {
      type: "UPLOAD_COMPLETED",
      importId: "import-1",
    });
    expect(state).toMatchObject({ step: "mapping", importId: "import-1" });
    state = csvImportWorkflowReducer(state, { type: "MAPPING_COMPLETED" });
    expect(state.step).toBe("preview");
    state = csvImportWorkflowReducer(state, { type: "PREVIEW_COMPLETED" });
    expect(state.step).toBe("enqueue");
    state = csvImportWorkflowReducer(state, { type: "ENQUEUE_COMPLETED" });
    expect(state.step).toBe("complete");
  });

  it("keeps mapping differences in the context policy", () => {
    expect(sanitizeMappingForContext(mapping, "dashboard")).toMatchObject({
      merchant: null,
      transactionType: null,
    });
    expect(sanitizeMappingForContext(mapping, "onboarding")).toEqual(mapping);
  });
});
