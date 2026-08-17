import { describe, expect, it } from "vitest";
import { toAccountAssetViewModel, toPropertyAssetViewModel, toVehicleAssetViewModel } from "./view-model.mapper";

describe("asset view-model mappers", () => {
  it("projects persistence rows into narrow asset contracts", () => {
    const account = toAccountAssetViewModel({ id: "a1", name: "Daily", accountType: "checking", institution: null, currency: null, functionalBalance: null, logo: null } as never, ["p1"]);
    const property = toPropertyAssetViewModel({ id: "p1", name: "Home", propertyType: "residential", address: null, currency: "EUR", currentValue: "10" } as never);
    const vehicle = toVehicleAssetViewModel({ id: "v1", name: "Car", vehicleType: "car", make: null, model: null, year: null, currency: "EUR", currentValue: "5" } as never);
    expect(account).toEqual(expect.objectContaining({ id: "a1", balance: "0", currency: "EUR", ownerIds: ["p1"] }));
    expect(property).toEqual(expect.objectContaining({ id: "p1", value: "10" }));
    expect(vehicle).toEqual(expect.objectContaining({ id: "v1", value: "5" }));
    expect(account).not.toHaveProperty("userId");
  });
});
