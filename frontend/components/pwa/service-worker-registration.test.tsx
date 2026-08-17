import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceWorkerRegistration } from "./service-worker-registration";

describe("ServiceWorkerRegistration", () => {
  const register = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    register.mockClear();
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("registers the root-scoped worker without HTTP cache reuse in production builds", async () => {
    render(<ServiceWorkerRegistration />);

    await waitFor(() =>
      expect(register).toHaveBeenCalledWith("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      })
    );
  });
});
