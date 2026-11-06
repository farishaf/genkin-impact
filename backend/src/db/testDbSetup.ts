import "dotenv/config";
import pg from "pg";

// Vitest globalSetup: create the test database (see vitest.config.ts) if it does not exist yet.
// Runs in the main vitest process, where process.env.DATABASE_URL is still the dev database.
export default async function setup() {
  const devUrl = process.env.DATABASE_URL;
  const testUrl = process.env.TEST_DATABASE_URL ?? (() => {
    const u = new URL(devUrl ?? "");
    u.pathname += "_test";
    return u.toString();
  })();
  if (!devUrl || testUrl === devUrl) throw new Error("test database must differ from DATABASE_URL");

  const testDb = decodeURIComponent(new URL(testUrl).pathname.slice(1));
  const client = new pg.Client({ connectionString: devUrl });
  await client.connect();
  try {
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [testDb]);
    if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${testDb.replace(/"/g, '""')}"`);
  } finally {
    await client.end();
  }
}
