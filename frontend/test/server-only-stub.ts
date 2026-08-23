// vitest.config.ts aliases "server-only" here — the real package throws
// unconditionally unless a bundler applies Next.js's special server/client
// resolve conditions, which vitest doesn't. Tests never care about the
// server/client boundary, so this is a harmless no-op.
export {};
