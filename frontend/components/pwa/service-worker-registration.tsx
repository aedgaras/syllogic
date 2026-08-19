"use client";

import { useEffect } from "react";
import { logger } from "@/lib/logger";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }

    const register = () => {
      void navigator.serviceWorker
        .register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        })
        .catch((error: unknown) => {
          logger.error("Unable to register the Syllogic service worker", {
            error,
          });
        });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
