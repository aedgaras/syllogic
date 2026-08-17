import { describe, expect, it } from "vitest";
import { parseImportStatusEvent } from "./import-status-events";
import {
  importStatusReducer,
  initialImportStatusState,
} from "./import-status-reducer";

describe("import status events", () => {
  it("parses known events and rejects malformed input", () => {
    expect(
      parseImportStatusEvent(
        JSON.stringify({
          type: "import_progress",
          import_id: "i-1",
          processed_rows: 4,
          total_rows: 10,
          percentage: 40,
          timestamp: "now",
        }),
      )?.type,
    ).toBe("import_progress");
    expect(parseImportStatusEvent("not-json")).toBeNull();
    expect(
      parseImportStatusEvent(
        JSON.stringify({ type: "unknown", import_id: "i-1", timestamp: "now" }),
      ),
    ).toBeNull();
  });
  it("reduces progress and both completion stages", () => {
    const progress = importStatusReducer(initialImportStatusState, {
      type: "import_progress",
      import_id: "i-1",
      processed_rows: 4,
      total_rows: 10,
      percentage: 40,
      timestamp: "now",
    });
    expect(progress).toMatchObject({
      progress: 40,
      processedRows: 4,
      isImporting: true,
    });
    const completed = importStatusReducer(progress, {
      type: "import_completed",
      import_id: "i-1",
      imported_count: 9,
      skipped_count: 1,
      timestamp: "now",
    });
    expect(completed).toMatchObject({
      progress: 100,
      isImporting: false,
      isComplete: false,
    });
    expect(
      importStatusReducer(completed, {
        type: "subscriptions_completed",
        import_id: "i-1",
        matched_count: 1,
        detected_count: 2,
        timestamp: "later",
      }).isComplete,
    ).toBe(true);
  });
});
