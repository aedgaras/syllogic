import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalStorageProvider } from "./local";

let root: string | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe("LocalStorageProvider path containment", () => {
  it("stores and reads files inside the configured root", async () => {
    root = await mkdtemp(path.join(tmpdir(), "syllogic-storage-"));
    vi.stubEnv("LOCAL_STORAGE_PATH", root);
    const storage = new LocalStorageProvider();

    await storage.upload("profile/user.webp", Buffer.from("image"));
    await expect(storage.download("profile/user.webp")).resolves.toEqual(Buffer.from("image"));
  });

  it.each(["../escape", "nested/../../escape", "/tmp/escape"])(
    "rejects an escaping path: %s",
    async (unsafePath) => {
      root = await mkdtemp(path.join(tmpdir(), "syllogic-storage-"));
      vi.stubEnv("LOCAL_STORAGE_PATH", root);
      const storage = new LocalStorageProvider();

      await expect(storage.upload(unsafePath, Buffer.from("no"))).rejects.toThrow(/storage root|relative path/);
      await expect(storage.download(unsafePath)).rejects.toThrow(/storage root|relative path/);
      await expect(storage.delete(unsafePath)).rejects.toThrow(/storage root|relative path/);
    }
  );
});
