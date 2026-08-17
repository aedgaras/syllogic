"use client";

import { useState } from "react";
import { RiLockLine, RiSave3Line } from "@remixicon/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  updateOidcSettings,
  updateSignupSettings,
} from "@/lib/actions/settings";
import type { OidcAdminSettings } from "@/lib/oidc-settings";
import type { RegistrationStatus } from "@/lib/registration-settings";

type AuthenticationTabProps = {
  initialSettings: OidcAdminSettings & { error?: string };
  initialSignupSettings: RegistrationStatus & { error?: string };
  callbackUrl: string;
};

export function AuthenticationTab({
  initialSettings,
  initialSignupSettings,
  callbackUrl,
}: AuthenticationTabProps) {
  const [settings, setSettings] = useState(initialSettings);
  const [displayName, setDisplayName] = useState(initialSettings.displayName);
  const [discoveryUrl, setDiscoveryUrl] = useState(initialSettings.discoveryUrl);
  const [clientId, setClientId] = useState(initialSettings.clientId);
  const [clientSecret, setClientSecret] = useState("");
  const [enabled, setEnabled] = useState(initialSettings.enabled);
  const [allowSignUp, setAllowSignUp] = useState(initialSettings.allowSignUp);
  const [saving, setSaving] = useState(false);
  const [signupSettings, setSignupSettings] = useState(initialSignupSettings);
  const [signupsEnabled, setSignupsEnabled] = useState(initialSignupSettings.databaseEnabled);
  const [savingSignups, setSavingSignups] = useState(false);

  async function handleSaveSignups() {
    setSavingSignups(true);
    try {
      const result = await updateSignupSettings(signupsEnabled);
      if (!result.success || !result.settings) {
        toast.error(result.error || "Failed to save signup settings");
        return;
      }
      setSignupSettings(result.settings);
      toast.success(signupsEnabled ? "New user signups enabled" : "New user signups disabled");
    } catch {
      toast.error("Failed to save signup settings");
    } finally {
      setSavingSignups(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const result = await updateOidcSettings({
        enabled,
        displayName,
        discoveryUrl,
        clientId,
        clientSecret: clientSecret || undefined,
        allowSignUp,
      });
      if (!result.success || !result.settings) {
        toast.error(result.error || "Failed to save OIDC settings");
        return;
      }
      setSettings(result.settings);
      setClientSecret("");
      toast.success(enabled ? "OIDC login enabled" : "OIDC settings saved");
    } catch {
      toast.error("Failed to save OIDC settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="space-y-4 border border-border p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="new-user-signups">New user registration</Label>
            <p className="text-xs text-muted-foreground">
              Allow people to create new local accounts. Existing users can always sign in.
            </p>
          </div>
          <Switch
            id="new-user-signups"
            checked={signupsEnabled}
            onCheckedChange={setSignupsEnabled}
            disabled={savingSignups || signupSettings.environmentDisabled}
          />
        </div>

        {signupSettings.error && (
          <p className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {signupSettings.error}
          </p>
        )}
        {signupSettings.environmentDisabled && (
          <p className="border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Signups are disabled by the deployment-level DISABLE_SIGN_UPS setting.
          </p>
        )}
        <Button
          onClick={handleSaveSignups}
          disabled={
            savingSignups ||
            signupSettings.environmentDisabled
          }
        >
          <RiSave3Line />
          {savingSignups ? "Saving..." : "Save signup policy"}
        </Button>
      </div>

      <div className="space-y-5 border border-border p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="oidc-enabled" className="flex items-center gap-2">
              <RiLockLine className="h-4 w-4" />
              OpenID Connect
            </Label>
            <p className="text-xs text-muted-foreground">
              Add an optional identity provider such as Authentik, Keycloak, or Okta.
            </p>
          </div>
          <Switch
            id="oidc-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={saving}
            aria-label="Enable OpenID Connect login"
          />
        </div>

        {settings.error && (
          <p className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {settings.error}
          </p>
        )}

        {!settings.encryptionConfigured && (
          <p className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Set DATA_ENCRYPTION_KEY_CURRENT on the frontend deployment before saving OIDC credentials.
          </p>
        )}

        <div className="space-y-2">
          <Label htmlFor="oidc-display-name">Provider name</Label>
          <Input
            id="oidc-display-name"
            value={displayName}
            maxLength={80}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Company SSO"
            disabled={saving}
          />
          <p className="text-xs text-muted-foreground">Shown on the login button.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="oidc-discovery-url">Discovery URL</Label>
          <Input
            id="oidc-discovery-url"
            type="url"
            value={discoveryUrl}
            onChange={(event) => setDiscoveryUrl(event.target.value)}
            placeholder="https://auth.example.com/application/o/app/.well-known/openid-configuration"
            disabled={saving}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="oidc-client-id">Client ID</Label>
          <Input
            id="oidc-client-id"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            autoComplete="off"
            disabled={saving}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="oidc-client-secret">Client secret</Label>
          <Input
            id="oidc-client-secret"
            type="password"
            value={clientSecret}
            onChange={(event) => setClientSecret(event.target.value)}
            autoComplete="new-password"
            placeholder={settings.clientSecretConfigured ? "Leave blank to keep the saved secret" : "Enter client secret"}
            disabled={saving}
          />
          <p className="text-xs text-muted-foreground">
            The secret is encrypted and is never returned to the browser after saving.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Redirect URI</Label>
          <code className="block overflow-x-auto border border-border bg-muted/40 px-3 py-2 text-xs">
            {callbackUrl}
          </code>
          <p className="text-xs text-muted-foreground">
            Add this exact URI to the provider&apos;s allowed redirect URIs.
          </p>
        </div>

        <div className="flex items-start justify-between gap-4 border border-border p-3">
          <div className="space-y-1">
            <Label htmlFor="oidc-sign-ups">Allow new users</Label>
            <p className="text-xs text-muted-foreground">
              When disabled, only users with an existing linked OIDC account can sign in.
            </p>
          </div>
          <Switch
            id="oidc-sign-ups"
            checked={allowSignUp}
            onCheckedChange={setAllowSignUp}
            disabled={saving}
          />
        </div>

        <Button onClick={handleSave} disabled={saving || !settings.encryptionConfigured}>
          <RiSave3Line />
          {saving ? "Saving..." : "Save authentication settings"}
        </Button>
      </div>
    </div>
  );
}
