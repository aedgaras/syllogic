"use client";

import type { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface AccountSelectOption {
  id: string;
  name: string;
  currency?: string | null;
}

interface AccountSelectProps<T extends AccountSelectOption> {
  accounts: T[];
  value: string;
  onChange: (accountId: string) => void;
  placeholder: string;
  id?: string;
  className?: string;
  contentClassName?: string;
  itemClassName?: string;
  disabled?: boolean;
  renderItemLabel?: (account: T) => ReactNode;
  renderTriggerLabel?: (account: T) => ReactNode;
}

export function AccountSelect<T extends AccountSelectOption>({
  accounts,
  value,
  onChange,
  placeholder,
  id,
  className,
  contentClassName,
  itemClassName,
  disabled,
  renderItemLabel = (account) => account.name,
  renderTriggerLabel = renderItemLabel,
}: AccountSelectProps<T>) {
  const selected = accounts.find((account) => account.id === value);

  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(v) => onChange(v ?? "")}
    >
      <SelectTrigger id={id} className={className}>
        <SelectValue placeholder={placeholder}>
          {selected ? renderTriggerLabel(selected) : placeholder}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className={contentClassName}>
        {accounts.map((account) => (
          <SelectItem
            key={account.id}
            value={account.id}
            className={itemClassName}
          >
            {renderItemLabel(account)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
