import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 15000,
    // Integration test files share one real Postgres instance (no per-file
    // schema isolation). Running files in parallel lets one file's cleanup
    // DELETE race another file's concurrent inserts (FK violations) and lets
    // unfiltered aggregate queries (e.g. "count all categories") pick up rows
    // from a different file's users. Force sequential file execution so each
    // file's beforeEach/it sequence has exclusive access to the DB.
    fileParallelism: false,
  },
});
