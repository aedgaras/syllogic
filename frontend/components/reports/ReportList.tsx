"use client";
import { t as translate } from "@/i18n/translate";

import Link from "next/link";
import type { Report } from "@/lib/reports/types";

interface ReportListProps {
  reports: Report[];
  onDelete: (id: string) => void;
}

function formatReportSchedule(report: Report) {
  const nextRun = report.next_run_at
    ? new Date(report.next_run_at).toLocaleString()
    : "-";
  const status = report.is_active ? "active" : "paused";

  return {
    frequency: report.frequency.toLowerCase(),
    nextRun,
    status,
  };
}

export function ReportList({ reports, onDelete }: ReportListProps) {
  return (
    <ul className="divide-y divide-border border border-border">
      {reports.map((report) => {
        const schedule = formatReportSchedule(report);

        return (
          <li
            key={report.id}
            className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 space-y-1">
              <Link
                href={`/reports/${report.id}`}
                className="break-words font-medium text-foreground hover:underline"
              >
                {report.name}
              </Link>
              <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-muted-foreground min-[420px]:grid-cols-3">
                <div className="min-w-0">
                  <dt className="sr-only">{translate("frequency")}</dt>
                  <dd className="truncate">{schedule.frequency}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="sr-only">{translate("nextRun")}</dt>
                  <dd className="truncate">
                    {translate("nextRun69a403")} {schedule.nextRun}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="sr-only">{translate("status")}</dt>
                  <dd className="truncate">{schedule.status}</dd>
                </div>
              </dl>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <Link
                href={`/reports/${report.id}/runs`}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                {translate("runsfcde5c")}
              </Link>
              <button
                onClick={() => onDelete(report.id)}
                className="text-sm text-destructive hover:underline"
              >
                {translate("delete")}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
