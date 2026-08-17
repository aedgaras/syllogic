"use client";

export type CsvImportStatusResponse = {
  status?:
    | "pending"
    | "mapping"
    | "previewing"
    | "importing"
    | "completed"
    | "failed";
  total_rows?: number;
  totalRows?: number;
  progress_count?: number;
  progressCount?: number;
  imported_rows?: number;
  importedRows?: number;
};

export async function fetchCsvImportStatus(importId: string): Promise<{
  statusCode: number;
  body: CsvImportStatusResponse | null;
}> {
  const response = await fetch(`/api/csv-import/status/${importId}`);
  if (response.status === 404 || response.status === 403) {
    return { statusCode: response.status, body: null };
  }
  if (!response.ok) return { statusCode: response.status, body: null };
  return { statusCode: response.status, body: await response.json() };
}
