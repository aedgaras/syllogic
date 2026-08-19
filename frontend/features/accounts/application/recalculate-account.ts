import { logger } from "@/lib/logger";
import {
  calculateBalance,
  calculateStartingBalance,
} from "../domain/balance-history";
import type { RecalculateAccountResult } from "../domain/contracts";

interface AccountBalanceRecord {
  startingBalance: string | null;
}

interface RecalculationResponse {
  message?: string;
  days_processed?: number;
  records_stored?: number;
}

export interface AccountRecalculationDependencies {
  findAccount(
    userId: string,
    accountId: string,
  ): Promise<AccountBalanceRecord | undefined>;
  transactionSum(userId: string, accountId: string): Promise<number>;
  updateBalances(
    userId: string,
    accountId: string,
    values: { startingBalance?: number; functionalBalance: number },
  ): Promise<void>;
  recalculateTimeseries(
    accountId: string,
    userId: string,
  ): Promise<RecalculationResponse>;
}

export async function recalculateStartingBalanceUseCase(
  dependencies: AccountRecalculationDependencies,
  input: { userId: string; accountId: string; knownCurrentBalance: number },
): Promise<RecalculateAccountResult> {
  if (!(await dependencies.findAccount(input.userId, input.accountId))) {
    return { success: false, error: "Account not found" };
  }
  const newStartingBalance = calculateStartingBalance(
    input.knownCurrentBalance,
    await dependencies.transactionSum(input.userId, input.accountId),
  );
  await dependencies.updateBalances(input.userId, input.accountId, {
    startingBalance: newStartingBalance,
    functionalBalance: input.knownCurrentBalance,
  });
  try {
    await dependencies.recalculateTimeseries(input.accountId, input.userId);
  } catch (error) {
    logger.warn("Failed to trigger backend timeseries recalculation", { error });
  }
  return { success: true, newStartingBalance };
}

export async function recalculateAccountTimeseriesUseCase(
  dependencies: AccountRecalculationDependencies,
  input: { userId: string; accountId: string },
): Promise<RecalculateAccountResult> {
  const account = await dependencies.findAccount(input.userId, input.accountId);
  if (!account) return { success: false, error: "Account not found" };
  const response = await dependencies.recalculateTimeseries(
    input.accountId,
    input.userId,
  );
  await dependencies.updateBalances(input.userId, input.accountId, {
    functionalBalance: calculateBalance(
      Number.parseFloat(account.startingBalance ?? "0"),
      await dependencies.transactionSum(input.userId, input.accountId),
    ),
  });
  return {
    success: true,
    message: response.message ?? "Balance recalculated successfully",
    daysProcessed: response.days_processed,
    recordsStored: response.records_stored,
  };
}
