import { logger } from "@/lib/logger";
import type { TransactionListItem } from "../domain/contracts";

export interface TransactionListRow {
  id: string;
  accountId: string;
  description: string | null;
  merchant: string | null;
  creditor: string | null;
  debtor: string | null;
  amount: string;
  currency: string | null;
  categoryId: string | null;
  categorySystemId: string | null;
  recurringTransactionId: string | null;
  bookedAt: Date;
  pending: boolean | null;
  transactionType: string | null;
  includeInAnalytics: boolean;
  logoId: string | null;
  logo: { id: string; logoUrl: string | null; updatedAt: Date | null } | null;
  account: {
    id: string;
    name: string;
    institution: string | null;
    accountType: string;
    logoId: string | null;
    logo: { id: string; logoUrl: string | null; updatedAt: Date | null } | null;
  } | null;
  category: {
    id: string;
    name: string;
    color: string | null;
    icon: string | null;
  } | null;
  categorySystem: {
    id: string;
    name: string;
    color: string | null;
    icon: string | null;
  } | null;
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
    sourceTxnId: string;
    mirrorTxnId: string | null;
    sourceAccount: { id: string; name: string } | null;
    pocketAccount: { id: string; name: string } | null;
  } | null;
}

export function mapTransactionListRow(
  row: TransactionListRow,
): TransactionListItem | null {
  if (!row.account) return null;

  return {
    id: row.id,
    accountId: row.accountId,
    account: {
      id: row.account.id,
      name: row.account.name,
      institution: row.account.institution,
      accountType: row.account.accountType,
      logo: row.account.logo
        ? {
            id: row.account.logo.id,
            logoUrl: row.account.logo.logoUrl,
            updatedAt: row.account.logo.updatedAt,
          }
        : null,
    },
    description: row.description,
    merchant: row.merchant,
    merchantLogoId: row.logoId,
    merchantLogo: row.logo
      ? {
          id: row.logo.id,
          logoUrl: row.logo.logoUrl,
          updatedAt: row.logo.updatedAt,
        }
      : null,
    creditor: row.creditor,
    debtor: row.debtor,
    amount: Number.parseFloat(row.amount),
    currency: row.currency,
    categoryId: row.categoryId,
    category: row.category,
    categorySystemId: row.categorySystemId,
    categorySystem: row.categorySystem,
    recurringTransactionId: row.recurringTransactionId,
    recurringTransaction: row.recurringTransaction,
    transactionLink: row.transactionLink,
    internalTransferId: row.internalTransferId,
    internalTransfer: row.internalTransfer
      ? {
          id: row.internalTransfer.id,
          sourceTransactionId: row.internalTransfer.sourceTxnId,
          mirrorTransactionId: row.internalTransfer.mirrorTxnId,
          sourceAccount: row.internalTransfer.sourceAccount,
          pocketAccount: row.internalTransfer.pocketAccount,
        }
      : null,
    bookedAt: row.bookedAt,
    pending: row.pending,
    transactionType: row.transactionType,
    includeInAnalytics: row.includeInAnalytics,
  };
}

export function mapTransactionListRows(
  rows: TransactionListRow[],
  onMissingAccount?: (row: TransactionListRow) => void,
): TransactionListItem[] {
  return rows.flatMap((row) => {
    const mapped = mapTransactionListRow(row);
    if (mapped) return [mapped];
    onMissingAccount?.(row);
    return [];
  });
}

export function mapTransactionRowsForUi(
  rows: TransactionListRow[],
  contextLabel: string,
): TransactionListItem[] {
  return mapTransactionListRows(rows, (row) =>
    logger.warn(`[${contextLabel}] Transaction missing account relation`, {
      transactionId: row.id,
      accountId: row.accountId,
    }),
  );
}
