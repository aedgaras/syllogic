import {
  decryptWithFallback,
  encryptValue,
} from "@/lib/security/data-encryption";
import { storage } from "@/lib/storage";
import { randomUUID } from "node:crypto";

export interface StoredImportFile {
  filePath: string;
  filePathCiphertext: string | null;
}

export async function storeImportFile(
  userId: string,
  content: string,
): Promise<StoredImportFile> {
  // Never incorporate a client-controlled filename into a storage path.
  const filePath = `csv-imports/${userId}/${randomUUID()}.csv`;
  await storage.upload(filePath, Buffer.from(content), {
    contentType: "text/csv",
  });
  return { filePath, filePathCiphertext: encryptValue(filePath) };
}

export async function readImportFile(importSession: {
  filePath: string | null;
  filePathCiphertext: string | null;
}): Promise<string | null> {
  const filePath = decryptWithFallback(
    importSession.filePathCiphertext,
    importSession.filePath,
  );
  if (!filePath) return null;
  return (await storage.download(filePath)).toString("utf-8");
}
