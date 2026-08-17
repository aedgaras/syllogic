"use client";
import { t as translate } from "@/i18n/translate";


import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { signUp } from "@/lib/auth-client";
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

const registerSchema = z
  .object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    email: z.string().email("Please enter a valid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: translate("passwordsDonTMatch"),
    path: ["confirmPassword"],
  });

type RegisterFormData = z.infer<typeof registerSchema>;

export function RegisterForm({ firstUserWillBeAdmin = false }: { firstUserWillBeAdmin?: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  });

  // If the user was bounced here mid-OAuth-authorize, resume the flow after
  // successful sign-up instead of going to the dashboard.
  const oauthResumeURL = useMemo(() => {
    const hasOauthParams =
      searchParams.has("client_id") &&
      searchParams.has("response_type") &&
      searchParams.has("redirect_uri");
    if (!hasOauthParams) return null;
    return `/api/auth/oauth2/authorize?${searchParams.toString()}`;
  }, [searchParams]);

  const onSubmit = async (data: RegisterFormData) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await signUp.email({
        name: data.name,
        email: data.email,
        password: data.password,
      });

      if (result.error) {
        setError(result.error.message || translate("failedToCreateAccount"));
        return;
      }

      if (oauthResumeURL) {
        window.location.href = oauthResumeURL;
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError(translate("anUnexpectedErrorOccurred"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{translate("createAnAccount")}</CardTitle>
        <CardDescription>
          {firstUserWillBeAdmin
            ? translate("createTheFirstAccountItWillBeTheApplication")
            : translate("enterYourDetailsBelowToCreateYourAccount")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)}>
          <FieldGroup>
            {error && (
              <div className="bg-destructive/10 text-destructive p-3 text-sm">
                {error}
              </div>
            )}
            <Field>
              <FieldLabel htmlFor="name">{translate("name")}</FieldLabel>
              <Input
                id="name"
                type="text"
                placeholder={translate("johnDoe")}
                {...register("name")}
                disabled={isLoading}
              />
              {errors.name && (
                <FieldError>{errors.name.message}</FieldError>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="email">{translate("email84add5")}</FieldLabel>
              <Input
                id="email"
                type="email"
                placeholder={translate("mExampleCom")}
                {...register("email")}
                disabled={isLoading}
              />
              {errors.email && (
                <FieldError>{errors.email.message}</FieldError>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="password">{translate("password8be3c9")}</FieldLabel>
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
              <FieldLabel htmlFor="confirmPassword">{translate("confirmPassword")}</FieldLabel>
              <Input
                id="confirmPassword"
                type="password"
                {...register("confirmPassword")}
                disabled={isLoading}
              />
              {errors.confirmPassword && (
                <FieldError>{errors.confirmPassword.message}</FieldError>
              )}
            </Field>
            <Field>
              <Button type="submit" disabled={isLoading} className="w-full">
                {isLoading ? translate("creatingAccount") : translate("signUp")}
              </Button>
              <FieldDescription className="text-center">
                {translate("alreadyHaveAnAccount")}{" "}
                <Link href="/login" className="underline underline-offset-4">
                  {translate("login")}
                </Link>
              </FieldDescription>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}

function RegisterPageFallback() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{translate("createAnAccount")}</CardTitle>
        <CardDescription>{translate("loadingRegistrationForm")}</CardDescription>
      </CardHeader>
      <CardContent />
    </Card>
  );
}

export function RegisterFormWithFallback({
  firstUserWillBeAdmin = false,
}: {
  firstUserWillBeAdmin?: boolean;
}) {
  return (
    <Suspense fallback={<RegisterPageFallback />}>
      <RegisterForm firstUserWillBeAdmin={firstUserWillBeAdmin} />
    </Suspense>
  );
}
