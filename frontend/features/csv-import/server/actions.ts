"use server";

import { revalidatePath } from "next/cache";
import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { csvImports, accounts, transactions } from "@/lib/db/schema";
import { getAuthenticatedSession, requireAuth } from "@/lib/auth-helpers";
import { deleteTransactions } from "@/lib/actions/transactions";
import { getBackendBaseUrl } from "@/lib/backend-url";
import { createInternalAuthHeaders } from "@/lib/internal-auth";
import {
  DEMO_RESTRICTED_ACTION_ERROR,
  isDemoRestrictedUserEmail,
} from "@/lib/demo-access";
import {
  detectCsvDelimiter,
  inferAmountFormat,
  parseDelimitedText,
  parseLocalizedNumber,
  type AmountFormat,
  type InferredAmountFormat,
} from "@/lib/import/parsing";
import {
  DATE_FORMAT_OPTIONS,
  isImportDateFormat,
  parseImportDate,
  toInvariantDate,
  toInvariantDateTime,
} from "@/lib/import/dates";
import { detectDuplicates, markDuplicates } from "@/lib/utils/duplicate-detection";
import { readImportFile, storeImportFile } from "./import-file.storage";
import type {
  BalanceVerification,
  ColumnMapping,
  CsvImportSession,
  CsvImportWithStats,
  DailyBalance,
  ParsedCsvData,
  PreviewTransaction,
} from "@/features/csv-import/public";

export type {
  BalanceVerification,
  ColumnMapping,
  CsvImportSession,
  CsvImportWithStats,
  DailyBalance,
  ParsedCsvData,
  PreviewTransaction,
} from "@/features/csv-import/public";

function normalizeColumnMapping(mapping: ColumnMapping): ColumnMapping {
  const dateFormat = mapping.typeConfig?.dateFormat;
  return {
    ...mapping,
    typeConfig: {
      ...mapping.typeConfig,
      amountFormat: mapping.typeConfig?.amountFormat ?? "AUTO",
      dateFormat: isImportDateFormat(dateFormat) ? dateFormat : "DD-MM-YYYY",
    },
  };
}

function collectNumericSamples(rows: string[][], indices: number[]): string[] {
  const samples: string[] = [];

  for (const row of rows) {
    for (const index of indices) {
      if (index < 0) {
        continue;
      }

      const value = row[index]?.trim();
      if (value) {
        samples.push(value);
      }
    }

    if (samples.length >= 100) {
      break;
    }
  }

  return samples;
}

function createNumberParseOptions(
  mapping: ColumnMapping,
  rows: string[][],
  indices: number[]
): {
  amountFormat: AmountFormat;
  inferredFormat: InferredAmountFormat;
} {
  return {
    amountFormat: mapping.typeConfig?.amountFormat ?? "AUTO",
    inferredFormat: inferAmountFormat(collectNumericSamples(rows, indices)),
  };
}

function parseImportedNumber(
  raw: string | undefined,
  label: string,
  rowNumber: number,
  options: {
    amountFormat: AmountFormat;
    inferredFormat: InferredAmountFormat;
  }
): number | null {
  if (!raw?.trim()) {
    return null;
  }

  const parsed = parseLocalizedNumber(raw, options);
  if (parsed !== null) {
    return parsed;
  }

  throw new Error(
    `Could not parse ${label} on row ${rowNumber}: "${raw}". Choose Amount Format in mapping if the file uses a different decimal separator.`
  );
}

async function getCsvImportAccess() {
  const session = await getAuthenticatedSession();

  if (!session?.user?.id) {
    return { error: "Not authenticated" } as const;
  }

  if (isDemoRestrictedUserEmail(session.user.email)) {
    return { error: DEMO_RESTRICTED_ACTION_ERROR } as const;
  }

  return { session, userId: session.user.id } as const;
}

export async function initializeCsvImport(
  accountId: string,
  fileName: string,
  fileContent: string
): Promise<{ success: boolean; error?: string; importId?: string }> {
  const access = await getCsvImportAccess();
  if ("error" in access) {
    return { success: false, error: access.error };
  }
  const { session } = access;

  const originalFileName = fileName.trim();
  if (
    !originalFileName ||
    originalFileName.length > 255 ||
    originalFileName.includes("/") ||
    originalFileName.includes("\\") ||
    originalFileName.includes("\0")
  ) {
    return { success: false, error: "Invalid CSV filename" };
  }

  try {
    // Verify the account belongs to the user
    const account = await db.query.accounts.findFirst({
      where: and(
        eq(accounts.id, accountId),
        eq(accounts.userId, session.user.id)
      ),
    });

    if (!account) {
      return { success: false, error: "Account not found" };
    }

    // Save the CSV file
    const storedFile = await storeImportFile(session.user.id, fileContent);

    const delimiter = detectCsvDelimiter(fileContent);
    const parsed = parseDelimitedText(fileContent, delimiter);
    const totalRows = parsed.rows.length;

    // Create import session
    const [result] = await db
      .insert(csvImports)
      .values({
        userId: session.user.id,
        accountId,
        fileName: originalFileName,
        filePath: storedFile.filePath,
        filePathCiphertext: storedFile.filePathCiphertext,
        status: "pending",
        totalRows,
      })
      .returning({ id: csvImports.id });

    return { success: true, importId: result.id };
  } catch (error) {
    console.error("Failed to initialize CSV import:", error);
    return { success: false, error: "Failed to initialize CSV import" };
  }
}

