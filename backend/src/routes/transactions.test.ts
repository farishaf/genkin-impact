import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../app.js";
import { pool } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";

beforeAll(async () => {
  await runMigrations();
});

beforeEach(async () => {
  await pool.query("DELETE FROM transactions");
  await pool.query("DELETE FROM accounts");
  await pool.query("DELETE FROM sessions");
  await pool.query("DELETE FROM members");
  await pool.query("DELETE FROM categories");
  await pool.query("DELETE FROM users");
});

afterAll(async () => {
  await pool.end();
});

async function setUp() {
  const agent = request.agent(app);
  await agent.post("/auth/register").send({ email: "txn@example.com", password: "password12345", display_name: "Txn User" });
  await agent.patch("/users/me").send({ main_currency_code: "USD" });
  const accountRes = await agent.post("/accounts").send({ name: "Checking", type: "bank", currency_code: "USD", opening_balance: "1000.00" });
  const catRow = await pool.query("SELECT id FROM categories WHERE kind = 'expense' AND name = 'Delivery' LIMIT 1");
  return { agent, accountId: accountRes.body.account.id, categoryId: catRow.rows[0].id };
}

describe("POST /transactions", () => {
  it("creates an expense and recomputes the account balance", async () => {
    const { agent, accountId, categoryId } = await setUp();

    const res = await agent.post("/transactions").send({
      type: "expense",
      account_id: accountId,
      category_id: categoryId,
      amount: "68.00",
      occurred_at: "2026-08-04T09:41:00.000Z",
      note: "Lunch",
    });
    expect(res.status).toBe(201);
    expect(res.body.transaction.amount).toBe("6800");

    const accountRes = await agent.get("/accounts");
    expect(accountRes.body.accounts[0].cached_balance).toBe("93200"); // 1000.00 - 68.00 = 932.00
  });

  it("rejects a category whose kind doesn't match the transaction type", async () => {
    const { agent, accountId } = await setUp();
    const incomeCat = await pool.query("SELECT id FROM categories WHERE kind = 'income' LIMIT 1");

    const res = await agent.post("/transactions").send({
      type: "expense",
      account_id: accountId,
      category_id: incomeCat.rows[0].id,
      amount: "10.00",
      occurred_at: "2026-08-04T09:41:00.000Z",
    });
    expect(res.status).toBe(400);
  });

  it("creates a same-currency transfer and moves the balance on both accounts", async () => {
    const { agent, accountId } = await setUp();
    const secondAccountRes = await agent.post("/accounts").send({ name: "Savings", type: "bank", currency_code: "USD", opening_balance: "0.00" });
    const toAccountId = secondAccountRes.body.account.id;

    const res = await agent.post("/transactions").send({
      type: "transfer",
      account_id: accountId,
      to_account_id: toAccountId,
      amount: "100.00",
      occurred_at: "2026-08-04T09:41:00.000Z",
    });
    expect(res.status).toBe(201);
    expect(res.body.transaction.to_amount).toBe("10000");

    const accountsRes = await agent.get("/accounts");
    const byName: Record<string, string> = {};
    for (const a of accountsRes.body.accounts) byName[a.name] = a.cached_balance;
    expect(byName["Checking"]).toBe("90000"); // 1000 - 100
    expect(byName["Savings"]).toBe("10000"); // 0 + 100
  });

  it("rejects a non-positive amount", async () => {
    const { agent, accountId, categoryId } = await setUp();
    const res = await agent.post("/transactions").send({
      type: "expense",
      account_id: accountId,
      category_id: categoryId,
      amount: "0.00",
      occurred_at: "2026-08-04T09:41:00.000Z",
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /transactions", () => {
  it("filters by type and date range, ordered newest first", async () => {
    const { agent, accountId, categoryId } = await setUp();
    await agent.post("/transactions").send({ type: "expense", account_id: accountId, category_id: categoryId, amount: "10.00", occurred_at: "2026-08-01T00:00:00.000Z" });
    await agent.post("/transactions").send({ type: "expense", account_id: accountId, category_id: categoryId, amount: "20.00", occurred_at: "2026-08-03T00:00:00.000Z" });
    const incomeCat = await pool.query("SELECT id FROM categories WHERE kind = 'income' LIMIT 1");
    await agent.post("/transactions").send({ type: "income", account_id: accountId, category_id: incomeCat.rows[0].id, amount: "500.00", occurred_at: "2026-08-02T00:00:00.000Z" });

    const res = await agent.get("/transactions").query({ type: "expense", from: "2026-08-02", to: "2026-08-04" });
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].amount).toBe("2000");
  });
});

describe("GET /transactions/summary", () => {
  it("returns income, expenditure, balance, and count converted to main currency", async () => {
    const { agent, accountId, categoryId } = await setUp();
    const incomeCat = await pool.query("SELECT id FROM categories WHERE kind = 'income' LIMIT 1");
    await agent.post("/transactions").send({ type: "expense", account_id: accountId, category_id: categoryId, amount: "68.00", occurred_at: new Date().toISOString() });
    await agent.post("/transactions").send({ type: "income", account_id: accountId, category_id: incomeCat.rows[0].id, amount: "500.00", occurred_at: new Date().toISOString() });

    const res = await agent.get("/transactions/summary");
    expect(res.status).toBe(200);
    expect(res.body.summary.income_minor).toBe("50000");
    expect(res.body.summary.expenditure_minor).toBe("6800");
    expect(res.body.summary.count).toBe(2);
  });
});
