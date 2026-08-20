export type OidcRuntimeConfig = {
  enabled: boolean;
  displayName: string;
  discoveryUrl: string;
  clientId: string;
  clientSecret: string;
  allowSignUp: boolean;
};

function normalizeUrl(value: string): string {
  const parsed = new URL(value.trim());
  if (
    parsed.protocol !== "https:" &&
    parsed.hostname !== "localhost" &&
    parsed.hostname !== "127.0.0.1"
  ) {
    throw new Error("OIDC discovery URL must use HTTPS (except on localhost).");
  }
  return parsed.toString();
}

async function checkDiscoveryDocument(discoveryUrl: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(discoveryUrl, {
      signal: AbortSignal.timeout(8000),
      headers: { accept: "application/json" },
    });
  } catch (error) {
    throw new Error(
      `Could not reach the discovery URL: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `Discovery URL returned HTTP ${response.status}. Check that it points at the ".well-known/openid-configuration" document for your Authentik application.`,
    );
  }
  let doc: Record<string, unknown>;
  try {
    doc = await response.json();
  } catch {
    throw new Error(
      "Discovery URL did not return valid JSON. Make sure it points at the full \".well-known/openid-configuration\" URL, not just the issuer root.",
    );
  }
  const requiredFields = ["authorization_endpoint", "token_endpoint", "issuer"];
  const missing = requiredFields.filter((field) => !doc[field]);
  if (missing.length > 0) {
    throw new Error(
      `Discovery document is missing required field(s): ${missing.join(", ")}. Make sure the discovery URL points at the full ".well-known/openid-configuration" document.`,
    );
  }
}

export async function validateOidcConfig(
  config: OidcRuntimeConfig,
): Promise<OidcRuntimeConfig> {
  const normalized = {
    ...config,
    displayName: config.displayName.trim() || "Single Sign-On",
    discoveryUrl: config.discoveryUrl.trim(),
    clientId: config.clientId.trim(),
    clientSecret: config.clientSecret.trim(),
  };

  if (normalized.enabled) {
    if (
      !normalized.discoveryUrl ||
      !normalized.clientId ||
      !normalized.clientSecret
    ) {
      throw new Error(
        "Discovery URL, client ID, and client secret are required before enabling OIDC.",
      );
    }
    normalized.discoveryUrl = normalizeUrl(normalized.discoveryUrl);
    await checkDiscoveryDocument(normalized.discoveryUrl);
  } else if (normalized.discoveryUrl) {
    normalized.discoveryUrl = normalizeUrl(normalized.discoveryUrl);
  }

  if (normalized.displayName.length > 80) {
    throw new Error("Provider name must be 80 characters or fewer.");
  }
  if (
    normalized.clientId.length > 500 ||
    normalized.clientSecret.length > 2000
  ) {
    throw new Error("OIDC client credentials are too long.");
  }

  return normalized;
}
