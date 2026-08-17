"use client";
import { toast } from "sonner";
import type { ImportStatusEvent } from "../domain/import-status-events";
const shownToastKeys = new Set<string>();

export function presentImportStatusToast(event: ImportStatusEvent): void {
  const key = `${event.import_id}:${event.type}:${event.timestamp}`;
  if (shownToastKeys.has(key)) return;
  shownToastKeys.add(key);
  if (event.type === "import_started") toast.info(`Importing ${event.total_rows} transactions...`);
  if (event.type === "import_completed") toast.success(`Successfully imported ${event.imported_count} transactions`, { description: event.skipped_count > 0 ? `${event.skipped_count} duplicates skipped` : undefined, action: { label: "View", onClick: () => window.scrollTo(0, 0) } });
  if (event.type === "import_failed") toast.error(`Import failed: ${event.error}`);
  if (event.type === "subscriptions_completed") {
    const parts = [event.matched_count > 0 ? `${event.matched_count} matched` : "", event.detected_count > 0 ? `${event.detected_count} new detected` : ""].filter(Boolean);
    if (parts.length) toast.success("Subscription detection complete", { description: parts.join(", "), action: { label: "View", onClick: () => { window.location.href = "/subscriptions"; } } });
    else toast.info("Subscription detection complete", { description: "No new subscriptions found" });
  }
}
