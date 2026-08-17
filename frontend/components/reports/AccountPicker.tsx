"use client";
import { t as translate } from "@/i18n/translate";


import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { groupAccounts, type PickerAccount } from "@/lib/reports/account-groups";
import { listOwners, listPeople } from "@/lib/reports/api";

export function AccountPicker({
  accounts,
  selectedIds,
  onChange,
  loading,
  error,
}: {
  accounts: PickerAccount[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  loading: boolean;
  error: boolean;
}) {
  const accountIds = useMemo(() => accounts.map((a) => a.id), [accounts]);
  const { data: ownerNames = {} } = useQuery({
    queryKey: ["reports", "account-owner-names", accountIds],
    queryFn: async () => {
      const [people, owners] = await Promise.all([
        listPeople(),
        listOwners(accountIds),
      ]);
      const nameById = new Map(people.map((p) => [p.id, p.name]));
      const next: Record<string, string[]> = {};
      for (const [accountId, rows] of Object.entries(owners)) {
        const names = rows
          .map((r) => nameById.get(r.personId))
          .filter((n): n is string => Boolean(n));
        if (names.length > 0) next[accountId] = names;
      }
      return next;
    },
    enabled: accountIds.length > 0,
    retry: false,
  });

  if (loading) return <p className="text-sm text-muted-foreground">{translate("loadingAccounts")}</p>;
  if (error) {
    return (
      <p className="text-sm text-destructive">{translate("failedToLoadAccountsPleaseRefreshAndTryAgain")}</p>
    );
  }

  // Inactive accounts are hidden by default to declutter the picker, but a
  // report's saved account_ids may reference one deactivated after the fact.
  // Always keep those visible (marked inactive) so the checked state stays
  // truthful and can still be unticked.
  const visibleAccounts = accounts.filter((a) => a.is_active || selectedIds.includes(a.id));
  const groups = groupAccounts(visibleAccounts);

  const toggle = (id: string, checked: boolean) =>
    onChange(checked ? [...selectedIds, id] : selectedIds.filter((x) => x !== id));

  return (
    <div className="space-y-3 border border-border rounded p-2 max-h-64 overflow-y-auto">
      {groups.map((group) => (
        <div key={group.key}>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
            {group.label}
          </p>
          <div className="space-y-1">
            {group.accounts.map((a) => (
              <label key={a.id} className="flex items-start gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selectedIds.includes(a.id)}
                  onChange={(e) => toggle(a.id, e.target.checked)}
                />
                <span>
                  {a.name}
                  {!a.is_active && (
                    <span className="text-xs text-muted-foreground"> {translate("inactive")}</span>
                  )}
                  {ownerNames[a.id] && (
                    <span className="block text-xs text-muted-foreground">
                      {ownerNames[a.id].join(", ")}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
