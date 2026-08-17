"use client";
import { t as translate } from "@/i18n/translate";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { signIn } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type LoginFormData = z.infer<typeof loginSchema>;

type PublicOidcConfig = {
  enabled: boolean;
  displayName: string;
};

const truthyParamValues = new Set(["1", "true", "yes", "on"]);

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [oidcConfig, setOidcConfig] = useState<PublicOidcConfig | null>(null);
  const [signUpsEnabled, setSignUpsEnabled] = useState(false);

  const demoModeRequested = useMemo(() => {
    const raw = searchParams.get("demo");
    if (!raw) return false;
    return truthyParamValues.has(raw.trim().toLowerCase());
  }, [searchParams]);

  const emailFromQuery = searchParams.get("email")?.trim() || "";
  const demoEmail = process.env.NEXT_PUBLIC_DEMO_EMAIL?.trim() || "";
  const demoPassword = process.env.NEXT_PUBLIC_DEMO_PASSWORD || "";

  const prefillEmail = demoModeRequested
    ? demoEmail || emailFromQuery
    : emailFromQuery;
  const prefillPassword = demoModeRequested ? demoPassword : "";

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: prefillEmail,
      password: prefillPassword,
    },
  });

  useEffect(() => {
    if (prefillEmail) {
      setValue("email", prefillEmail, { shouldDirty: false });
    }
    if (prefillPassword) {
      setValue("password", prefillPassword, { shouldDirty: false });
    }
  }, [prefillEmail, prefillPassword, setValue]);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/oidc-config", { cache: "no-store" })
      .then((response) => response.json())
      .then((config: PublicOidcConfig) => {
        if (active && config.enabled) setOidcConfig(config);
      })
      .catch(() => {
        // Email/password login remains available if OIDC configuration cannot load.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/registration-config", { cache: "no-store" })
      .then((response) => response.json())
      .then((config: { enabled: boolean }) => {
        if (active) setSignUpsEnabled(config.enabled);
      })
      .catch(() => {
        // Keep registration hidden when its policy cannot be loaded.
      });
    return () => {
      active = false;
    };
  }, []);

  // If the user landed here because an OAuth authorize request requires
  // authentication, better-auth's oauth-provider passes the original
  // authorize query (plus `exp` and `sig`) along. After successful sign-in
  // we resume the OAuth flow by re-hitting /api/auth/oauth2/authorize with
  // those same params. Otherwise we fall back to the dashboard.
  const oauthResumeURL = useMemo(() => {
    const hasOauthParams =
      searchParams.has("client_id") &&
      searchParams.has("response_type") &&
      searchParams.has("redirect_uri");
    if (!hasOauthParams) return null;
    return `/api/auth/oauth2/authorize?${searchParams.toString()}`;
  }, [searchParams]);

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await signIn.email({
        email: data.email,
        password: data.password,
      });

      if (result.error) {
        setError(result.error.message || translate("failedToSignIn"));
        return;
      }

      if (oauthResumeURL) {
        // Full navigation so the browser follows the authorize redirect chain
        // (consent page → client redirect_uri with code).
        window.location.href = oauthResumeURL;
        return;
      }

      // push("/") already fetches a fresh RSC payload for the dashboard route;
      // calling router.refresh() here would redundantly re-render it a second time.
      router.push("/");
    } catch {
      setError(translate("anUnexpectedErrorOccurred"));
    } finally {
      setIsLoading(false);
    }
  };

  const onOidcSignIn = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await signIn.oauth2({
        providerId: "oidc",
        callbackURL: oauthResumeURL ?? "/",
        errorCallbackURL: "/login?oidc_error=1",
      });
      if (result.error) {
        setError(result.error.message || translate("singleSignOnFailed"));
        setIsLoading(false);
      }
    } catch {
      setError(translate("singleSignOnFailed"));
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{translate("loginToYourAccount")}</CardTitle>
        <CardDescription>
          {translate("enterYourEmailBelowToLoginToYourAccount")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {oidcConfig && (
          <div className="mb-5 space-y-4">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={isLoading}
              onClick={onOidcSignIn}
            >
              {translate("continueWith")} {oidcConfig.displayName}
            </Button>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-border" />
              <span>{translate("orUseEmail")}</span>
              <div className="h-px flex-1 bg-border" />
            </div>
          </div>
        )}
        <form onSubmit={handleSubmit(onSubmit)}>
          <FieldGroup>
            {error && (
              <div className="bg-destructive/10 text-destructive p-3 text-sm">
                {error}
              </div>
            )}
            {searchParams.get("registration") === "disabled" && (
              <div className="bg-muted p-3 text-sm text-muted-foreground">
                {translate("newAccountRegistrationIsCurrentlyDisabled")}
              </div>
            )}
            {demoModeRequested && demoEmail && demoPassword && (
              <div className="bg-muted border border-border p-3 text-sm space-y-1">
                <p className="font-medium text-foreground">
                  {translate("demoAccountCredentials")}
                </p>
                <p className="text-muted-foreground">
                  {translate("email")}{" "}
                  <span className="text-foreground font-mono">{demoEmail}</span>
                </p>
                <p className="text-muted-foreground">
                  {translate("password")}{" "}
                  <span className="text-foreground font-mono">
                    {demoPassword}
                  </span>
                </p>
              </div>
            )}
            {demoModeRequested && !demoPassword && (
              <div className="bg-muted p-3 text-sm">
                {translate("demoModeLinkDetectedButDemoCredentialsAreNot")}
              </div>
            )}
            <Field>
              <FieldLabel htmlFor="email">
                {translate("email84add5")}
              </FieldLabel>
              <Input
                id="email"
                type="email"
                placeholder={translate("mExampleCom")}
                {...register("email")}
                disabled={isLoading}
              />
              {errors.email && <FieldError>{errors.email.message}</FieldError>}
            </Field>
            <Field>
              <div className="flex items-center">
                <FieldLabel htmlFor="password">
                  {translate("password8be3c9")}
                </FieldLabel>
              </div>
              <Input
                id="password"
                type="password"
                {...register("password")}
                disabled={isLoading}
              />
              {errors.password && (
                <FieldError>{errors.password.message}</FieldError>
              )}
            </Field>
            <Field>
              <Button type="submit" disabled={isLoading} className="w-full">
                {isLoading ? translate("signingIn") : translate("login")}
              </Button>
              {signUpsEnabled && (
                <FieldDescription className="text-center">
                  {translate("donTHaveAnAccount")}{" "}
                  <Link
                    href="/register"
                    className="underline underline-offset-4"
                  >
                    {translate("signUp")}
                  </Link>
                </FieldDescription>
              )}
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}

function LoginPageFallback() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{translate("loginToYourAccount")}</CardTitle>
        <CardDescription>{translate("loadingLoginForm")}</CardDescription>
      </CardHeader>
      <CardContent />
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginPageFallback />}>
      <LoginPageContent />
    </Suspense>
  );
}
