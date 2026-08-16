"use client";

export async function submitOAuthConsent(input: {
  accept: boolean;
  scope?: string;
  oauthQuery: string;
}) {
  const response = await fetch("/api/auth/oauth2/consent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accept: input.accept,
      ...(input.scope ? { scope: input.scope } : {}),
      oauth_query: input.oauthQuery,
    }),
    redirect: "manual",
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

