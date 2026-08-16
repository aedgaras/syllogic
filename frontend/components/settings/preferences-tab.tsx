"use client";

import { useState } from "react";
import { RiDeleteBinLine, RiKey2Line, RiSave3Line } from "@remixicon/react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
      toast.error("Enter an OpenAI API key");
      return;
    }

    setSaving(true);
    try {
      const result = await updateOpenAiApiKey(normalized);
      if (!result.success || !result.settings) {
        toast.error(result.error || "Failed to save OpenAI API key");
        return;
      }
      setOpenAiSettings(result.settings);
      setApiKey("");
      toast.success("OpenAI API key saved");
    } catch {
      toast.error("Failed to save OpenAI API key");
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    setClearing(true);
    try {
      const result = await clearOpenAiApiKey();
      if (!result.success || !result.settings) {
        toast.error(result.error || "Failed to remove OpenAI API key");
        return;
      }
      setOpenAiSettings(result.settings);
      setApiKey("");
      toast.success("OpenAI API key removed from settings");
    } catch {
      toast.error("Failed to remove OpenAI API key");
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="border border-border p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="tutorials-enabled">Tours and tutorials</Label>
            <p className="text-xs text-muted-foreground">
              Show page tours, onboarding tips, and the sidebar Help tour controls.
            </p>
          </div>
          <Switch
            id="tutorials-enabled"
            checked={tutorialsEnabled}
            onCheckedChange={setTutorialsEnabled}
            aria-label="Enable tours and tutorials"
          />
        </div>
      </div>

      <div className="space-y-4 border border-border p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="openai-api-key" className="flex items-center gap-2">
              <RiKey2Line className="h-4 w-4" />
              OpenAI API key
            </Label>
            <p className="text-xs text-muted-foreground">
              Used by AI categorization. The saved key is encrypted and is never shown again.
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
            A deployment key is currently active. Saving a key here will override it at runtime.
          </p>
        )}

        <div className="space-y-2">
          <Label htmlFor="openai-api-key" className="text-xs">
            New key
          </Label>
          <Input
            id="openai-api-key"
            type="password"
            inputMode="text"
            autoComplete="off"
            placeholder="sk-..."
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            disabled={saving || clearing}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSave} disabled={saving || clearing || !apiKey.trim()}>
            <RiSave3Line />
            {saving ? "Saving..." : "Save key"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleClear}
            disabled={saving || clearing || !openAiSettings.databaseConfigured}
          >
            <RiDeleteBinLine />
            {clearing ? "Removing..." : "Remove saved key"}
          </Button>
        </div>
      </div>
    </div>
  );
}
