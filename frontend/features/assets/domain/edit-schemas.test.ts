import { describe, expect, it } from "vitest";
import { accountEditSchema, propertyEditSchema, vehicleEditSchema } from "./edit-schemas";

const owner = [{ personId: "person-1", share: null }];

describe("asset edit schemas", () => {
  it("requires a named account with at least one owner", () => {
    expect(accountEditSchema.safeParse({ name: "", accountType: "checking", institution: "", currency: "EUR", balance: "10", logoId: null, logoUrl: null, logoUpdatedAt: null, owners: [] }).success).toBe(false);
  });

  it("accepts property money values", () => {
    expect(propertyEditSchema.safeParse({ name: "Home", propertyType: "residential", address: "", currentValue: "250000.50", currency: "EUR", owners: owner }).success).toBe(true);
  });

  it("rejects malformed vehicle years", () => {
    expect(vehicleEditSchema.safeParse({ name: "Car", vehicleType: "car", make: "", model: "", year: "20", currentValue: "1000", currency: "EUR", owners: owner }).success).toBe(false);
  });
});
