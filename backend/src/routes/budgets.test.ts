import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../app.js";
import { pool } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";

beforeAll(async () => {
  await runMigrations();
});

beforeEach(async () => {
  await pool.query("DELETE FROM transaction_tags");
  await pool.query("DELETE FROM transactions");
  await pool.query("DELETE FROM budgets");
  await pool.query("DELETE FROM savings_goals");
  await pool.query("DELETE FROM recurring_rules");
  await pool.query("DELETE FROM accounts");
  await pool.query("DELETE FROM sessions");
  await pool.query("DELETE FROM members");
  await pool.query("DELETE FROM categories");
  await pool.query("DELETE FROM tags");
  await pool.query("DELETE FROM users");
});

afterAll(async () => {
  await pool.end();
});

async function setupUser() {
  const agent = request.agent(app);
  await agent.post("/auth/register").send({ email: "budgets@example.com", password: "password12345", display_name: "Budget User" });
  await agent.patch("/users/me").send({ main_currency_code: "USD" });
  await agent.post("/accounts").send({ name: "Checking", type: "bank", currency_code: "USD", opening_balance: "1000.00" });
  const categories = await agent.get("/categories?kind=expense");
  const categoryId = categories.body.categories[0].id as string;
  return { agent, categoryId };
}

describe("POST /budgets", () => {
  it("creates a category-scoped monthly budget", async () => {
    const { agent, categoryId } = await setupUser();
    const res = await agent.post("/budgets").send({
      name: "Groceries",
      category_id: categoryId,
      limit_amount: "300.00",
      currency_code: "USD",
      period: "monthly",
      start_date: "2026-08-01",
    });
    expect(res.status).toBe(201);
    expect(res.body.budget.limit_amount).toBe("30000");
    expect(res.body.budget.is_active).toBe(true);
  });

  it("rejects a budget scoped to an income category", async () => {
    const { agent } = await setupUser();
    const incomeCategories = await agent.get("/categories?kind=income");
    const res = await agent.post("/budgets").send({
      name: "Bad",
      category_id: incomeCategories.body.categories[0].id,
      limit_amount: "100.00",
      currency_code: "USD",
      period: "monthly",
      start_date: "2026-08-01",
    });
    expect(res.status).toBe(400);
  });

  it("allows an overall budget with no category_id", async () => {
    const { agent } = await setupUser();
    const res = await agent.post("/budgets").send({
      name: "Everything",
      limit_amount: "1000.00",
      currency_code: "USD",
      period: "monthly",
      start_date: "2026-08-01",
    });
    expect(res.status).toBe(201);
    expect(res.body.budget.category_id).toBeNull();
  });
});

describe("GET /budgets", () => {
  it("reports spent and remaining against expenses in the current period", async () => {
    const { agent, categoryId } = await setupUser();
    await agent.post("/budgets").send({
      name: "Groceries",
      category_id: categoryId,
      limit_amount: "300.00",
      currency_code: "USD",
      period: "monthly",
      start_date: new Date().toISOString().slice(0, 10),
    });

    const accountsRes = await agent.get("/accounts");
    const accountId = accountsRes.body.accounts[0].id;

    await agent.post("/transactions").send({
      type: "expense",
      account_id: accountId,
      category_id: categoryId,
      amount: "45.00",
      occurred_at: new Date().toISOString(),
    });

    const res = await agent.get("/budgets");
    expect(res.status).toBe(200);
    expect(res.body.budgets).toHaveLength(1);
    expect(res.body.budgets[0].spent_minor).toBe("4500");
    expect(res.body.budgets[0].remaining_minor).toBe("25500");
    expect(res.body.budgets[0].pct).toBe(15);
  });

  it("excludes archived (soft-deleted) budgets", async () => {
    const { agent } = await setupUser();
    const created = await agent.post("/budgets").send({
      name: "Temp",
      limit_amount: "100.00",
      currency_code: "USD",
      period: "weekly",
      start_date: "2026-08-01",
    });
    await agent.delete(`/budgets/${created.body.budget.id}`);

    const res = await agent.get("/budgets");
    expect(res.body.budgets).toHaveLength(0);
  });
});

describe("PATCH /budgets/:id", () => {
  it("updates the limit amount", async () => {
    const { agent } = await setupUser();
    const created = await agent.post("/budgets").send({
      name: "Groceries",
      limit_amount: "300.00",
      currency_code: "USD",
      period: "monthly",
      start_date: "2026-08-01",
    });
    const res = await agent.patch(`/budgets/${created.body.budget.id}`).send({ limit_amount: "500.00" });
    expect(res.status).toBe(200);
    expect(res.body.budget.limit_amount).toBe("50000");
  });
});
