"use client";
import { t as translate } from "@/i18n/translate";


import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createReport, sendTestReport, updateReport } from "@/lib/reports/api";
import type { Report, ReportInput } from "@/lib/reports/types";
import { Button } from "@/components/ui/button";
import { AccountPicker } from "./AccountPicker";
import type { PickerAccount } from "@/lib/reports/account-groups";

const schema = z.object({
  name: z.string().min(1, "Required"),
  account_ids: z.array(z.string()),
  transaction_mode: z.enum(["RECENT", "TOP_N"]),
  transaction_count: z.coerce.number().int().min(1).max(100),
  transaction_direction: z.enum(["ALL", "EXPENSE", "INCOME", "INFLOW", "OUTFLOW"]),
  frequency: z.enum(["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY"]),
  send_time: z.string().min(1),
  send_day_of_week: z.coerce.number().int().min(0).max(6).nullable().optional(),
  send_day_of_month: z.coerce.number().int().min(1).max(28).nullable().optional(),
  timezone: z.string().min(1),
  recipient_emails: z.array(z.string().email()).min(1, "Add at least one recipient"),
  is_active: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

const DEFAULTS: FormValues = {
  name: "",
  account_ids: [],
  transaction_mode: "RECENT",
  transaction_count: 10,
  transaction_direction: "ALL",
  frequency: "WEEKLY",
  send_time: "08:00:00",
  send_day_of_week: 0,
  send_day_of_month: null,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  recipient_emails: [],
  is_active: true,
};

export function ReportForm({
  report,
  availableAccounts,
  accountsLoading,
  accountsError,
}: {
  report?: Report;
  availableAccounts: PickerAccount[];
  accountsLoading?: boolean;
  accountsError?: boolean;
}) {
  const router = useRouter();
  const [recipientDraft, setRecipientDraft] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [sendTestError, setSendTestError] = useState<string | null>(null);
  const [sendTestSuccess, setSendTestSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: report ? { ...DEFAULTS, ...report } : DEFAULTS,
  });

  const frequency = watch("frequency");
  const recipients = watch("recipient_emails");
  const accountIds = watch("account_ids");

  async function onSubmit(values: FormValues) {
    setSubmitError(null);
    try {
      const input: Partial<ReportInput> = values;
      if (report) {
        await updateReport(report.id, input);
      } else {
        await createReport(input);
      }
      router.push("/reports");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : translate("failedToSaveReportPleaseTryAgain"));
    }
  }

  async function handleSendTest() {
    if (!report) return;
    setSendingTest(true);
    setSendTestError(null);
    setSendTestSuccess(false);
    try {
      await sendTestReport(report.id);
      setSendTestSuccess(true);
    } catch (err) {
      setSendTestError(err instanceof Error ? err.message : translate("failedToSendTestPleaseTryAgain"));
    } finally {
      setSendingTest(false);
    }
  }

  function addRecipient() {
    const value = recipientDraft.trim();
    if (!value) return;
    setValue("recipient_emails", [...recipients, value], { shouldValidate: true });
    setRecipientDraft("");
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-2xl space-y-5 text-foreground">
      <div>
        <label className="block text-sm font-medium mb-1">{translate("name")}</label>
        <input
          {...register("name")}
          className="w-full border border-border bg-background text-foreground rounded px-3 py-2 text-sm placeholder:text-muted-foreground"
        />
        {errors.name && <p className="text-xs text-destructive mt-1">{errors.name.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">{translate("accounts")}</label>
        <AccountPicker
          accounts={availableAccounts}
          selectedIds={accountIds}
          onChange={(ids) => setValue("account_ids", ids, { shouldValidate: true })}
          loading={accountsLoading ?? false}
          error={accountsError ?? false}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="block text-sm font-medium mb-1">{translate("mode")}</label>
          <select
            {...register("transaction_mode")}
            className="w-full border border-border bg-background text-foreground rounded px-2 py-2 text-sm"
          >
            <option value="RECENT">{translate("mostRecent")}</option>
            <option value="TOP_N">{translate("topNByAmount")}</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{translate("count")}</label>
          <input
            type="number"
            {...register("transaction_count")}
            className="w-full border border-border bg-background text-foreground rounded px-2 py-2 text-sm"
          />
          {errors.transaction_count && (
            <p className="text-xs text-destructive mt-1">{errors.transaction_count.message}</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{translate("direction")}</label>
          <select
            {...register("transaction_direction")}
            className="w-full border border-border bg-background text-foreground rounded px-2 py-2 text-sm"
          >
            <option value="ALL">{translate("all6a7208")}</option>
            <option value="EXPENSE">{translate("expenses")}</option>
            <option value="INCOME">{translate("income1c89b1")}</option>
            <option value="INFLOW">{translate("inflows")}</option>
            <option value="OUTFLOW">{translate("outflows")}</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium mb-1">{translate("frequency")}</label>
          <select
            {...register("frequency")}
            className="w-full border border-border bg-background text-foreground rounded px-2 py-2 text-sm"
          >
            <option value="DAILY">{translate("daily")}</option>
            <option value="WEEKLY">{translate("weekly")}</option>
            <option value="BIWEEKLY">{translate("biweekly")}</option>
            <option value="MONTHLY">{translate("monthly")}</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{translate("time")}</label>
          <input
            type="time"
            step={60}
            {...register("send_time")}
            className="w-full border border-border bg-background text-foreground rounded px-2 py-2 text-sm"
          />
        </div>
      </div>

      {(frequency === "WEEKLY" || frequency === "BIWEEKLY") && (
        <div>
          <label className="block text-sm font-medium mb-1">{translate("dayOfWeek")}</label>
          <select
            {...register("send_day_of_week")}
            className="w-full border border-border bg-background text-foreground rounded px-2 py-2 text-sm"
          >
            {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
          {errors.send_day_of_week && (
            <p className="text-xs text-destructive mt-1">{errors.send_day_of_week.message}</p>
          )}
        </div>
      )}

      {frequency === "MONTHLY" && (
        <div>
          <label className="block text-sm font-medium mb-1">{translate("dayOfMonth")}</label>
          <input
            type="number"
            min={1}
            max={28}
            {...register("send_day_of_month")}
            className="w-full border border-border bg-background text-foreground rounded px-2 py-2 text-sm"
          />
          {errors.send_day_of_month && (
            <p className="text-xs text-destructive mt-1">{errors.send_day_of_month.message}</p>
          )}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium mb-1">{translate("recipients")}</label>
        <div className="mb-2 flex flex-col gap-2 sm:flex-row">
          <input
            value={recipientDraft}
            onChange={(e) => setRecipientDraft(e.target.value)}
            placeholder={translate("nameExampleCom")}
            className="min-w-0 flex-1 border border-border bg-background text-foreground rounded px-3 py-2 text-sm placeholder:text-muted-foreground"
          />
          <Button type="button" variant="outline" className="sm:w-auto" onClick={addRecipient}>
            {translate("add")}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {recipients.map((email) => (
            <span
              key={email}
              className="bg-muted text-foreground rounded-full px-3 py-1 text-xs flex min-w-0 items-center gap-1"
            >
              <span className="truncate">{email}</span>
              <button
                type="button"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() =>
                  setValue(
                    "recipient_emails",
                    recipients.filter((r) => r !== email),
                    { shouldValidate: true }
                  )
                }
              >
                ×
              </button>
            </span>
          ))}
        </div>
        {errors.recipient_emails && (
          <p className="text-xs text-destructive mt-1">{errors.recipient_emails.message}</p>
        )}
      </div>

      <div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" {...register("is_active")} />
          {translate("active")}
        </label>
      </div>

      <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:gap-3">
        <Button type="submit" disabled={isSubmitting || accountsLoading || accountsError}>
          {report ? translate("saveChanges") : translate("createReport")}
        </Button>
        {report && (
          <Button type="button" variant="outline" onClick={handleSendTest} disabled={sendingTest}>
            {sendingTest ? translate("sending") : translate("sendTestNow")}
          </Button>
        )}
      </div>
      {submitError && <p className="text-xs text-destructive">{submitError}</p>}
      {sendTestError && <p className="text-xs text-destructive">{sendTestError}</p>}
      {sendTestSuccess && (
        <p className="text-xs text-muted-foreground">
          {translate("testQueuedCheckTheRunsTabForDeliveryStatus")}
        </p>
      )}
    </form>
  );
}
