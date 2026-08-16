"use client";

import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useWalkthroughStore } from "@/components/walkthrough/walkthrough-store";

export function PreferencesTab() {
  const { tutorialsEnabled, setTutorialsEnabled } = useWalkthroughStore();

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
    </div>
  );
}