export async function parseCsvHeaders(
  importId: string
): Promise<{ success: boolean; error?: string; data?: ParsedCsvData }> {
  const access = await getCsvImportAccess();
  if ("error" in access) {
    return { success: false, error: access.error };
  }
  const { userId } = access;

  try {
    // Get the import session
    const importSession = await db.query.csvImports.findFirst({
      where: and(
        eq(csvImports.id, importId),
        eq(csvImports.userId, userId)
      ),
    });

    if (!importSession) {
      return { success: false, error: "Import session not found" };
    }

    const fileContent = await readImportFile(importSession);
    if (!fileContent) {
      return { success: false, error: "Import file path is unavailable" };
    }

    const delimiter = detectCsvDelimiter(fileContent);
    const parsed = parseDelimitedText(fileContent, delimiter);

    if (parsed.headers.length === 0) {
      return { success: false, error: "CSV file is empty" };
    }

    return {
      success: true,
      data: {
        headers: parsed.headers,
        rows: parsed.rows,
        sampleRows: parsed.rows.slice(0, 5),
      },
    };
  } catch (error) {
    console.error("Failed to parse CSV headers:", error);
    return { success: false, error: "Failed to parse CSV file" };
  }
}

export async function getAiColumnMapping(
  importId: string,
  csvHeaders: string[],
  sampleRows: string[][]
): Promise<{ success: boolean; error?: string; mapping?: ColumnMapping }> {
  const access = await getCsvImportAccess();
  if ("error" in access) {
    return { success: false, error: access.error };
  }
  const { userId } = access;

  try {
    const pathWithQuery = "/api/llm/column-mapping";
    const requestBody = JSON.stringify({
      headers: csvHeaders,
      sample_rows: sampleRows.slice(0, 3),
      date_formats: DATE_FORMAT_OPTIONS.map(({ value }) => value),
    });
    const response = await fetch(`${getBackendBaseUrl()}${pathWithQuery}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...createInternalAuthHeaders({
          method: "POST",
          pathWithQuery,
          userId,
          body: requestBody,
        }),
      },
      body: requestBody,
      cache: "no-store",
    });
    const payload = (await response.json()) as { mapping?: ColumnMapping; detail?: string };
    if (!response.ok || !payload.mapping) {
      return { success: false, error: payload.detail || "Failed to analyze CSV columns" };
    }

    const mapping = normalizeColumnMapping(payload.mapping);

    // Update the import session with the mapping
    await db
      .update(csvImports)
      .set({
        columnMapping: mapping,
        status: "mapping",
      })
      .where(and(eq(csvImports.id, importId), eq(csvImports.userId, userId)));

    return { success: true, mapping };
  } catch (error) {
    console.error("Failed to get AI column mapping:", error);
    return { success: false, error: "Failed to analyze CSV columns" };
  }
}

export async function saveColumnMapping(
  importId: string,
  mapping: ColumnMapping
): Promise<{ success: boolean; error?: string }> {
  const access = await getCsvImportAccess();
  if ("error" in access) {
    return { success: false, error: access.error };
  }
  const { userId } = access;

  try {
    await db
      .update(csvImports)
      .set({
        columnMapping: normalizeColumnMapping(mapping),
        status: "previewing",
      })
      .where(
        and(eq(csvImports.id, importId), eq(csvImports.userId, userId))
      );

    return { success: true };
  } catch (error) {
    console.error("Failed to save column mapping:", error);
    return { success: false, error: "Failed to save column mapping" };
  }
}


export async function previewImportedTransactions(
  importId: string
): Promise<{ success: boolean; error?: string; transactions?: PreviewTransaction[]; balanceVerification?: BalanceVerification; dailyBalances?: DailyBalance[] }> {
  const access = await getCsvImportAccess();
  if ("error" in access) {
    return { success: false, error: access.error };
  }
  const { userId } = access;

  try {
    // Get the import session
    const importSession = await db.query.csvImports.findFirst({
      where: and(
        eq(csvImports.id, importId),
        eq(csvImports.userId, userId)
      ),
    });

    if (!importSession || !importSession.columnMapping) {
      return { success: false, error: "Import session not found or mapping incomplete" };
    }

    const fileContent = await readImportFile(importSession);
    if (!fileContent) {
      return { success: false, error: "Import file path is unavailable" };
    }

    const mapping = normalizeColumnMapping(importSession.columnMapping as ColumnMapping);

    // Read and parse the CSV file
    const delimiter = detectCsvDelimiter(fileContent);
    const { headers, rows } = parseDelimitedText(fileContent, delimiter);

    // Get column indices
    const dateIndex = mapping.date ? headers.indexOf(mapping.date) : -1;
    const amountIndex = mapping.amount ? headers.indexOf(mapping.amount) : -1;
    const descriptionIndex = mapping.description ? headers.indexOf(mapping.description) : -1;
    const merchantIndex = mapping.merchant ? headers.indexOf(mapping.merchant) : -1;
    const typeIndex = mapping.transactionType ? headers.indexOf(mapping.transactionType) : -1;
    const stateIndex = mapping.state ? headers.indexOf(mapping.state) : -1;
    const startBalIdx = mapping.startingBalance ? headers.indexOf(mapping.startingBalance) : -1;
    const endBalIdx = mapping.endingBalance ? headers.indexOf(mapping.endingBalance) : -1;
    const feeIdx = mapping.fee ? headers.indexOf(mapping.fee) : -1;

    if (dateIndex === -1 || amountIndex === -1 || descriptionIndex === -1) {
      return { success: false, error: "Required columns not mapped" };
    }

    const numberParseOptions = createNumberParseOptions(mapping, rows, [
      amountIndex,
      feeIdx,
      startBalIdx,
      endBalIdx,
    ]);

    // Parse transactions
    const previewTransactions: PreviewTransaction[] = [];
    const completedStateValue = mapping.typeConfig?.completedStateValue?.toLowerCase();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      // Filter by state if state column is mapped
      // Skip non-completed transactions (PENDING, REVERTED, CANCELLED, etc.)
      if (stateIndex >= 0 && completedStateValue) {
        const rowState = row[stateIndex]?.toLowerCase()?.trim();
        if (rowState !== completedStateValue) {
          continue; // Skip non-completed transactions
        }
      }

      const dateStr = row[dateIndex];
      const amountStr = row[amountIndex];
      const description = row[descriptionIndex];
      const merchant = merchantIndex >= 0 ? row[merchantIndex] : undefined;

      const parsedDate = parseImportDate(
        dateStr,
        mapping.typeConfig?.dateFormat ?? "DD-MM-YYYY"
      );
      if (!parsedDate) continue;

      // Parse amount (preserve sign for now to determine transaction type)
      const parsedAmount = parseImportedNumber(amountStr, "amount", i + 2, numberParseOptions);
      if (parsedAmount === null) continue;

      // Determine transaction type BEFORE calling Math.abs()
      let transactionType: "debit" | "credit" = "debit";

      // First check if there's an explicit transaction type column
      if (typeIndex >= 0 && mapping.typeConfig) {
        const typeValue = row[typeIndex]?.toLowerCase().trim();
        if (mapping.typeConfig.creditValue && typeValue?.includes(mapping.typeConfig.creditValue.toLowerCase())) {
          transactionType = "credit";
        } else if (mapping.typeConfig.debitValue && typeValue?.includes(mapping.typeConfig.debitValue.toLowerCase())) {
          transactionType = "debit";
        } else {
          // If type column exists but value doesn't match, check for common aliases
          if (typeValue && (typeValue.includes("expense") || typeValue.includes("debit") || typeValue.includes("outgoing") || typeValue.includes("payment"))) {
            transactionType = "debit";
          } else if (typeValue && (typeValue.includes("income") || typeValue.includes("credit") || typeValue.includes("incoming") || typeValue.includes("deposit"))) {
            transactionType = "credit";
          }
        }
      }

      // If no explicit type column, infer from amount sign (if amounts are signed)
      // Note: Negative amounts = expenses (debit), Positive amounts = income (credit)
      if (typeIndex === -1 && mapping.typeConfig?.isAmountSigned) {
        transactionType = parsedAmount >= 0 ? "credit" : "debit";
      }

      // Send amount with correct sign based on transaction_type
      // Backend expects: debit = negative, credit = positive
      const amount = transactionType === "debit" ? -Math.abs(parsedAmount) : Math.abs(parsedAmount);

      previewTransactions.push({
        rowIndex: i,
        date: toInvariantDateTime(parsedDate),
        amount,
        description,
        merchant,
        transactionType,
      });
    }

    // Detect duplicates against existing transactions in the same account
    const existingTransactions = await db.query.transactions.findMany({
      where: and(
        eq(transactions.accountId, importSession.accountId),
        eq(transactions.userId, userId)
      ),
    });

    // Run duplicate detection
    const duplicateMatches = detectDuplicates(previewTransactions, existingTransactions);
    const markedTransactions = markDuplicates(previewTransactions, duplicateMatches);

    // Update import session with duplicate count
    await db
      .update(csvImports)
      .set({
        duplicatesFound: duplicateMatches.size,
      })
      .where(eq(csvImports.id, importId));

    // Balance verification logic and daily balance extraction
    let balanceVerification: BalanceVerification | undefined;
    let dailyBalances: DailyBalance[] = [];

    // Calculate total fees from CSV if fee column is mapped (only from COMPLETED transactions)
    let totalFees = 0;
    if (feeIdx >= 0) {
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex];
        // Only count fees from completed transactions
        if (stateIndex >= 0 && completedStateValue) {
          const rowState = row[stateIndex]?.toLowerCase()?.trim();
          if (rowState !== completedStateValue) {
            continue; // Skip fees from non-completed transactions
          }
        }
        const fee = parseImportedNumber(row[feeIdx], "fee", rowIndex + 2, numberParseOptions);
        if (fee !== null && fee > 0) {
          totalFees += fee;
        }
      }
      totalFees = Math.round(totalFees * 100) / 100;
    }

    if (mapping.startingBalance || mapping.endingBalance) {
      // Get first row's starting balance, last row's ending balance
      const firstRow = rows[0];
      const lastRow = rows[rows.length - 1];

      const fileStartingBalance = startBalIdx >= 0
        ? parseImportedNumber(firstRow?.[startBalIdx], "starting balance", 2, numberParseOptions)
        : null;
      const fileEndingBalance = endBalIdx >= 0
        ? parseImportedNumber(lastRow?.[endBalIdx], "ending balance", rows.length + 1, numberParseOptions)
        : null;

      // Calculate starting balance from first row's ending balance when no explicit starting balance
      // Formula: balance_before_first_tx = first_ending_balance - first_amount
      // This works because: first_ending_balance = balance_before_first_tx + first_amount
      // Note: Fees are not included here because they affect balance differently and are
      // captured in the daily balances from the CSV which are the source of truth.
      let calculatedStartingBalance: number | null = null;
      if (fileStartingBalance === null && endBalIdx >= 0) {
        const firstRowEndingBalance = parseImportedNumber(firstRow?.[endBalIdx], "ending balance", 2, numberParseOptions);
        const firstRowAmount = amountIndex >= 0
          ? parseImportedNumber(firstRow?.[amountIndex], "amount", 2, numberParseOptions)
          : null;

        if (firstRowEndingBalance !== null && firstRowAmount !== null) {
          // first_ending_balance = starting_balance + first_amount
          // starting_balance = first_ending_balance - first_amount
          calculatedStartingBalance = Math.round((firstRowEndingBalance - firstRowAmount) * 100) / 100;
        }
      }

      // Calculate sum of transactions (credits positive, debits negative)
      const transactionSum = previewTransactions.reduce((sum, tx) => {
        return sum + (tx.transactionType === "credit" ? tx.amount : -Math.abs(tx.amount));
      }, 0);

      // Use explicit starting balance if available, otherwise use calculated
      const effectiveStartingBalance = fileStartingBalance ?? calculatedStartingBalance;

      // Calculate expected ending balance
      // Subtract fees since they affect the balance but aren't in the transaction amounts
      // (e.g., Premium plan fee with Amount=0.00 but Fee=9.99 reduces balance by 9.99)
      const calculatedEndingBalance = effectiveStartingBalance !== null
        ? Math.round((effectiveStartingBalance + transactionSum - totalFees) * 100) / 100
        : null;

      const discrepancy = (fileEndingBalance !== null && calculatedEndingBalance !== null)
        ? Math.round((fileEndingBalance - calculatedEndingBalance) * 100) / 100
        : null;

      const canVerify = effectiveStartingBalance !== null && fileEndingBalance !== null;

      // Calculate suggested starting balance for recalculation
      // Formula: startingBalance = fileEndingBalance - transactionSum
      const suggestedStartingBalance = fileEndingBalance !== null
        ? Math.round((fileEndingBalance - transactionSum) * 100) / 100
        : null;

      balanceVerification = {
        hasBalanceData: fileEndingBalance !== null || effectiveStartingBalance !== null,
        canVerify,
        fileStartingBalance: effectiveStartingBalance, // Use effective (calculated if needed)
        fileEndingBalance,
        calculatedEndingBalance,
        discrepancy,
        isVerified: canVerify && discrepancy !== null && Math.abs(discrepancy) < 0.01,
        importedTransactionSum: Math.round(transactionSum * 100) / 100,
        suggestedStartingBalance,
      };

      // Extract daily balances from CSV rows
      // For each row, we extract the ending balance (or calculate from starting balance + transaction)
      // The last transaction of each day becomes the authoritative balance for that day
      const dailyBalanceMap = new Map<string, number>();

      if (dateIndex >= 0 && (endBalIdx >= 0 || startBalIdx >= 0)) {
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;

          // Only extract balances from completed transactions
          if (stateIndex >= 0 && completedStateValue) {
            const rowState = row[stateIndex]?.toLowerCase()?.trim();
            if (rowState !== completedStateValue) {
              continue; // Skip non-completed transactions for balance extraction
            }
          }

          const dateStr = row[dateIndex];
          if (!dateStr) continue;

          const parsedDate = parseImportDate(
            dateStr,
            mapping.typeConfig?.dateFormat ?? "DD-MM-YYYY"
          );
          if (!parsedDate) continue;

          const isoDate = toInvariantDate(parsedDate);

          // Get balance for this row
          let dayBalance: number | null = null;

          if (endBalIdx >= 0) {
            // Use ending balance directly if available
            dayBalance = parseImportedNumber(row[endBalIdx], "ending balance", i + 2, numberParseOptions);
          } else if (startBalIdx >= 0 && amountIndex >= 0) {
            // Calculate ending balance from starting balance + transaction amount
            const startBal = parseImportedNumber(row[startBalIdx], "starting balance", i + 2, numberParseOptions);
            const amountStr = row[amountIndex];
            const txAmount = parseImportedNumber(amountStr, "amount", i + 2, numberParseOptions);

            if (startBal !== null && txAmount !== null) {
              // For signed amounts, just add directly. For type-based, need to check type
              if (mapping.typeConfig?.isAmountSigned) {
                dayBalance = startBal + txAmount;
              } else {
                // Need to determine if credit or debit
                const typeIndex = mapping.transactionType ? headers.indexOf(mapping.transactionType) : -1;
                let isCredit = false;
                if (typeIndex >= 0 && mapping.typeConfig) {
                  const typeValue = row[typeIndex]?.toLowerCase();
                  if (mapping.typeConfig.creditValue && typeValue?.includes(mapping.typeConfig.creditValue.toLowerCase())) {
                    isCredit = true;
                  }
                }
                dayBalance = startBal + (isCredit ? Math.abs(txAmount) : -Math.abs(txAmount));
              }
            }
          }

          if (dayBalance !== null) {
            // Store balance - last transaction of each day wins (CSV is processed in order)
            dailyBalanceMap.set(isoDate, Math.round(dayBalance * 100) / 100);
          }
        }

        // Convert map to array
        dailyBalances = Array.from(dailyBalanceMap.entries())
          .map(([date, balance]) => ({ date, balance }));
      }
    }

    return { success: true, transactions: markedTransactions, balanceVerification, dailyBalances };
  } catch (error) {
    console.error("Failed to preview transactions:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to preview transactions",
    };
  }
}

/**
 * Generate a deterministic external_id for CSV-imported transactions.
 * This ensures duplicate prevention by creating a unique ID based on transaction data.
 * Format: csv-import-{hash}
 * Hash based on: accountId + date + amount + description + merchant
 * Uses multiple hash functions combined for collision resistance
 */
function generateCsvImportExternalId(
  accountId: string,
  date: string,
  amount: number,
  description: string | null,
  merchant: string | null = null
): string {
  // Create a string to hash - include merchant for better uniqueness
  const dateOnly = date.split('T')[0]; // Use only the date part (YYYY-MM-DD)
  const normalizedDesc = (description || '').trim().toLowerCase();
  const normalizedMerchant = (merchant || '').trim().toLowerCase();
  const dataToHash = `${accountId}|${dateOnly}|${amount.toFixed(2)}|${normalizedDesc}|${normalizedMerchant}`;

  // FNV-1a hash (32-bit)
  let hash1 = 2166136261;
  for (let i = 0; i < dataToHash.length; i++) {
    hash1 ^= dataToHash.charCodeAt(i);
    hash1 += (hash1 << 1) + (hash1 << 4) + (hash1 << 7) + (hash1 << 8) + (hash1 << 24);
  }

  // MurmurHash-inspired second hash (32-bit)
  let hash2 = 0;
  for (let i = 0; i < dataToHash.length; i++) {
    const char = dataToHash.charCodeAt(i);
    hash2 = ((hash2 << 5) - hash2) + char;
    hash2 = hash2 & hash2; // Convert to 32bit integer
  }

  // DJB2 third hash for additional entropy
  let hash3 = 5381;
  for (let i = 0; i < dataToHash.length; i++) {
    hash3 = ((hash3 << 5) + hash3) + dataToHash.charCodeAt(i);
  }

  // Convert all to unsigned 32-bit and combine into a longer hash
  const h1 = (hash1 >>> 0).toString(36);
  const h2 = (hash2 >>> 0).toString(36);
  const h3 = (hash3 >>> 0).toString(36);

  // Combine all three hashes for maximum uniqueness (collision probability ~2^-96)
  return `csv-import-${h1}${h2}${h3}`;
}

// Backend API transaction import item (snake_case format)
interface BackendTransactionImportItem {
  account_id: string;
  amount: number;
  description: string | null;
  merchant: string | null;
  booked_at: string; // ISO datetime string
  transaction_type: "credit" | "debit";
  currency: string;
  external_id: string | null;
}

// Backend daily balance import format
interface BackendDailyBalance {
  date: string;  // ISO date string (YYYY-MM-DD)
  balance: number;
}

// Backend API request format
interface BackendTransactionImportRequest {
  transactions: BackendTransactionImportItem[];
  user_id?: string;
  sync_exchange_rates: boolean;
  update_functional_amounts: boolean;
  calculate_balances: boolean;
  daily_balances?: BackendDailyBalance[];
  starting_balance?: number;  // Starting balance from CSV to update account
}

// Backend API response format
interface BackendTransactionImportResponse {
  success: boolean;
  message: string;
  transactions_inserted: number;
  transaction_ids: string[] | null;
  categorization_summary: {
    total: number;
    categorized: number;
    deterministic: number;
    llm: number;
    uncategorized: number;
    tokens_used: number;
    cost_usd: number;
  } | null;
  exchange_rates_synced: Record<string, unknown> | null;
  functional_amounts_updated: Record<string, unknown> | null;
  balances_calculated: Record<string, unknown> | null;
}

export async function finalizeImport(
  importId: string,
  selectedIndices: number[]
): Promise<{ success: boolean; error?: string; importedCount?: number; categorizationSummary?: BackendTransactionImportResponse["categorization_summary"] }> {
  const access = await getCsvImportAccess();
  if ("error" in access) {
    return { success: false, error: access.error };
  }
  const { session } = access;

  try {
    // Get preview transactions
    const previewResult = await previewImportedTransactions(importId);
    if (!previewResult.success || !previewResult.transactions) {
      return { success: false, error: previewResult.error || "Failed to get preview" };
    }

    // Get the import session
    const importSession = await db.query.csvImports.findFirst({
      where: and(
        eq(csvImports.id, importId),
        eq(csvImports.userId, session.user.id)
      ),
    });

    if (!importSession) {
      return { success: false, error: "Import session not found" };
    }

    // Get account for currency
    const account = await db.query.accounts.findFirst({
      where: eq(accounts.id, importSession.accountId),
    });

    if (!account) {
      return { success: false, error: "Account not found" };
    }

    // Filter to selected transactions
    const selectedTransactions = previewResult.transactions.filter((tx) =>
      selectedIndices.includes(tx.rowIndex)
    );

    if (selectedTransactions.length === 0) {
      return { success: true, importedCount: 0 };
    }

    // Transform transactions to backend format (snake_case)
    // Generate deterministic external_id for each transaction to prevent duplicates
    // Track external_ids to handle same-day duplicate transactions
    const externalIdCounts = new Map<string, number>();

    const backendTransactions: BackendTransactionImportItem[] = selectedTransactions.map((tx) => {
      const bookedAt = new Date(tx.date).toISOString();
      const baseExternalId = generateCsvImportExternalId(
        importSession.accountId,
        bookedAt,
        tx.amount,
        tx.description || null,
        tx.merchant || null
      );

      // Check if we've seen this external_id before in this batch
      const count = externalIdCounts.get(baseExternalId) || 0;
      externalIdCounts.set(baseExternalId, count + 1);

      // If this is a duplicate within the batch, append a counter
      const externalId = count === 0
        ? baseExternalId
        : `${baseExternalId}-${count + 1}`;

      return {
        account_id: importSession.accountId,
        amount: tx.amount,
        description: tx.description || null,
        merchant: tx.merchant || null,
        booked_at: bookedAt,
        transaction_type: tx.transactionType,
        currency: account.currency || "EUR",
        external_id: externalId,
      };
    });

    // Batch the transactions to avoid request timeouts and large payload issues
    // For large imports (>500 transactions), split into batches
    const BATCH_SIZE = 500;
    const backendUrl = getBackendBaseUrl();

    let totalImported = 0;
    let aggregatedCategorizationSummary: BackendTransactionImportResponse["categorization_summary"] = null;

    // Split transactions into batches
    const batches: BackendTransactionImportItem[][] = [];
    for (let i = 0; i < backendTransactions.length; i += BATCH_SIZE) {
      batches.push(backendTransactions.slice(i, i + BATCH_SIZE));
    }

    // Importing transactions in batches

    try {
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        const isLastBatch = batchIndex === batches.length - 1;

        // Build the backend request for this batch
        const backendRequest: BackendTransactionImportRequest = {
          transactions: batch,
          // Only sync exchange rates and calculate balances on the last batch for efficiency
          sync_exchange_rates: isLastBatch,
          update_functional_amounts: isLastBatch,
          calculate_balances: isLastBatch,
          // Only include daily balances and starting balance on the last batch
          daily_balances: isLastBatch ? (previewResult.dailyBalances || undefined) : undefined,
          starting_balance: isLastBatch ? (previewResult.balanceVerification?.fileStartingBalance ?? undefined) : undefined,
        };

        // Call backend API with 5-minute timeout per batch
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5 minutes per batch

        const pathWithQuery = "/api/transactions/import";
        const requestBody = JSON.stringify(backendRequest);
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
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Backend import failed for batch ${batchIndex + 1}/${batches.length}:`, response.status, errorText);
          return {
            success: false,
            error: `Import failed on batch ${batchIndex + 1}/${batches.length}: ${response.status} - ${errorText}. ${totalImported} transactions were imported before the failure.`
          };
        }

        const backendResponse: BackendTransactionImportResponse = await response.json();

        if (!backendResponse.success) {
          return {
            success: false,
            error: `Batch ${batchIndex + 1}/${batches.length} failed: ${backendResponse.message}. ${totalImported} transactions were imported before the failure.`
          };
        }

        totalImported += backendResponse.transactions_inserted;

        // Aggregate categorization summary from all batches
        if (backendResponse.categorization_summary) {
          if (!aggregatedCategorizationSummary) {
            aggregatedCategorizationSummary = { ...backendResponse.categorization_summary };
          } else {
            aggregatedCategorizationSummary.total += backendResponse.categorization_summary.total;
            aggregatedCategorizationSummary.categorized += backendResponse.categorization_summary.categorized;
            aggregatedCategorizationSummary.deterministic += backendResponse.categorization_summary.deterministic;
            aggregatedCategorizationSummary.llm += backendResponse.categorization_summary.llm;
            aggregatedCategorizationSummary.uncategorized += backendResponse.categorization_summary.uncategorized;
            aggregatedCategorizationSummary.tokens_used += backendResponse.categorization_summary.tokens_used;
            aggregatedCategorizationSummary.cost_usd += backendResponse.categorization_summary.cost_usd;
          }
        }

        // Batch completed successfully
      }

      // Update import session
      await db
        .update(csvImports)
        .set({
          status: "completed",
          importedRows: totalImported,
          completedAt: new Date(),
        })
        .where(eq(csvImports.id, importId));

      // Revalidate all relevant paths to ensure UI updates
      revalidatePath("/transactions");
      revalidatePath("/");
      revalidatePath("/dashboard");
      revalidatePath("/settings");

      return {
        success: true,
        importedCount: totalImported,
        categorizationSummary: aggregatedCategorizationSummary,
      };
    } catch (fetchError) {
      if (fetchError instanceof Error && fetchError.name === "AbortError") {
        console.error("Import timeout during batch processing");
        return {
          success: false,
          error: `Import timeout: The operation took too long. ${totalImported} transactions were imported before the timeout.`
        };
      }
      throw fetchError; // Re-throw to outer catch
    }
  } catch (error) {
    console.error("Failed to finalize import:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to import transactions" };
  }
}

