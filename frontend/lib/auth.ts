import { logger } from "@/lib/logger";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, genericOAuth, jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { OidcRuntimeConfig } from "@/lib/oidc-config";
import { resolveServerBaseUrl, toValidOrigin } from "@/lib/base-url";

const resolvedBaseURL = resolveServerBaseUrl();

export function createAuth(
  oidcConfig?: OidcRuntimeConfig | null,
  allowNewUsers = true,
) {
  return betterAuth({
    baseURL: resolvedBaseURL,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.authAccounts,
        verification: schema.verificationTokens,
        oauthClient: schema.oauthClient,
        oauthAccessToken: schema.oauthAccessToken,
        oauthRefreshToken: schema.oauthRefreshToken,
        oauthConsent: schema.oauthConsent,
        jwks: schema.jwks,
        rateLimit: schema.rateLimit,
      },
    }),
    rateLimit: {
      enabled: true,
      storage: "database",
    },
    plugins: [
      admin(),
      jwt({
        jwks: {
          keyPairConfig: { alg: "RS256", modulusLength: 2048 },
        },
      }),
      ...(oidcConfig?.enabled
        ? [
            genericOAuth({
              config: [
                {
                  providerId: "oidc",
                  discoveryUrl: oidcConfig.discoveryUrl,
                  clientId: oidcConfig.clientId,
                  clientSecret: oidcConfig.clientSecret,
                  scopes: ["openid", "profile", "email"],
                  pkce: true,
                  disableImplicitSignUp:
                    !oidcConfig.allowSignUp || !allowNewUsers,
                  disableSignUp: !allowNewUsers,
                },
              ],
            }),
          ]
        : []),
      oauthProvider({
        scopes: ["mcp:access"],
        accessTokenExpiresIn: 60 * 60, // 1 hour
        refreshTokenExpiresIn: 60 * 60 * 24 * 90, // 90 days
        // Off by default: anyone who can reach the origin could otherwise
        // register an OAuth client without authenticating and drive the
        // consent flow. Only enable this for deployments that need MCP
        // clients (e.g. Claude custom connectors) to self-register via
        // RFC 7591 instead of using a pre-shared pf_ API key.
        allowDynamicClientRegistration:
          process.env.MCP_OAUTH_ALLOW_DYNAMIC_REGISTRATION === "true",
        allowUnauthenticatedClientRegistration:
          process.env.MCP_OAUTH_ALLOW_DYNAMIC_REGISTRATION === "true",
        loginPage: "/login",
        consentPage: "/oauth/consent",
        // Allow MCP clients (e.g. Claude custom connectors) to request the
        // Syllogic MCP server as the JWT audience via RFC 8707. Without this,
        // better-auth rejects the resource parameter and falls back to an
        // opaque token that the MCP JWTVerifier can't validate.
        //
        // Defaults to this deployment's own local MCP server, not
        // upstream's — a fork that never sets MCP_VALID_AUDIENCES should
        // issue tokens scoped to its own MCP instance.
        validAudiences: Array.from(
          new Set(
            [
              process.env.MCP_LOCAL_AUDIENCE || "http://localhost:8001/mcp",
              ...(process.env.MCP_VALID_AUDIENCES
                ? process.env.MCP_VALID_AUDIENCES.split(",").map((v) =>
                    v.trim(),
                  )
                : []),
            ].filter(Boolean),
          ),
        ),
      }),
    ],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days — must outlive OAuth access token TTL
      updateAge: 60 * 60 * 24, // 1 day
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // 5 minutes — serve session from signed cookie instead of a DB hit
      },
    },
    trustedOrigins: (() => {
      const csvOrigins = (process.env.BETTER_AUTH_TRUSTED_ORIGINS || "")
        .split(",")
        .map((value) => toValidOrigin(value))
        .filter((value): value is string => Boolean(value));

      const baseOrigins = [
        process.env.APP_URL,
        process.env.BETTER_AUTH_URL,
        process.env.NEXT_PUBLIC_BETTER_AUTH_URL,
        process.env.RENDER_EXTERNAL_URL,
      ]
        .map((value) => toValidOrigin(value))
        .filter((value): value is string => Boolean(value));

      if (process.env.NODE_ENV === "production") {
        return Array.from(new Set([...baseOrigins, ...csvOrigins]));
      }

      return Array.from(
        new Set([
          ...baseOrigins,
          ...csvOrigins,
          "http://localhost:3000",
          "http://127.0.0.1:3000",
          "http://localhost:8080",
          "http://127.0.0.1:8080",
          "https://localhost:8443",
          "https://127.0.0.1:8443",
        ]),
      );
    })(),
  });
}

// Most server-side consumers only need session validation. The auth route uses
// getRequestAuth() below so an administrator can change OIDC without a restart.
export const auth = createAuth();

let requestAuthCache = auth;
let requestAuthCacheKey = "disabled";

export async function getRequestAuth() {
  try {
    const [{ getOidcRuntimeConfig }, { getRegistrationStatus }] =
      await Promise.all([
        import("@/lib/oidc-settings"),
        import("@/lib/registration-settings"),
      ]);
    const [config, registration] = await Promise.all([
      getOidcRuntimeConfig(),
      getRegistrationStatus(),
    ]);
    const cacheKey = JSON.stringify({
      config,
      allowNewUsers: registration.enabled,
    });
    if (cacheKey !== requestAuthCacheKey) {
      requestAuthCache = createAuth(config, registration.enabled);
      requestAuthCacheKey = cacheKey;
    }
    return requestAuthCache;
  } catch (error) {
    // Optional OIDC must never make password/session authentication unavailable.
    logger.error("Failed to load OIDC configuration; continuing without OIDC", {
      error,
    });
    return auth;
  }
}

export type Session = typeof auth.$Infer.Session;
