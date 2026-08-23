import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GLOBAL_FILTER_STORAGE_KEY } from "@/lib/filters/global-filters";

const { useSearchParams } = vi.hoisted(() => ({ useSearchParams: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams }));

import { useFilterPersistence } from "./use-filter-persistence";

describe("useFilterPersistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores the query string when the URL carries global filters", () => {
    useSearchParams.mockReturnValue(new URLSearchParams("account=a1"));
    renderHook(() => useFilterPersistence());
    expect(localStorage.getItem(GLOBAL_FILTER_STORAGE_KEY)).toBe(
      "account=a1",
    );
  });

  it("clears storage when the URL carries no global filters", () => {
    localStorage.setItem(GLOBAL_FILTER_STORAGE_KEY, "account=stale");
    useSearchParams.mockReturnValue(new URLSearchParams());
    renderHook(() => useFilterPersistence());
    expect(localStorage.getItem(GLOBAL_FILTER_STORAGE_KEY)).toBeNull();
  });

  it("re-persists when the search params change", () => {
    useSearchParams.mockReturnValue(new URLSearchParams("account=a1"));
    const { rerender } = renderHook(() => useFilterPersistence());
    expect(localStorage.getItem(GLOBAL_FILTER_STORAGE_KEY)).toBe(
      "account=a1",
    );

    useSearchParams.mockReturnValue(new URLSearchParams("account=a2"));
    rerender();
    expect(localStorage.getItem(GLOBAL_FILTER_STORAGE_KEY)).toBe(
      "account=a2",
    );
  });
});
