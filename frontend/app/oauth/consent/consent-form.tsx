"use client";
import { t as translate } from "@/i18n/translate";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { submitOAuthConsent } from "@/lib/oauth/client";

type Props = {
  params: Record<string, string | string[] | undefined>;
};

export function ConsentForm({ params }: Props) {
  const [pending, setPending] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const consentMutation = useMutation({
    mutationFn: submitOAuthConsent,
  });

  async function submit(decision: "allow" | "deny") {
    setPending(decision);
    setError(null);
    try {
      const oauthQuery = new URLSearchParams(
        Object.entries(params).flatMap(([k, v]) =>
          typeof v === "string" ? [[k, v] as [string, string]] : [],
        ),
      ).toString();
      const scope = typeof params.scope === "string" ? params.scope : undefined;
      const { response, body } = await consentMutation.mutateAsync({
        accept: decision === "allow",
        scope,
        oauthQuery,
      });
      const target =
        typeof body?.url === "string"
          ? body.url
          : typeof body?.redirect_uri === "string"
            ? body.redirect_uri
            : undefined;
      if (target) {
        window.location.assign(target);
        return;
      }
      if (!response.ok) {
        throw new Error(body?.error ?? `Request failed (${response.status})`);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : translate("somethingWentWrongTryAgain"),
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <Button
          variant="default"
          disabled={pending !== null}
          onClick={() => submit("allow")}
        >
          {pending === "allow"
            ? translate("authorizing")
            : translate("allow3ad0e3")}
        </Button>
        <Button
          variant="outline"
          disabled={pending !== null}
          onClick={() => submit("deny")}
        >
          {translate("deny")}
        </Button>
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
