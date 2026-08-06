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
  await agent.post("/auth/register").send({ email: "savings@example.com", password: "password12345", display_name: "Savings User" });
  await agent.patch("/users/me").send({ main_currency_code: "USD" });
  await agent.post("/accounts").send({ name: "Checking", type: "bank", currency_code: "USD", opening_balance: "1000.00" });
  return agent;
}

describe("manual (unlinked) savings goals", () => {
  it("creates a goal and accepts contributions until achieved", async () => {
    const agent = await setupUser();
    const created = await agent.post("/savings-goals").send({
      name: "New laptop",
      target_amount: "1000.00",
      currency_code: "USD",
    });
    expect(created.status).toBe(201);

    const contrib1 = await agent.post(`/savings-goals/${created.body.savings_goal.id}/contribute`).send({ amount: "400.00" });
    expect(contrib1.body.savings_goal.contributed_amount).toBe("40000");
    expect(contrib1.body.savings_goal.status).toBe("active");

    const contrib2 = await agent.post(`/savings-goals/${created.body.savings_goal.id}/contribute`).send({ amount: "700.00" });
    expect(contrib2.body.savings_goal.contributed_amount).toBe("110000");
    expect(contrib2.body.savings_goal.status).toBe("achieved");
  });

  it("reflects contributions in GET progress", async () => {
    const agent = await setupUser();
    const created = await agent.post("/savings-goals").send({ name: "Trip", target_amount: "500.00", currency_code: "USD" });
    await agent.post(`/savings-goals/${created.body.savings_goal.id}/contribute`).send({ amount: "125.00" });

    const res = await agent.get("/savings-goals");
    expect(res.body.savings_goals[0].progress_minor).toBe("12500");
    expect(res.body.savings_goals[0].pct).toBe(25);
  });
});

describe("account-linked savings goals", () => {
  it("derives currency from the linked account and rejects manual contributions", async () => {
    const agent = await setupUser();
    const accountsRes = await agent.get("/accounts");
    const accountId = accountsRes.body.accounts[0].id;

    const created = await agent.post("/savings-goals").send({
      name: "Emergency fund",
      account_id: accountId,
      target_amount: "2000.00",
      currency_code: "EUR",
    });
    expect(created.status).toBe(201);
    expect(created.body.savings_goal.currency_code).toBe("USD");

    const contrib = await agent.post(`/savings-goals/${created.body.savings_goal.id}/contribute`).send({ amount: "10.00" });
    expect(contrib.status).toBe(400);
  });

  it("tracks progress from account balance growth", async () => {
    const agent = await setupUser();
    const accountsRes = await agent.get("/accounts");
    const accountId = accountsRes.body.accounts[0].id;
    const categories = await agent.get("/categories?kind=income");

    await agent.post("/savings-goals").send({ name: "Emergency fund", account_id: accountId, target_amount: "500.00", currency_code: "USD" });
    await agent.post("/transactions").send({
      type: "income",
      account_id: accountId,
      category_id: categories.body.categories[0].id,
      amount: "250.00",
      occurred_at: new Date().toISOString(),
    });

    const res = await agent.get("/savings-goals");
    expect(res.body.savings_goals[0].progress_minor).toBe("25000");
    expect(res.body.savings_goals[0].pct).toBe(50);
  });
});

describe("DELETE /savings-goals/:id", () => {
  it("archives instead of hard-deleting", async () => {
    const agent = await setupUser();
    const created = await agent.post("/savings-goals").send({ name: "Temp", target_amount: "100.00", currency_code: "USD" });
    const del = await agent.delete(`/savings-goals/${created.body.savings_goal.id}`);
    expect(del.status).toBe(204);

    const res = await agent.get("/savings-goals");
    expect(res.body.savings_goals).toHaveLength(0);
  });
});
