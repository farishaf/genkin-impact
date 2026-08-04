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

  it("creates transactions, transaction_tags, exchange_rates and seeds today's USD rates", async () => {
    await runMigrations();
    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('transactions','transaction_tags','exchange_rates')`
    );
    expect(tables.rows.map((r) => r.table_name).sort()).toEqual(["exchange_rates", "transaction_tags", "transactions"]);

    const rates = await pool.query(
      `SELECT quote_code FROM exchange_rates WHERE base_code='USD' AND rate_date = CURRENT_DATE ORDER BY quote_code`
    );
    expect(rates.rows.map((r) => r.quote_code)).toEqual(["CNY", "EUR", "GBP", "HKD", "JPY", "USD"]);
  });
});
