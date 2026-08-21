export interface AccountLogoViewModel {
  id: string;
  logoUrl: string | null;
  updatedAt: string | null;
}

export interface AccountViewModel {
  id: string;
  name: string;
  accountType: string;
  institution: string | null;
  currency: string;
  provider: string | null;
  startingBalance: string;
  functionalBalance: string;
  creditLimit: string | null;
  lastSyncedAt: string | null;
  logo: AccountLogoViewModel | null;
}

export interface CreateAccountInput {
  name: string;
  accountType: string;
  institution?: string;
  currency: string;
  startingBalance?: number;
  creditLimit?: number;
}

export interface UpdateAccountInput
  extends Partial<Omit<CreateAccountInput, "creditLimit">> {
  logoId?: string | null;
  creditLimit?: number | null;
}

export interface CreatePocketAccountInput {
  name: string;
  accountType?: string;
  currency?: string;
  startingBalance?: number;
  iban: string;
}

export interface AccountActionResult {
  success: boolean;
  error?: string;
}

export interface CreateAccountResult extends AccountActionResult {
  accountId?: string;
  backfilledCount?: number;
}

export interface DeleteAccountResult extends AccountActionResult {
  deletedTransactions?: number;
  deletedBalances?: number;
}

export interface RecalculateAccountResult extends AccountActionResult {
  message?: string;
  daysProcessed?: number;
  recordsStored?: number;
  newStartingBalance?: number;
}

export interface BalanceHistoryPoint {
  date: string;
  balance: number;
}

export interface BalanceOnDateResult {
  balance: number;
  found: boolean;
}
