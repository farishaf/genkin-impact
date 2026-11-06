import "dotenv/config";
import { defineConfig } from "vitest/config";

// Tests wipe tables in beforeEach, so they must never touch the dev database.
// Default to "<dev db name>_test" on the same server; TEST_DATABASE_URL overrides.
function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const url = new URL(process.env.DATABASE_URL ?? "");
  url.pathname += "_test";
  return url.toString();
}

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 15000,
    env: { DATABASE_URL: testDatabaseUrl() },
    globalSetup: "./src/db/testDbSetup.ts",
    // Integration test files share one real Postgres instance (no per-file
    // schema isolation). Running files in parallel lets one file's cleanup
    // DELETE race another file's concurrent inserts (FK violations) and lets
    // unfiltered aggregate queries (e.g. "count all categories") pick up rows
    // from a different file's users. Force sequential file execution so each
    // file's beforeEach/it sequence has exclusive access to the DB.
    fileParallelism: false,
  },
});
