"use client";
import { t as translate } from "@/i18n/translate";

import { useState } from "react";
import { RiSparklingLine } from "@remixicon/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getTransactionsPeriodAiSummary } from "@/lib/actions/transactions";
import type { TransactionsQueryState } from "@/features/transactions/public";

type AiSummaryButtonProps = {
  queryState: TransactionsQueryState;
};

export function TransactionsAiSummaryButton({
  queryState,
}: AiSummaryButtonProps) {
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    try {
      const result = await getTransactionsPeriodAiSummary(queryState);
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
    <div className="flex flex-col gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleGenerate}
        disabled={loading}
      >
        <RiSparklingLine className="size-3.5" />
        {loading
          ? translate("generating")
          : summary
            ? translate("regenerate")
            : translate("generateAiSummary")}
      </Button>
      {summary && (
        <p className="max-w-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {summary}
        </p>
      )}
    </div>
  );
}