// Backend enqueue response type
interface BackendEnqueueResponse {
  success: boolean;
  import_id: string;
  task_id: string | null;
  message: string;
}

/**
 * Enqueue a CSV import for background processing.
 * This allows immediate redirect while the import processes in the background.
 *
 * @param importId - The CSV import session ID
 * @param selectedIndices - Array of row indices selected for import
 * @returns Success status with import details for SSE connection
 */
export async function enqueueBackgroundImport(
  importId: string,
  selectedIndices: number[]
): Promise<{
  success: boolean;
  error?: string;
  importId?: string;
  taskId?: string;
  totalTransactions?: number;
}> {
  const access = await getCsvImportAccess();
  if ("error" in access) {
    return { success: false, error: access.error };
  }
  const { session } = access;

  try {
    // Get preview transactions
    const previewResult = await previewImportedTransactions(importId);
    if (!previewResult.success || !previewResult.transactions) {
      return { success: false, error: previewResult.error || "Failed to get preview" };
    }

    // Get the import session
    const importSession = await db.query.csvImports.findFirst({
      where: and(
        eq(csvImports.id, importId),
        eq(csvImports.userId, session.user.id)
      ),
    });

    if (!importSession) {
      return { success: false, error: "Import session not found" };
    }

    // Get account for currency
    const account = await db.query.accounts.findFirst({
      where: eq(accounts.id, importSession.accountId),
    });

    if (!account) {
      return { success: false, error: "Account not found" };
    }

    // Filter to selected transactions
    const selectedTransactions = previewResult.transactions.filter((tx) =>
      selectedIndices.includes(tx.rowIndex)
    );

    if (selectedTransactions.length === 0) {
      return { success: true, importId, totalTransactions: 0 };
    }

    // Transform transactions to backend format
    const externalIdCounts = new Map<string, number>();

    const transactions = selectedTransactions.map((tx) => {
      const bookedAt = new Date(tx.date).toISOString();
      const baseExternalId = generateCsvImportExternalId(
        importSession.accountId,
        bookedAt,
        tx.amount,
        tx.description || null,
        tx.merchant || null
      );

      const count = externalIdCounts.get(baseExternalId) || 0;
      externalIdCounts.set(baseExternalId, count + 1);

      const externalId = count === 0
        ? baseExternalId
        : `${baseExternalId}-${count + 1}`;

      return {
        account_id: importSession.accountId,
        amount: tx.amount,
        description: tx.description || null,
        merchant: tx.merchant || null,
        booked_at: bookedAt,
        transaction_type: tx.transactionType,
        currency: account.currency || "EUR",
        external_id: externalId,
        category_id: null,
      };
    });

    // Build enqueue request
    const backendUrl = getBackendBaseUrl();
    const enqueueRequest = {
      csv_import_id: importId,
      transactions,
      daily_balances: previewResult.dailyBalances || undefined,
      starting_balance: previewResult.balanceVerification?.fileStartingBalance ?? undefined,
    };

    // Call backend enqueue endpoint
    const pathWithQuery = "/api/csv-import/enqueue";
    const requestBody = JSON.stringify(enqueueRequest);
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
      console.error("Backend enqueue failed:", response.status, errorText);
      return {
        success: false,
        error: `Failed to start import: ${response.status} - ${errorText}`,
      };
    }

    const backendResponse: BackendEnqueueResponse = await response.json();

    if (!backendResponse.success) {
      return {
        success: false,
        error: backendResponse.message,
      };
    }

    // Background import enqueued successfully

    return {
      success: true,
      importId: backendResponse.import_id,
      taskId: backendResponse.task_id || undefined,
      totalTransactions: transactions.length,
    };
  } catch (error) {
    console.error("Failed to enqueue background import:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to start import",
    };
  }
}

