import { t as translate } from "@/i18n/translate";
import { RiLoader4Line } from "@remixicon/react";
import { Progress } from "@/components/ui/progress";

interface ImportProgressViewProps {
  visible: boolean;
  progress: number | null;
  processedRows: number | null;
  totalRows: number | null;
}

export function ImportProgressView({
  visible,
  progress,
  processedRows,
  totalRows,
}: ImportProgressViewProps) {
  if (!visible) return null;

  return (
    <div className="flex min-w-[180px] flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <RiLoader4Line className="h-4 w-4 shrink-0 animate-spin" />
          <span>{translate("importingTransactions")}</span>
        </div>
        {progress !== null && (
          <span className="font-mono text-xs tabular-nums">{progress}%</span>
        )}
      </div>
      {progress !== null && <Progress value={progress} className="h-1.5" />}
      {processedRows !== null && totalRows !== null && (
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {processedRows} / {totalRows} {translate("rows")}
        </span>
      )}
    </div>
  );
}
