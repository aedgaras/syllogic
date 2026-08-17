import type { SupportedHorizon } from "@/lib/dashboard/query-params";

export type TransactionSortField = "bookedAt" | "amount" | "description" | "merchant";
export type TransactionSortOrder = "asc" | "desc";

export interface TransactionFilters {
  search?: string;
  category: string[];
  accountIds: string[];
  status: string[];
  subscription: string[];
  analytics: string[];
  minAmount?: string;
  maxAmount?: string;
  from?: string;
  to?: string;
  horizon?: SupportedHorizon;
}

export interface TransactionsQueryState extends TransactionFilters {
  page: number;
  pageSize: number;
  sort: TransactionSortField;
  order: TransactionSortOrder;
}

export interface TransactionCategory {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
}

export interface TransactionListItem {
  id: string;
  accountId: string;
  account: {
    id: string;
    name: string;
    institution: string | null;
    accountType: string;
    logo: { id: string; logoUrl: string | null; updatedAt?: Date | null } | null;
  } | null;
  description: string | null;
  merchant: string | null;
  creditor: string | null;
  debtor: string | null;
  amount: number;
  currency: string | null;
  categoryId: string | null;
  category: TransactionCategory | null;
  categorySystemId: string | null;
  categorySystem: TransactionCategory | null;
  recurringTransactionId: string | null;
  recurringTransaction: {
    id: string;
    name: string;
    merchant: string | null;
    frequency: string;
  } | null;
  transactionLink: { groupId: string; linkRole: string } | null;
  internalTransferId: string | null;
  internalTransfer: {
    id: string;
    sourceTransactionId?: string;
    mirrorTransactionId?: string | null;
    sourceAccount?: { id: string; name: string } | null;
    pocketAccount: { id: string; name: string } | null;
  } | null;
  bookedAt: Date;
  pending: boolean | null;
  transactionType: string | null;
  includeInAnalytics: boolean;
}

export interface FilteredTransactionTotals {
  totalIn: number;
  totalOut: number;
}

export interface AccountDeleteImpact {
  accountId: string;
  accountName: string;
  currency: string;
  amountChange: number;
  currentBalance: number;
  projectedBalance: number;
  balanceIsAnchored: boolean;
}

export interface DeleteImpact {
  accountImpacts: AccountDeleteImpact[];
  totalTransactions: number;
  earliestDate: Date;
}

export interface SuggestedTransactionLink {
  id: string;
  amount: number;
  description: string | null;
  merchant: string | null;
  bookedAt: Date;
  transactionType: string | null;
  accountId: string;
  accountName: string | null;
  score: number;
}

export interface TransactionLinkSearchFilters {
  searchQuery?: string;
  accountId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  minAmount?: number;
  maxAmount?: number;
  page?: number;
  pageSize?: number;
}

export interface TransactionLinkAccountOption {
  id: string;
  name: string;
}

export interface LinkedTransactionItem {
  id: string;
  amount: number;
  description: string | null;
  merchant: string | null;
  bookedAt: Date;
  transactionType: string | null;
  linkRole: "primary" | "reimbursement" | "expense";
}

export interface TransactionLinkGroup {
  groupId: string;
  primary: LinkedTransactionItem | null;
  linked: LinkedTransactionItem[];
  netAmount: number;
  currency: string | null;
}

export interface TransactionPage {
  rows: TransactionListItem[];
  totalCount: number;
  filteredTotals: FilteredTransactionTotals | null;
  page: number;
  pageSize: number;
  resolvedFrom?: string;
  resolvedTo?: string;
  effectiveHorizon?: number;
}

export interface CreateTransactionInput {
  accountId: string;
  amount: number;
  description: string;
  categoryId?: string;
  bookedAt: Date;
  transactionType: "debit" | "credit";
  merchant?: string;
}

export interface UpdateTransactionInput extends Omit<CreateTransactionInput, "categoryId"> {
  transactionId: string;
  categoryId?: string | null;
}

export interface CreateTransferTransactionInput {
  sourceAccountId: string;
  destinationAccountId: string;
  amount: number;
  description: string;
  bookedAt: Date;
}

export interface ConvertTransactionToTransferInput extends CreateTransferTransactionInput {
  transactionId: string;
}

export type TransactionMutationErrorCode =
  | "NOT_AUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "INTERNAL_ERROR";

export type TransactionMutationOutcome =
  | { success: true; transactionId?: string }
  | { success: false; error: string; code?: TransactionMutationErrorCode };

/** Temporary source-compatible names while non-list transaction callers migrate. */
export type TransactionWithRelations = TransactionListItem;
export type TransactionsPageResult = TransactionPage;
