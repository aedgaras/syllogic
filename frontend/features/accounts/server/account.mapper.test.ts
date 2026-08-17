import { describe, expect, it } from "vitest";
import { toAccountViewModel } from "./account.mapper";

describe("toAccountViewModel", () => {
  it("maps persistence values to the public account contract", () => {
    expect(
      toAccountViewModel({
        id: "account-1",
        name: "Checking",
        accountType: "checking",
        institution: null,
        currency: null,
        provider: "manual",
        startingBalance: null,
        functionalBalance: "42.00",
        lastSyncedAt: new Date("2026-08-17T12:00:00Z"),
        logo: null,
      }),
    ).toMatchObject({
      currency: "EUR",
      startingBalance: "0",
      functionalBalance: "42.00",
      lastSyncedAt: "2026-08-17T12:00:00.000Z",
    });
  });
});
