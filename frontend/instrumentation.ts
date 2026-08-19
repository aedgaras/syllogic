import type { Instrumentation } from "next";
import { logger } from "@/lib/logger";

let logLevelSyncStarted = false;

// Keeps process.env.LOG_LEVEL in sync with the database setting (Settings >
// Authentication, admin only), which lib/logger.ts reads on every call. This
// is what makes the server-side log level adjustable from the UI without a
// restart. Runs once per server instance.
function startLogLevelSync(intervalMs = 15_000): void {
  if (logLevelSyncStarted) return;
  logLevelSyncStarted = true;

  const sync = async () => {
    try {
      const { getEffectiveLogLevelCached } = await import("@/lib/log-level");
      const status = await getEffectiveLogLevelCached();
      process.env.LOG_LEVEL = status.level;
    } catch {
      // Transient DB error: keep the previous LOG_LEVEL rather than spamming logs.
    }
  };

  void sync();
  setInterval(sync, intervalMs).unref();
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  startLogLevelSync();
}

function errorDetails(error: unknown) {
  if (!(error instanceof Error)) {
    return { value: String(error) };
  }

  const extended = error as Error & {
    code?: unknown;
    digest?: unknown;
    cause?: unknown;
  };

  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    code: extended.code,
    digest: extended.digest,
    cause:
      extended.cause instanceof Error
        ? {
            name: extended.cause.name,
            message: extended.cause.message,
            stack: extended.cause.stack,
          }
        : extended.cause,
  };
}

export const onRequestError: Instrumentation.onRequestError = (
  error,
  request,
  context,
) => {
  // Do not log request headers: they can contain session cookies and tokens.
  logger.error("request-error", {
    method: request.method,
    path: request.path,
    routePath: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource,
    error: errorDetails(error),
  });
};
