/**
 * Leveled logger for both server and browser code. Import as
 * `import { logger } from "@/lib/logger"` in place of raw `console.*` calls.
 *
 * Level resolution:
 * - Server: `LOG_LEVEL` env var (default "info" in production, "debug"
 *   otherwise). `process.env.LOG_LEVEL` is kept in sync with the database
 *   setting made from Settings > Authentication (admin) by a background
 *   poller — see instrumentation.ts / lib/log-level.ts. That poll updates
 *   this same env var, so no server restart is needed for a UI change to
 *   take effect.
 * - Browser: `NEXT_PUBLIC_LOG_LEVEL` (default "warn" in production, "debug"
 *   otherwise). This is inlined at build time, so it is not adjustable from
 *   the UI at runtime — only the server side is.
 *
 * In production, server-side output is a single-line JSON object per call
 * (for log aggregators); everywhere else it stays human-readable.
 */

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const VALID_LEVELS: readonly Level[] = ["debug", "info", "warn", "error"];

function parseLevel(value: string | undefined | null): Level | null {
  const normalized = value?.trim().toLowerCase();
  return (VALID_LEVELS as readonly string[]).includes(normalized ?? "")
    ? (normalized as Level)
    : null;
}

function currentLevel(): Level {
  const isServer = typeof window === "undefined";
  if (isServer) {
    return (
      parseLevel(process.env.LOG_LEVEL) ??
      (process.env.NODE_ENV === "production" ? "info" : "debug")
    );
  }
  return (
    parseLevel(process.env.NEXT_PUBLIC_LOG_LEVEL) ??
    (process.env.NODE_ENV === "production" ? "warn" : "debug")
  );
}

function shouldLog(level: Level): boolean {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[currentLevel()];
}

function consoleSink(level: Level): (...args: unknown[]) => void {
  if (level === "error") return console.error;
  if (level === "warn") return console.warn;
  if (level === "debug") return console.debug;
  return console.info;
}

function write(level: Level, message: string, meta?: Record<string, unknown>) {
  if (!shouldLog(level)) return;

  const sink = consoleSink(level);
  const isServer = typeof window === "undefined";
  if (isServer && process.env.NODE_ENV === "production") {
    sink(JSON.stringify({ time: new Date().toISOString(), level, message, ...meta }));
    return;
  }

  if (meta && Object.keys(meta).length > 0) {
    sink(`[${level}] ${message}`, meta);
  } else {
    sink(`[${level}] ${message}`);
  }
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => write("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => write("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write("error", message, meta),
};
