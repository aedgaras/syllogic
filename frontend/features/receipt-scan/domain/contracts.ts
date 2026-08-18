export interface ReceiptScanAccount {
  id: string;
  name: string;
  currency: string | null;
}

export interface ReceiptLineItem {
  /** Stable client-side key so rows can be edited/split/removed reliably. */
  key: string;
  description: string;
  amount: string;
  categoryId: string | null;
  categoryName: string | null;
  transactionType: "debit" | "credit";
}

export interface ReceiptScanResult {
  receiptScanId: string;
  status: string;
  merchantName: string | null;
  receiptTotal: string | null;
  items: ReceiptLineItem[];
}
