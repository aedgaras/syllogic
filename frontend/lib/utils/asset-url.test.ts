import { describe, it, expect } from "vitest";
import { withAssetVersion } from "./asset-url";

describe("withAssetVersion", () => {
  it("returns null for a null or undefined url", () => {
    expect(withAssetVersion(null)).toBeNull();
    expect(withAssetVersion(undefined)).toBeNull();
    expect(withAssetVersion("")).toBeNull();
  });

  it("returns the url unchanged when updatedAt is missing", () => {
    expect(withAssetVersion("/avatar.png")).toBe("/avatar.png");
  });

  it("appends a version query param derived from a Date", () => {
    const updatedAt = new Date("2024-01-01T00:00:00.000Z");
    expect(withAssetVersion("/avatar.png", updatedAt)).toBe(
      `/avatar.png?v=${updatedAt.getTime()}`,
    );
  });

  it("appends a version query param derived from a date string", () => {
    expect(withAssetVersion("/avatar.png", "2024-01-01T00:00:00.000Z")).toBe(
      `/avatar.png?v=${new Date("2024-01-01T00:00:00.000Z").getTime()}`,
    );
  });

  it("appends a version query param derived from a numeric timestamp", () => {
    expect(withAssetVersion("/avatar.png", 12345.9)).toBe(
      "/avatar.png?v=12345",
    );
  });

  it("preserves existing query params and overwrites an existing v param", () => {
    expect(withAssetVersion("/avatar.png?foo=bar&v=1", 999)).toBe(
      "/avatar.png?foo=bar&v=999",
    );
  });

  it("leaves non-finite numeric timestamps unversioned", () => {
    expect(withAssetVersion("/avatar.png", NaN)).toBe("/avatar.png");
    expect(withAssetVersion("/avatar.png", Infinity)).toBe("/avatar.png");
  });

  it("leaves unparseable date strings unversioned", () => {
    expect(withAssetVersion("/avatar.png", "not-a-date")).toBe(
      "/avatar.png",
    );
  });

  it("returns absolute (non-relative) urls unchanged even with updatedAt", () => {
    expect(
      withAssetVersion("https://cdn.example.com/avatar.png", new Date()),
    ).toBe("https://cdn.example.com/avatar.png");
  });
});
