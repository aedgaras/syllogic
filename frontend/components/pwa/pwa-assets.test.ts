import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

describe("PWA assets", () => {
  it("exposes an installable root-scoped manifest with generated icons", () => {
    const result = manifest();

    expect(result).toMatchObject({
      id: "/",
      start_url: "/",
      scope: "/",
      display: "standalone",
    });

    for (const icon of result.icons ?? []) {
      const iconPath = path.join(process.cwd(), "public", icon.src.replace(/^\//, ""));
      expect(existsSync(iconPath), `${icon.src} should exist`).toBe(true);
    }
  });

  it("keeps authenticated responses out of the service-worker cache", () => {
    const worker = readFileSync(path.join(process.cwd(), "public/sw.js"), "utf8");

    expect(worker).toContain('event.request.mode !== "navigate"');
    expect(worker).not.toContain("cache.put(");
  });
});
