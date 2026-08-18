"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { getAuthenticatedSession } from "@/lib/auth-helpers";
import {
  isDemoRestrictedUserEmail,
  DEMO_RESTRICTED_ACTION_ERROR,
} from "@/lib/demo-access";
import { getBackendBaseUrl } from "@/lib/backend-url";
import { createInternalAuthHeaders } from "@/lib/internal-auth";
import { storeReceiptFile } from "./receipt-file.storage";
import type { ReceiptLineItem, ReceiptScanResult } from "../domain/contracts";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

interface BackendReceiptLineItem {
  description: string;
  amount: string | number;
  category_id: string | null;
  category_name: string | null;
}

interface BackendExtractResponse {
  receipt_scan_id: string;
  status: string;
  merchant_name: string | null;
  receipt_total: string | number | null;
  items: BackendReceiptLineItem[];
}

function toReceiptLineItem(
  item: BackendReceiptLineItem,
  index: number,
): ReceiptLineItem {
  return {
    key: `${index}-${item.description}`,
    description: item.description,
    amount: String(item.amount),
    categoryId: item.category_id,
    categoryName: item.category_name,
    transactionType: "debit",
  };
}

async function getReceiptScanAccess() {
  const session = await getAuthenticatedSession();
  if (!session) {
    return { error: "Not authenticated" } as const;
  }
  if (isDemoRestrictedUserEmail(session.user.email)) {
    return { error: DEMO_RESTRICTED_ACTION_ERROR } as const;
  }
  return { session } as const;
}

export async function uploadAndExtractReceipt(
  accountId: string,
  fileBase64: string,
  contentType: string,
): Promise<{ success: boolean; error?: string; result?: ReceiptScanResult }> {
  const access = await getReceiptScanAccess();
  if ("error" in access) {
    return { success: false, error: access.error };
  }
  const { session } = access;

  const account = await db.query.accounts.findFirst({
    where: and(
      eq(accounts.id, accountId),
      eq(accounts.userId, session.user.id),
    ),
  });
  if (!account) {
    return { success: false, error: "Account not found" };
  }

  let imageBuffer: Buffer;
  try {
    imageBuffer = Buffer.from(fileBase64, "base64");
  } catch {
    return { success: false, error: "Invalid file" };
  }
  if (imageBuffer.length === 0 || imageBuffer.length > MAX_UPLOAD_BYTES) {
    return { success: false, error: "Receipt image is too large or empty" };
  }

  try {
    // Kept as an audit trail; the backend OCRs the bytes sent in the request
    // body directly rather than reading this storage location itself.
    await storeReceiptFile(session.user.id, imageBuffer, contentType);

    const backendUrl = getBackendBaseUrl();
    const pathWithQuery = "/api/receipt-scan/extract";
    const requestBody = JSON.stringify({
      account_id: accountId,
      file_base64: fileBase64,
      content_type: contentType,
    });

    const response = await fetch(`${backendUrl}${pathWithQuery}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...createInternalAuthHeaders({
          method: "POST",
          pathWithQuery,
          userId: session.user.id,
          body: requestBody,
        }),
      },
      body: requestBody,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Receipt scan extract failed:", response.status, errorText);
      return { success: false, error: "Failed to process receipt" };
    }

    const backendResponse: BackendExtractResponse = await response.json();

    return {
      success: true,
      result: {
        receiptScanId: backendResponse.receipt_scan_id,
        status: backendResponse.status,
        merchantName: backendResponse.merchant_name,
        receiptTotal:
          backendResponse.receipt_total === null
            ? null
            : String(backendResponse.receipt_total),
        items: backendResponse.items.map(toReceiptLineItem),
      },
    };
  } catch (error) {
    console.error("Failed to extract receipt:", error);
    return { success: false, error: "Failed to process receipt" };
  }
}

export async function confirmReceiptScan(
  receiptScanId: string,
  items: ReceiptLineItem[],
  bookedAt: string,
): Promise<{ success: boolean; error?: string; transactionCount?: number }> {
  const access = await getReceiptScanAccess();
  if ("error" in access) {
    return { success: false, error: access.error };
  }
  const { session } = access;

  if (items.length === 0) {
    return { success: false, error: "No items to import" };
  }

  try {
    const backendUrl = getBackendBaseUrl();
    const pathWithQuery = `/api/receipt-scan/${receiptScanId}/confirm`;
    const requestBody = JSON.stringify({
      items: items.map((item) => ({
        description: item.description,
        amount: item.amount,
        category_id: item.categoryId,
        transaction_type: item.transactionType,
      })),
      booked_at: bookedAt,
    });

    const response = await fetch(`${backendUrl}${pathWithQuery}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...createInternalAuthHeaders({
          method: "POST",
          pathWithQuery,
          userId: session.user.id,
          body: requestBody,
        }),
      },
      body: requestBody,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Receipt scan confirm failed:", response.status, errorText);
      return { success: false, error: "Failed to save transactions" };
    }

    const created: unknown[] = await response.json();
    return { success: true, transactionCount: created.length };
  } catch (error) {
    console.error("Failed to confirm receipt scan:", error);
    return { success: false, error: "Failed to save transactions" };
  }
}
