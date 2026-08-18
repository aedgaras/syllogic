import {
  decryptWithFallback,
  encryptValue,
} from "@/lib/security/data-encryption";
import { storage } from "@/lib/storage";
import { randomUUID } from "node:crypto";

export interface StoredReceiptFile {
  filePath: string;
  filePathCiphertext: string | null;
}

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/webp": "webp",
};

export async function storeReceiptFile(
  userId: string,
  buffer: Buffer,
  contentType: string,
): Promise<StoredReceiptFile> {
  // Never incorporate a client-controlled filename into a storage path.
  const extension = EXTENSION_BY_CONTENT_TYPE[contentType] ?? "jpg";
  const filePath = `receipt-scans/${userId}/${randomUUID()}.${extension}`;
  await storage.upload(filePath, buffer, { contentType });
  return { filePath, filePathCiphertext: encryptValue(filePath) };
}

export async function readReceiptFile(receiptScan: {
  filePath: string | null;
  filePathCiphertext: string | null;
}): Promise<Buffer | null> {
  const filePath = decryptWithFallback(
    receiptScan.filePathCiphertext,
    receiptScan.filePath,
  );
  if (!filePath) return null;
  return storage.download(filePath);
}
