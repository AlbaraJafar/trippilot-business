import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // DB-backed tests use an isolated SQLite file rebuilt from the migrations before each run.
    globalSetup: ["tests/setup-db.ts"],
    env: { DATABASE_URL: "file:./test.db" },
  },
});
