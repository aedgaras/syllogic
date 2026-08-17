import { describe, expect, it, vi } from "vitest";
import {
  recalculateAccountTimeseriesUseCase,
  recalculateStartingBalanceUseCase,
  type AccountRecalculationDependencies,
} from "./recalculate-account";

function dependencies(): AccountRecalculationDependencies {
  return {
    findAccount: vi.fn().mockResolvedValue({ startingBalance: "100" }),
    transactionSum: vi.fn().mockResolvedValue(25),
    updateBalances: vi.fn().mockResolvedValue(undefined),
    recalculateTimeseries: vi.fn().mockResolvedValue({
      message: "done",
      days_processed: 10,
      records_stored: 10,
    }),
  };
}

describe("account recalculation use cases", () => {
  it("updates the derived starting balance and tolerates an unavailable timeseries gateway", async () => {
    const deps = dependencies();
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    vi.mocked(deps.recalculateTimeseries).mockRejectedValue(
      new Error("offline"),
    );
    await expect(
      recalculateStartingBalanceUseCase(deps, {
        userId: "user-1",
        accountId: "account-1",
        knownCurrentBalance: 150,
      }),
    ).resolves.toEqual({ success: true, newStartingBalance: 125 });
    expect(deps.updateBalances).toHaveBeenCalledWith("account-1", {
      startingBalance: 125,
      functionalBalance: 150,
    });
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });

  it("recalculates the functional balance after the backend timeseries", async () => {
    const deps = dependencies();
    await expect(
      recalculateAccountTimeseriesUseCase(deps, {
        userId: "user-1",
        accountId: "account-1",
      }),
    ).resolves.toMatchObject({
      success: true,
      daysProcessed: 10,
      recordsStored: 10,
    });
    expect(deps.updateBalances).toHaveBeenCalledWith("account-1", {
      functionalBalance: 125,
    });
  });

  it("does not mutate an account that is not owned by the user", async () => {
    const deps = dependencies();
    vi.mocked(deps.findAccount).mockResolvedValue(undefined);
    await expect(
      recalculateAccountTimeseriesUseCase(deps, {
        userId: "user-1",
        accountId: "missing",
      }),
    ).resolves.toEqual({ success: false, error: "Account not found" });
    expect(deps.recalculateTimeseries).not.toHaveBeenCalled();
  });
});
