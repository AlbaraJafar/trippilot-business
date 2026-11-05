import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

/**
 * Vitest global setup: build a fresh, throwaway SQLite database (prisma/test.db) by applying the
 * committed migrations with `prisma migrate deploy`. This also proves the migrations apply cleanly.
 * Only the dedicated test file is ever removed — never the development database.
 */
const TEST_DB = path.resolve(__dirname, "../prisma/test.db");

export default function setup() {
  for (const f of [TEST_DB, `${TEST_DB}-journal`]) rmSync(f, { force: true });
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
    stdio: "pipe",
  });
}
