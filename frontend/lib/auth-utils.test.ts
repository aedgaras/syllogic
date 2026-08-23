import { describe, it, expect, vi, beforeEach } from "vitest";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession } },
}));

import { requireAuth, getCurrentUserId } from "./auth-utils";

describe("requireAuth", () => {
  beforeEach(() => {
    getSession.mockReset();
  });

  it("returns success with the userId when a session exists", async () => {
    getSession.mockResolvedValue({ user: { id: "user-1" } });
    const result = await requireAuth();
    expect(result).toEqual({ success: true, userId: "user-1" });
  });

  it("returns a failure when there is no session", async () => {
    getSession.mockResolvedValue(null);
    const result = await requireAuth();
    expect(result).toEqual({ success: false, error: "Not authenticated" });
  });

  it("returns a failure when the session has no user id", async () => {
    getSession.mockResolvedValue({ user: {} });
    const result = await requireAuth();
    expect(result).toEqual({ success: false, error: "Not authenticated" });
  });
});

describe("getCurrentUserId", () => {
  beforeEach(() => {
    getSession.mockReset();
  });

  it("returns the userId when a session exists", async () => {
    getSession.mockResolvedValue({ user: { id: "user-1" } });
    expect(await getCurrentUserId()).toBe("user-1");
  });

  it("returns null when there is no session", async () => {
    getSession.mockResolvedValue(null);
    expect(await getCurrentUserId()).toBeNull();
  });
});
