import type { AmountFormat } from "@/lib/import/parsing";
import type { ImportDateFormat } from "@/lib/import/dates";

export type ImportContext = "dashboard" | "onboarding";

export interface ImportAccount {
  id: string;
  name: string;
  institution: string | null;
  accountType: string;
  currency: string | null;
}

export interface ColumnMapping {
  date: string | null;
  amount: string | null;
  description: string | null;
  merchant: string | null;
  transactionType: string | null;
  fee: string | null;
  state: string | null;
  startingBalance: string | null;
  endingBalance: string | null;
  typeConfig?: {
    creditValue?: string;
    debitValue?: string;
    isAmountSigned?: boolean;
    amountFormat?: AmountFormat;
    dateFormat?: ImportDateFormat;
    completedStateValue?: string;
  };
}

export interface BalanceVerification {
  hasBalanceData: boolean;
  canVerify: boolean;
  fileStartingBalance: number | null;
  fileEndingBalance: number | null;
  calculatedEndingBalance: number | null;
  discrepancy: number | null;
  isVerified: boolean;
  importedTransactionSum: number | null;
  suggestedStartingBalance: number | null;
}

export interface ParsedCsvData {
  headers: string[];
  rows: string[][];
  sampleRows: string[][];
}

export interface CsvImportSession {
  id: string;
  accountId: string;
  fileName: string;
  status: string;
  columnMapping: ColumnMapping | null;
  totalRows: number | null;
  parsedData?: ParsedCsvData;
}

export interface PreviewTransaction {
  rowIndex: number;
  date: string;
  amount: number;
  description: string;
  merchant?: string;
  transactionType: "debit" | "credit";
  isDuplicate?: boolean;
  duplicateOf?: string;
}

export interface DailyBalance {
  date: string;
  balance: number;
}

export interface CsvImportWithStats {
  id: string;
  fileName: string;
  status: string | null;
  importedRows: number | null;
  totalRows: number | null;
  createdAt: Date | null;
  completedAt: Date | null;
  account: { id: string; name: string; currency: string | null } | null;
  transactionCount: number;
  hasEditedTransactions: boolean;
}
