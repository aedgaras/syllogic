import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateOidcConfig } from "@/lib/oidc-config";

const validConfig = {
  enabled: true,
  displayName: " Authentik ",
  discoveryUrl:
    "https://auth.example.com/application/o/syllogic/.well-known/openid-configuration",
  clientId: " client-id ",
  clientSecret: " secret ",
  allowSignUp: true,
};

const validDiscoveryDocument = {
  issuer: "https://auth.example.com/application/o/syllogic/",
  authorization_endpoint:
    "https://auth.example.com/application/o/authorize/",
  token_endpoint: "https://auth.example.com/application/o/token/",
};

describe("validateOidcConfig", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify(validDiscoveryDocument), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes a complete enabled configuration", async () => {
    await expect(validateOidcConfig(validConfig)).resolves.toEqual({
      ...validConfig,
      displayName: "Authentik",
      clientId: "client-id",
      clientSecret: "secret",
    });
  });

  it("requires complete credentials when enabled", async () => {
    await expect(
      validateOidcConfig({ ...validConfig, clientSecret: "" }),
    ).rejects.toThrow("required before enabling OIDC");
  });

  it("rejects insecure remote discovery URLs", async () => {
    await expect(
      validateOidcConfig({
        ...validConfig,
        discoveryUrl:
          "http://auth.example.com/.well-known/openid-configuration",
      }),
    ).rejects.toThrow("must use HTTPS");
  });

  it("allows HTTP discovery for local development", async () => {
    await expect(
      validateOidcConfig({
        ...validConfig,
        discoveryUrl:
          "http://localhost:9000/application/o/test/.well-known/openid-configuration",
      }).then((config) => config.discoveryUrl),
    ).resolves.toBe(
      "http://localhost:9000/application/o/test/.well-known/openid-configuration",
    );
  });

  it("rejects a discovery URL that doesn't return a valid document", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ issuer: "https://auth.example.com/" }), {
        status: 200,
      }),
    );
    await expect(validateOidcConfig(validConfig)).rejects.toThrow(
      "missing required field",
    );
  });

  it("rejects a discovery URL that is unreachable", async () => {
    fetchMock.mockRejectedValueOnce(new Error("fetch failed"));
    await expect(validateOidcConfig(validConfig)).rejects.toThrow(
      "Could not reach the discovery URL",
    );
  });
});
