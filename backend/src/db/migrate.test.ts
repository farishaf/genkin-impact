import { describe, it, expect, afterAll } from "vitest";
import { pool } from "./pool.js";
import { runMigrations } from "./migrate.js";

describe("runMigrations", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("creates currencies, users, sessions tables and seeds 6 currencies", async () => {
    await runMigrations();

    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('currencies','users','sessions')`
    );
    expect(tables.rows.map((r) => r.table_name).sort()).toEqual(["currencies", "sessions", "users"]);

    const currencies = await pool.query("SELECT code FROM currencies ORDER BY code");
    expect(currencies.rows.map((r) => r.code)).toEqual(["CNY", "EUR", "GBP", "HKD", "JPY", "USD"]);
  });

  it("creates accounts, categories, tags, members tables", async () => {
    await runMigrations();
    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('accounts','categories','tags','members')`
    );
    expect(tables.rows.map((r) => r.table_name).sort()).toEqual(["accounts", "categories", "members", "tags"]);
  });
});
