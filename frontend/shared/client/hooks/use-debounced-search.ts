"use client";

import { useEffect, useRef, useState } from "react";

interface UseDebouncedSearchOptions<T> {
  query: string;
  search: (query: string) => Promise<T[]>;
  debounceMs?: number;
  minLength?: number;
}

export function useDebouncedSearch<T>({
  query,
  search,
  debounceMs = 350,
  minLength = 2,
}: UseDebouncedSearchOptions<T>) {
  const [results, setResults] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRequestRef = useRef(0);
  const searchRef = useRef(search);
  searchRef.current = search;

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim() || query.length < minLength) {
      // Invalidate any in-flight request so its late response can't
      // repaint results after the query is cleared.
      latestRequestRef.current++;
      setResults([]);
      setLoading(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const requestId = ++latestRequestRef.current;
      setLoading(true);
      try {
        const hits = await searchRef.current(query.trim());
        if (requestId !== latestRequestRef.current) return;
        setResults(hits);
      } catch {
        if (requestId !== latestRequestRef.current) return;
        setResults([]);
      } finally {
        if (requestId === latestRequestRef.current) setLoading(false);
      }
    }, debounceMs);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, debounceMs, minLength]);

  return { results, loading };
}
