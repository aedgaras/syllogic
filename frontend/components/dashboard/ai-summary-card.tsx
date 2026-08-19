"use client";
import { t as translate } from "@/i18n/translate";

import { useState } from "react";
import { RiSparklingLine } from "@remixicon/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  getDashboardAiSummary,
  type DashboardFilters,
} from "@/lib/actions/dashboard";

type AiSummaryCardProps = {
  filters: DashboardFilters;
};

export function AiSummaryCard({ filters }: AiSummaryCardProps) {
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    try {
      const result = await getDashboardAiSummary(filters);
      if (!result.success || !result.summary) {
        toast.error(result.error || translate("failedToGenerateAiSummary"));
        return;
      }
      setSummary(result.summary);
    } catch {
      toast.error(translate("failedToGenerateAiSummary"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border border-border p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <RiSparklingLine className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">{translate("aiSummary")}</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleGenerate}
          disabled={loading}
        >
          {loading
            ? translate("generating")
            : summary
              ? translate("regenerate")
              : translate("generateAiSummary")}
        </Button>
      </div>
      {summary && (
        <p className="mt-3 text-sm text-muted-foreground">{summary}</p>
      )}
    </div>
  );
}
