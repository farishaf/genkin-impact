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

  it("returns net worth in the main currency, summing non-archived non-excluded accounts", async () => {
    const agent = await registerAndLogin();
    await agent.patch("/users/me").send({ main_currency_code: "USD" });
    await agent.post("/accounts").send({ name: "Checking", type: "bank", currency_code: "USD", opening_balance: "100.00" });

    const res = await agent.get("/accounts");
    expect(res.status).toBe(200);
    expect(res.body.main_currency_code).toBe("USD");
    expect(res.body.net_worth_minor).toBe("10000");
  });
});

describe("PATCH /accounts/:id", () => {
  it("renames an account", async () => {
    const agent = await registerAndLogin();
    const created = await agent.post("/accounts").send({ name: "Checking", type: "bank", currency_code: "USD", opening_balance: "100.00" });

    const res = await agent.patch(`/accounts/${created.body.account.id}`).send({ name: "Main Checking" });
    expect(res.status).toBe(200);
    expect(res.body.account.name).toBe("Main Checking");
  });

  it("archives an account, removing it from the default list and its balance from net worth", async () => {
    const agent = await registerAndLogin();
    await agent.patch("/users/me").send({ main_currency_code: "USD" });
    const created = await agent.post("/accounts").send({ name: "Checking", type: "bank", currency_code: "USD", opening_balance: "100.00" });

    const patchRes = await agent.patch(`/accounts/${created.body.account.id}`).send({ is_archived: true });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.account.is_archived).toBe(true);

    const listRes = await agent.get("/accounts");
    expect(listRes.body.accounts).toHaveLength(0);
    expect(listRes.body.net_worth_minor).toBe("0");

    const includeArchivedRes = await agent.get("/accounts?include_archived=true");
    expect(includeArchivedRes.body.accounts).toHaveLength(1);
  });

  it("excludes an account from net worth without archiving it", async () => {
    const agent = await registerAndLogin();
    await agent.patch("/users/me").send({ main_currency_code: "USD" });
    const created = await agent.post("/accounts").send({ name: "Checking", type: "bank", currency_code: "USD", opening_balance: "100.00" });

    await agent.patch(`/accounts/${created.body.account.id}`).send({ exclude_from_net_worth: true });

    const listRes = await agent.get("/accounts");
    expect(listRes.body.accounts).toHaveLength(1);
    expect(listRes.body.net_worth_minor).toBe("0");
  });

  it("sets credit_limit and statement_day on a credit_card account", async () => {
    const agent = await registerAndLogin();
    const created = await agent
      .post("/accounts")
      .send({ name: "Visa", type: "credit_card", currency_code: "USD", opening_balance: "0" });

    const res = await agent.patch(`/accounts/${created.body.account.id}`).send({ credit_limit: "5000.00", statement_day: 15 });
    expect(res.status).toBe(200);
    expect(res.body.account.credit_limit).toBe("500000");
    expect(res.body.account.statement_day).toBe(15);
  });

  it("rejects statement_day on a non-credit_card account", async () => {
    const agent = await registerAndLogin();
    const created = await agent.post("/accounts").send({ name: "Checking", type: "bank", currency_code: "USD", opening_balance: "0" });

    const res = await agent.patch(`/accounts/${created.body.account.id}`).send({ statement_day: 15 });
    expect(res.status).toBe(400);
  });

  it("404s for another user's account", async () => {
    const agent = await registerAndLogin();
    const created = await agent.post("/accounts").send({ name: "Checking", type: "bank", currency_code: "USD", opening_balance: "0" });

    const otherAgent = request.agent(app);
    await otherAgent.post("/auth/register").send({ email: "other2@example.com", password: "password12345", display_name: "Other" });

    const res = await otherAgent.patch(`/accounts/${created.body.account.id}`).send({ name: "Hijacked" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /accounts/:id", () => {
  it("soft-deletes an account so it disappears even with include_archived", async () => {
    const agent = await registerAndLogin();
    const created = await agent.post("/accounts").send({ name: "Checking", type: "bank", currency_code: "USD", opening_balance: "0" });

    const res = await agent.delete(`/accounts/${created.body.account.id}`);
    expect(res.status).toBe(204);

    const listRes = await agent.get("/accounts?include_archived=true");
    expect(listRes.body.accounts).toHaveLength(0);
  });

  it("404s for another user's account", async () => {
    const agent = await registerAndLogin();
    const created = await agent.post("/accounts").send({ name: "Checking", type: "bank", currency_code: "USD", opening_balance: "0" });

    const otherAgent = request.agent(app);
    await otherAgent.post("/auth/register").send({ email: "other3@example.com", password: "password12345", display_name: "Other" });

    const res = await otherAgent.delete(`/accounts/${created.body.account.id}`);
    expect(res.status).toBe(404);
  });
});
