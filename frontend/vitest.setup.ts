import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Some client components transitively import server modules (e.g. lib/db)
// through actions used only behind runtime branches never exercised in
// tests. lib/db throws at import time without DATABASE_URL, so provide a
// harmless placeholder — postgres-js connects lazily, so no real
// connection is attempted unless a test actually queries the database.
process.env.DATABASE_URL ??=
  "postgresql://test:test@localhost:5432/test_db";

afterEach(() => {
  cleanup();
});
