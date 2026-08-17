import { describe, expect, it } from "vitest";
import { validateOidcConfig } from "@/lib/oidc-config";

const validConfig = {
  enabled: true,
  displayName: " Authentik ",
  discoveryUrl: "https://auth.example.com/application/o/syllogic/.well-known/openid-configuration",
  clientId: " client-id ",
  clientSecret: " secret ",
  allowSignUp: true,
};

describe("validateOidcConfig", () => {
  it("normalizes a complete enabled configuration", () => {
    expect(validateOidcConfig(validConfig)).toEqual({
      ...validConfig,
      displayName: "Authentik",
      clientId: "client-id",
      clientSecret: "secret",
    });
  });

  it("requires complete credentials when enabled", () => {
    expect(() => validateOidcConfig({ ...validConfig, clientSecret: "" })).toThrow(
      "required before enabling OIDC"
    );
  });

  it("rejects insecure remote discovery URLs", () => {
    expect(() =>
      validateOidcConfig({ ...validConfig, discoveryUrl: "http://auth.example.com/.well-known/openid-configuration" })
    ).toThrow("must use HTTPS");
  });

  it("allows HTTP discovery for local development", () => {
    expect(
      validateOidcConfig({
        ...validConfig,
        discoveryUrl: "http://localhost:9000/application/o/test/.well-known/openid-configuration",
      }).discoveryUrl
    ).toBe("http://localhost:9000/application/o/test/.well-known/openid-configuration");
  });
});
