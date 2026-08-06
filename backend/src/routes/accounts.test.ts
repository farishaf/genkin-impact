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

async function registerAndLogin() {
  const agent = request.agent(app);
  await agent.post("/auth/register").send({ email: "acct@example.com", password: "password12345", display_name: "Acct User" });
  return agent;
}

describe("onboarding via PATCH /users/me + POST /accounts", () => {
  it("sets main currency, creates the first account, and marks onboarded_at", async () => {
    const agent = await registerAndLogin();

    const meBefore = await agent.get("/auth/me");
    expect(meBefore.body.user.onboarded_at).toBeNull();

    const currencyRes = await agent.patch("/users/me").send({ main_currency_code: "USD" });
    expect(currencyRes.status).toBe(200);
    expect(currencyRes.body.user.main_currency_code).toBe("USD");

    const accountRes = await agent.post("/accounts").send({
      name: "Checking",
      type: "bank",
      currency_code: "USD",
      opening_balance: "1500.00",
    });
    expect(accountRes.status).toBe(201);
    expect(accountRes.body.account.cached_balance).toBe("150000");
    expect(accountRes.body.account.balance_display).toBe("$1,500.00");

    const meAfter = await agent.get("/auth/me");
    expect(meAfter.body.user.onboarded_at).not.toBeNull();
  });

  it("does not re-touch onboarded_at when a second account is added later", async () => {
    const agent = await registerAndLogin();
    await agent.patch("/users/me").send({ main_currency_code: "USD" });
    await agent.post("/accounts").send({ name: "Checking", type: "bank", currency_code: "USD", opening_balance: "1500.00" });
    const meAfterFirst = await agent.get("/auth/me");
    const onboardedAt = meAfterFirst.body.user.onboarded_at;

    await agent.post("/accounts").send({ name: "Savings", type: "bank", currency_code: "USD", opening_balance: "200.00" });
    const meAfterSecond = await agent.get("/auth/me");
    expect(meAfterSecond.body.user.onboarded_at).toBe(onboardedAt);
  });
});

describe("POST /accounts validation", () => {
  it("rejects an opening_balance with more decimal places than the currency supports", async () => {
    const agent = await registerAndLogin();
    const res = await agent.post("/accounts").send({
      name: "Checking",
      type: "bank",
      currency_code: "USD",
      opening_balance: "100.999",
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /accounts", () => {
  it("lists only the current user's accounts", async () => {
    const agent = await registerAndLogin();
    await agent.post("/accounts").send({ name: "Checking", type: "bank", currency_code: "USD", opening_balance: "100.00" });

    const otherAgent = request.agent(app);
    await otherAgent.post("/auth/register").send({ email: "other@example.com", password: "password12345", display_name: "Other" });
    await otherAgent.post("/accounts").send({ name: "Other Checking", type: "bank", currency_code: "USD", opening_balance: "50.00" });

    const res = await agent.get("/accounts");
    expect(res.status).toBe(200);
    expect(res.body.accounts).toHaveLength(1);
    expect(res.body.accounts[0].name).toBe("Checking");
  });
});
