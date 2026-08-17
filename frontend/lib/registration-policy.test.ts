import { describe, expect, it } from "vitest";
import { resolveRegistrationEnabled } from "@/lib/registration-policy";

describe("resolveRegistrationEnabled", () => {
  it("allows the bootstrap user even when deployment signups are disabled", () => {
    expect(
      resolveRegistrationEnabled({
        hasUsers: false,
        environmentDisabled: true,
        databaseEnabled: false,
      }),
    ).toBe(true);
  });

  it("allows normal registration when both controls permit it", () => {
    expect(
      resolveRegistrationEnabled({
        hasUsers: true,
        environmentDisabled: false,
        databaseEnabled: true,
      }),
    ).toBe(true);
  });

  it("honors the administrator setting after bootstrap", () => {
    expect(
      resolveRegistrationEnabled({
        hasUsers: true,
        environmentDisabled: false,
        databaseEnabled: false,
      }),
    ).toBe(false);
  });

  it("honors the deployment hard override after bootstrap", () => {
    expect(
      resolveRegistrationEnabled({
        hasUsers: true,
        environmentDisabled: true,
        databaseEnabled: true,
      }),
    ).toBe(false);
  });
});
