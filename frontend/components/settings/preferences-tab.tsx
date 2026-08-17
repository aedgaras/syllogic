"use client";
import { t as translate } from "@/i18n/translate";


import { useState } from "react";
import { RiDeleteBinLine, RiKey2Line, RiSave3Line } from "@remixicon/react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ThemeSelector } from "@/components/theme-selector";
import { useWalkthroughStore } from "@/components/walkthrough/walkthrough-store";
import {
  clearOpenAiApiKey,
  updateOpenAiApiKey,
  type OpenAiSettings,
} from "@/lib/actions/settings";

type PreferencesTabProps = {
  initialOpenAiSettings: OpenAiSettings & { error?: string };
};

function sourceLabel(source: OpenAiSettings["source"]) {
  if (source === "database") return "Configured in settings";
  if (source === "environment") return "Configured by deployment";
  return "Not configured";
}

export function PreferencesTab({ initialOpenAiSettings }: PreferencesTabProps) {
  const { tutorialsEnabled, setTutorialsEnabled } = useWalkthroughStore();
  const [openAiSettings, setOpenAiSettings] = useState(initialOpenAiSettings);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  async function handleSave() {
    const normalized = apiKey.trim();
    if (!normalized) {
      toast.error(translate("enterAnLlmApiKey"));
      return;
    }

    setSaving(true);
    try {
      const result = await updateOpenAiApiKey(normalized);
      if (!result.success || !result.settings) {
        toast.error(result.error || translate("failedToSaveLlmApiKey"));
        return;
      }
      setOpenAiSettings(result.settings);
      setApiKey("");
      toast.success(translate("llmApiKeySaved"));
    } catch {
      toast.error(translate("failedToSaveLlmApiKey"));
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    setClearing(true);
    try {
      const result = await clearOpenAiApiKey();
      if (!result.success || !result.settings) {
        toast.error(result.error || translate("failedToRemoveLlmApiKey"));
        return;
      }
      setOpenAiSettings(result.settings);
      setApiKey("");
      toast.success(translate("llmApiKeyRemovedFromSettings"));
    } catch {
      toast.error(translate("failedToRemoveLlmApiKey"));
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="space-y-3 border border-border p-4">
        <div className="space-y-1">
          <Label>{translate("appearance")}</Label>
          <p className="text-xs text-muted-foreground">
            {translate("chooseHowSyllogicLooksOnThisDevice")}
          </p>
        </div>
        <ThemeSelector />
      </div>

      <div className="border border-border p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="tutorials-enabled">{translate("toursAndTutorials")}</Label>
            <p className="text-xs text-muted-foreground">
              {translate("showPageToursOnboardingTipsAndTheSidebarHelp")}
            </p>
          </div>
          <Switch
            id="tutorials-enabled"
            checked={tutorialsEnabled}
            onCheckedChange={setTutorialsEnabled}
            aria-label={translate("enableToursAndTutorials")}
          />
        </div>
      </div>

      <div className="space-y-4 border border-border p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="openai-api-key" className="flex items-center gap-2">
              <RiKey2Line className="h-4 w-4" />
              {translate("llmApiKey")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {translate("usedByAiCategorizationOpenaiAndOpenaiCompatibleProviders")}
            </p>
          </div>
          <div className="shrink-0 border border-border px-2 py-1 text-xs">
            {sourceLabel(openAiSettings.source)}
          </div>
        </div>

        {openAiSettings.error && (
          <p className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {openAiSettings.error}
          </p>
        )}

        {openAiSettings.environmentConfigured && openAiSettings.source !== "database" && (
          <p className="border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {translate("aDeploymentKeyIsCurrentlyActiveSavingAKey")}
          </p>
        )}

        <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
          <p>{translate("provider")} {openAiSettings.provider === "custom" ? translate("customEndpoint") : translate("openai")}</p>
          <p>{translate("model")} {openAiSettings.model}</p>
          {openAiSettings.baseUrl && <p className="break-all sm:col-span-2">{translate("endpoint")} {openAiSettings.baseUrl}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="openai-api-key" className="text-xs">
            {translate("newKey")}
          </Label>
          <Input
            id="openai-api-key"
            type="password"
            inputMode="text"
            autoComplete="off"
            placeholder={translate("apiKeyOrLocalPlaceholder")}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            disabled={saving || clearing}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSave} disabled={saving || clearing || !apiKey.trim()}>
            <RiSave3Line />
            {saving ? translate("saving") : translate("saveKey")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleClear}
            disabled={saving || clearing || !openAiSettings.databaseConfigured}
          >
            <RiDeleteBinLine />
            {clearing ? translate("removing") : translate("removeSavedKey")}
          </Button>
        </div>
      </div>
    </div>
  );
}
