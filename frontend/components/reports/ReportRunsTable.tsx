"use client";
import { t as translate } from "@/i18n/translate";

import type { ReportRun } from "@/lib/reports/types";
import { RunStatusBadge } from "@/components/reports/RunStatusBadge";

interface ReportRunsTableProps {
  runs: ReportRun[];
}

function formatRunTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : "-";
}

function formatScheduledRun(run: ReportRun) {
  if (run.is_test) {
    return "Test send";
  }

  return formatRunTime(run.scheduled_for);
}

export function ReportRunsTable({ runs }: ReportRunsTableProps) {
  return (
    <>
      <div className="space-y-2 md:hidden">
        {runs.map((run) => (
          <article key={run.id} className="border border-border p-3 text-xs">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words font-medium">
                  {formatScheduledRun(run)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {translate("scheduledFor")}
                </p>
              </div>
              <RunStatusBadge status={run.status} />
            </div>
            <dl className="mt-3 grid gap-2 text-xs">
              <div className="min-w-0">
                <dt className="uppercase text-muted-foreground">
                  {translate("finished")}
                </dt>
                <dd className="mt-0.5 break-words">
                  {formatRunTime(run.finished_at)}
                </dd>
              </div>
              {run.error_message && (
                <div className="min-w-0">
                  <dt className="uppercase text-muted-foreground">
                    {translate("error")}
                  </dt>
                  <dd className="mt-0.5 break-words text-destructive">
                    {run.error_message}
                  </dd>
                </div>
              )}
            </dl>
          </article>
        ))}
      </div>

      <div className="hidden overflow-x-auto border border-border md:block">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2">{translate("scheduledFor")}</th>
              <th className="px-4 py-2">{translate("status")}</th>
              <th className="px-4 py-2">{translate("finished")}</th>
              <th className="px-4 py-2">{translate("error")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {runs.map((run) => (
              <tr key={run.id}>
                <td className="px-4 py-2">{formatScheduledRun(run)}</td>
                <td className="px-4 py-2">
                  <RunStatusBadge status={run.status} />
                </td>
                <td className="px-4 py-2">{formatRunTime(run.finished_at)}</td>
                <td className="px-4 py-2 text-destructive">
                  {run.error_message ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
