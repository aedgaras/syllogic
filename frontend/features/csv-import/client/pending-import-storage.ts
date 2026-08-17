export const PENDING_IMPORT_STORAGE_KEY = "pendingCsvImport";
export const PENDING_IMPORT_MAX_AGE_MS = 20 * 60 * 1000;
export interface PendingImport {
  importId: string;
  userId: string;
}

export function setPendingImport(importId: string, userId: string): void {
  if (typeof window !== "undefined")
    sessionStorage.setItem(
      PENDING_IMPORT_STORAGE_KEY,
      JSON.stringify({ importId, userId, timestamp: Date.now() }),
    );
}
export function getPendingImport(now = Date.now()): PendingImport | null {
  if (typeof window === "undefined") return null;
  const stored = sessionStorage.getItem(PENDING_IMPORT_STORAGE_KEY);
  if (!stored) return null;
  try {
    const data = JSON.parse(stored) as Partial<PendingImport> & {
      timestamp?: number;
    };
    if (
      typeof data.importId !== "string" ||
      typeof data.userId !== "string" ||
      typeof data.timestamp !== "number" ||
      now - data.timestamp > PENDING_IMPORT_MAX_AGE_MS
    ) {
      clearPendingImport();
      return null;
    }
    return { importId: data.importId, userId: data.userId };
  } catch {
    clearPendingImport();
    return null;
  }
}
export function clearPendingImport(): void {
  if (typeof window !== "undefined")
    sessionStorage.removeItem(PENDING_IMPORT_STORAGE_KEY);
}
