"use client";
import { t as translate } from "@/i18n/translate";

import { useCallback } from "react";
import { searchSymbolsAction } from "@/lib/actions/investments";
import type { SymbolSearchResult } from "@/lib/api/investments";
import { SearchAutocomplete } from "@/components/ui/search-autocomplete";
import { useDebouncedSearch } from "@/shared/client/hooks/use-debounced-search";

interface SymbolSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (result: SymbolSearchResult) => void;
  placeholder?: string;
  id?: string;
  className?: string;
}

export function SymbolSearchInput({
  value,
  onChange,
  onSelect,
  placeholder = translate("symbolExample"),
  id,
  className,
}: SymbolSearchInputProps) {
  const search = useCallback(
    (query: string) => searchSymbolsAction(query),
    [],
  );
  const { results, loading } = useDebouncedSearch<SymbolSearchResult>({
    query: value,
    search,
  });

  return (
    <SearchAutocomplete
      id={id}
      value={value}
      onChange={onChange}
      onSelect={onSelect}
      items={results}
      loading={loading}
      loadingLabel={translate("searching")}
      placeholder={placeholder}
      className={className}
      getItemKey={(r) => r.symbol}
      renderItem={(r) => (
        <div className="flex items-center gap-3">
          <span className="font-mono font-medium">{r.symbol}</span>
          <span className="truncate text-muted-foreground">{r.name}</span>
          {r.exchange && (
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {r.exchange}
            </span>
          )}
        </div>
      )}
    />
  );
}
