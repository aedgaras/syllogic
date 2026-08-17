import { afterEach, describe, expect, it, vi } from "vitest";
import { createInternalAuthHeaders, INTERNAL_AUTH_SIGNATURE_HEADER } from "./internal-auth";

afterEach(() => vi.unstubAllEnvs());

describe("createInternalAuthHeaders", () => {
  it("binds the signature to the exact request body", () => {
    vi.stubEnv("INTERNAL_AUTH_SECRET", "test-secret");
    const base = {
      method: "POST",
      pathWithQuery: "/api/example",
      userId: "user-1",
      timestamp: "1700000000",
    };
    const first = createInternalAuthHeaders({ ...base, body: '{"amount":1}' });
    const changed = createInternalAuthHeaders({ ...base, body: '{"amount":999}' });

    expect(first[INTERNAL_AUTH_SIGNATURE_HEADER]).not.toBe(changed[INTERNAL_AUTH_SIGNATURE_HEADER]);
  });
});
