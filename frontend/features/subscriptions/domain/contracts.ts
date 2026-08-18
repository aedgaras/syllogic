export const subscriptionFrequencies = [
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "yearly",
] as const;

export type SubscriptionFrequency = (typeof subscriptionFrequencies)[number];

export interface SubscriptionAccountRef {
  id: string;
  name: string;
}

export interface SubscriptionCategoryRef {
  id: string;
  name: string;
  color: string | null;
}

export interface SubscriptionLogoRef {
  id: string;
  logoUrl: string | null;
  updatedAt?: Date | null;
}

export interface SubscriptionViewModel {
  id: string;
  accountId: string | null;
  name: string;
  merchant: string | null;
  amount: string;
  currency: string | null;
  categoryId: string | null;
  logoId: string | null;
  importance: number;
  frequency: SubscriptionFrequency;
  isActive: boolean | null;
  description: string | null;
  nextDueDate: string | null;
  endDate: string | null;
  autoGenerate: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
  account?: SubscriptionAccountRef | null;
  category?: SubscriptionCategoryRef | null;
  logo?: SubscriptionLogoRef | null;
}

export interface SubscriptionSuggestionViewModel {
  id: string;
  suggestedName: string;
  suggestedMerchant: string | null;
  suggestedAmount: string;
  currency: string;
  detectedFrequency: SubscriptionFrequency;
  confidence: number;
  accountId: string | null;
  suggestedCategoryId: string | null;
  matchedTransactionIds: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  matchCount: number;
  accountName?: string | null;
  suggestedCategoryName?: string | null;
}

export interface SubscriptionKpis {
  activeCount: number;
  monthlyTotal: number;
  allTimeTotal: number;
  currency: string;
}

export interface SubscriptionCreateInput {
  accountId: string;
  name: string;
  merchant?: string;
  amount: number;
  currency?: string;
  categoryId?: string;
  logoId?: string;
  importance: number;
  frequency: SubscriptionFrequency;
  description?: string;
  nextDueDate?: string | null;
  endDate?: string | null;
  autoGenerate?: boolean;
}

export interface SubscriptionUpdateInput {
  accountId?: string;
  name?: string;
  merchant?: string;
  amount?: number;
  currency?: string;
  categoryId?: string;
  logoId?: string | null;
  importance?: number;
  frequency?: SubscriptionFrequency;
  description?: string;
  isActive?: boolean;
  nextDueDate?: string | null;
  endDate?: string | null;
  autoGenerate?: boolean;
}

export interface MatchedTransaction {
  id: string;
  amount: number;
  bookedAt: Date;
  merchant: string | null;
  description: string | null;
}

export interface SubscriptionDetectionResult {
  success: boolean;
  error?: string;
  detectedFrequency?: SubscriptionFrequency;
  confidence: number;
  matchedTransactions: MatchedTransaction[];
  suggestedName: string;
  suggestedAmount: number;
  suggestedMerchant: string | null;
}

export interface PotentialMatch {
  transactionId: string;
  subscriptionId: string;
  transaction: {
    id: string;
    merchant: string | null;
    amount: string;
    description: string | null;
    bookedAt: Date;
    accountName: string;
  };
  subscription: {
    id: string;
    name: string;
    merchant: string | null;
    amount: string;
  };
  matchScore: number;
  matchReason: string;
}

export interface LinkedSubscriptionTransaction {
  id: string;
  merchant: string | null;
  description: string | null;
  amount: string;
  bookedAt: Date;
  account: { name: string } | null;
  category: { id: string; name: string; color: string | null } | null;
}

export interface SubscriptionListRow {
  id: string;
  name: string;
  amount: string;
  currency: string | null;
  frequency: string;
  isActive?: boolean | null;
  isSuggestion?: boolean;
  confidence?: number;
  matchCount?: number;
  merchant?: string | null;
  importance?: number;
  accountId?: string | null;
  accountName?: string | null;
  account?: SubscriptionAccountRef | null;
  category?: SubscriptionCategoryRef | null;
  logoUrl?: string | null;
  nextDueDate?: string | null;
  autoGenerate?: boolean;
}
