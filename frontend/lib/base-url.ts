import "server-only";

export function toValidOrigin(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  const candidate =
    trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? trimmed
      : `https://${trimmed}`;

  try {
    return new URL(candidate).origin;
  } catch {
    return undefined;
  }
}

// Precedence must match across every place that displays or uses the app's
// public origin (auth baseURL, OIDC redirect URI shown to admins, trusted
// origins) — a mismatch here causes OIDC providers to reject the redirect_uri.
export function resolveServerBaseUrl(): string | undefined {
  return [
    process.env.APP_URL,
    process.env.BETTER_AUTH_URL,
    process.env.NEXT_PUBLIC_BETTER_AUTH_URL,
    process.env.RENDER_EXTERNAL_URL,
  ]
    .map((value) => toValidOrigin(value))
    .find((value): value is string => Boolean(value));
}