export async function getCsvImportSession(
  importId: string
): Promise<CsvImportSession | null> {
  const access = await getCsvImportAccess();
  if ("error" in access) {
    return null;
  }
  const { userId } = access;

  const importSession = await db.query.csvImports.findFirst({
    where: and(
      eq(csvImports.id, importId),
      eq(csvImports.userId, userId)
    ),
  });

  if (!importSession) {
    return null;
  }

  return {
    id: importSession.id,
    accountId: importSession.accountId,
    fileName: importSession.fileName,
    status: importSession.status || "pending",
    columnMapping: importSession.columnMapping
      ? normalizeColumnMapping(importSession.columnMapping as ColumnMapping)
      : null,
    totalRows: importSession.totalRows,
  };
}

// ============================================================================
// Import History
// ============================================================================

/**
 * Returns all CSV imports for the current user, enriched with linked transaction counts.
 */
export async function getCsvImportHistory(): Promise<CsvImportWithStats[]> {
  const userId = await requireAuth();
  // Return type is CsvImportWithStats[] (not a result object), so return empty on auth failure.
  if (!userId) return [];

  const imports = await db.query.csvImports.findMany({
    where: eq(csvImports.userId, userId),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    with: { account: { columns: { id: true, name: true, currency: true } } },
  });

  if (!imports.length) return [];

  const importIds = imports.map((i) => i.id);

  // Single aggregation query replaces the previous N+1 loop (2 queries per import).
  // COUNT(*) FILTER is standard PostgreSQL syntax supported by Drizzle's sql`` tag.
  const counts = await db
    .select({
      csvImportId: transactions.csvImportId,
      total: sql<string>`COUNT(*)`,
      edited: sql<string>`COUNT(*) FILTER (
        WHERE ${transactions.categoryId} IS NOT NULL
        AND ${transactions.categoryId} != ${transactions.categorySystemId}
      )`,
    })
    .from(transactions)
    .where(
      and(
        inArray(transactions.csvImportId, importIds),
        eq(transactions.userId, userId)
      )
    )
    .groupBy(transactions.csvImportId);

  const countMap = new Map(counts.map((r) => [r.csvImportId, r]));

  return imports.map((imp) => {
    const row = countMap.get(imp.id);
    return {
      id: imp.id,
      fileName: imp.fileName,
      status: imp.status,
      importedRows: imp.importedRows,
      totalRows: imp.totalRows,
      createdAt: imp.createdAt,
      completedAt: imp.completedAt,
      account: imp.account ?? null,
      transactionCount: parseInt(row?.total ?? "0", 10),
      hasEditedTransactions: parseInt(row?.edited ?? "0", 10) > 0,
    };
  });
}

