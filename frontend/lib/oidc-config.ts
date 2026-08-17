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

export function validateOidcConfig(
  config: OidcRuntimeConfig,
): OidcRuntimeConfig {
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
