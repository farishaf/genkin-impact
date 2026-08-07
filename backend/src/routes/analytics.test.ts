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
  await pool.query("UPDATE transactions SET installment_plan_id = NULL WHERE installment_plan_id IS NOT NULL");
  await pool.query("DELETE FROM installment_plans");
  await pool.query("DELETE FROM transactions");
  await pool.query("DELETE FROM budgets");
  await pool.query("DELETE FROM savings_goals");
  await pool.query("DELETE FROM recurring_rules");
  await pool.query("DELETE FROM accounts");
  await pool.query("DELETE FROM sessions");
  await pool.query("DELETE FROM members");
  await pool.query("DELETE FROM categories");
  await pool.query("DELETE FROM tags");
  await pool.query("DELETE FROM saved_filters");
  await pool.query("DELETE FROM users");
});

afterAll(async () => {
  await pool.end();
});

async function setupUser() {
  const agent = request.agent(app);
  await agent.post("/auth/register").send({ email: "analytics@example.com", password: "password12345", display_name: "Analytics User" });
  await agent.patch("/users/me").send({ main_currency_code: "USD" });
  await agent.post("/accounts").send({ name: "Checking", type: "bank", currency_code: "USD", opening_balance: "1000.00" });
  const accounts = await agent.get("/accounts");
  const accountId = accounts.body.accounts[0].id as string;
  const expenseCategories = await agent.get("/categories?kind=expense");
  const incomeCategories = await agent.get("/categories?kind=income");
  return {
    agent,
    accountId,
    expenseCategoryId: expenseCategories.body.categories[0].id as string,
    incomeCategoryId: incomeCategories.body.categories[0].id as string,
  };
}

describe("GET /analytics/summary", () => {
  it("marks a day loss (green) when expenditure exceeds income", async () => {
    const { agent, accountId, expenseCategoryId } = await setupUser();
    const today = new Date().toISOString();
    await agent.post("/transactions").send({ type: "expense", account_id: accountId, category_id: expenseCategoryId, amount: "50.00", occurred_at: today });

    const month = today.slice(0, 7);
    const res = await agent.get(`/analytics/summary?month=${month}`);
    expect(res.status).toBe(200);

    const day = res.body.days.find((d: { date: string }) => d.date === today.slice(0, 10));
    expect(day.sign).toBe("loss");
    expect(day.bucket).toBe("high");
    expect(res.body.month_expenditure_minor).toBe("5000");
  });

  it("marks a day gain (red) when income exceeds expenditure", async () => {
    const { agent, accountId, incomeCategoryId } = await setupUser();
    const today = new Date().toISOString();
    await agent.post("/transactions").send({ type: "income", account_id: accountId, category_id: incomeCategoryId, amount: "200.00", occurred_at: today });

    const month = today.slice(0, 7);
    const res = await agent.get(`/analytics/summary?month=${month}`);
    const day = res.body.days.find((d: { date: string }) => d.date === today.slice(0, 10));
    expect(day.sign).toBe("gain");
    expect(res.body.month_income_minor).toBe("20000");
  });

  it("fills every day of the month, neutral where there are no transactions", async () => {
    const { agent } = await setupUser();
    const res = await agent.get("/analytics/summary?month=2026-02");
    expect(res.body.days).toHaveLength(28);
    expect(res.body.days.every((d: { sign: string; bucket: string }) => d.sign === "neutral" && d.bucket === "none")).toBe(true);
  });

  it("rejects a malformed month", async () => {
    const { agent } = await setupUser();
    const res = await agent.get("/analytics/summary?month=2026-8");
    expect(res.status).toBe(400);
  });

  it("excludes an installment plan's origin transaction from the day total", async () => {
    const { agent, accountId, expenseCategoryId } = await setupUser();
    const today = new Date().toISOString();
    const created = await agent.post("/transactions").send({ type: "expense", account_id: accountId, category_id: expenseCategoryId, amount: "300.00", occurred_at: today });
    await agent.post(`/transactions/${created.body.transaction.id}/installments`).send({
      installment_count: 3, interval_unit: "month", first_due_date: today.slice(0, 10),
    });

    const month = today.slice(0, 7);
    const res = await agent.get(`/analytics/summary?month=${month}`);
    const day = res.body.days.find((d: { date: string }) => d.date === today.slice(0, 10));
    // Only the first installment (100.00) falls in this month — not the origin's 300.00, not the later installments.
    expect(day.sign).toBe("loss");
    expect(res.body.month_expenditure_minor).toBe("10000");
  });
});