/**
 * Reverts a CSV import by deleting all transactions linked to it.
 * Reuses deleteTransactions for atomic deletion and balance recalculation.
 */
export async function revertCsvImport(
  importId: string
): Promise<{ success: boolean; error?: string; deletedCount?: number }> {
  const session = await getAuthenticatedSession();
  const userId = session?.user?.id ?? null;
  if (!userId) return { success: false, error: "Not authenticated" };
  if (isDemoRestrictedUserEmail(session?.user?.email)) {
    return { success: false, error: DEMO_RESTRICTED_ACTION_ERROR };
  }

  // Verify the import belongs to this user
  const csvImport = await db.query.csvImports.findFirst({
    where: and(eq(csvImports.id, importId), eq(csvImports.userId, userId)),
  });
  if (!csvImport) return { success: false, error: "Import not found" };

  // Find all transactions linked to this import
  const linkedTransactions = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.csvImportId, importId), eq(transactions.userId, userId)));

  if (!linkedTransactions.length) {
    return { success: false, error: "No transactions linked to this import. It may predate import tracking." };
  }

  const transactionIds = linkedTransactions.map((t) => t.id);

  // Reuse deleteTransactions for atomic deletion + balance recalculation
  const result = await deleteTransactions(transactionIds);

  if (!result.success) return { success: false, error: result.error };

  return { success: true, deletedCount: result.deletedCount };
}
