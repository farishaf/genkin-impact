import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../app.js";
import { pool } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";
import { runRecurringRulesTick } from "../jobs/runRecurringRules.js";

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
  await agent.post("/auth/register").send({ email: "recurring@example.com", password: "password12345", display_name: "Recurring User" });
  await agent.patch("/users/me").send({ main_currency_code: "USD" });
  await agent.post("/accounts").send({ name: "Checking", type: "bank", currency_code: "USD", opening_balance: "1000.00" });
  const accountsRes = await agent.get("/accounts");
  const categories = await agent.get("/categories?kind=expense");
  return { agent, accountId: accountsRes.body.accounts[0].id as string, categoryId: categories.body.categories[0].id as string };
}

function yesterday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

describe("POST /recurring-rules", () => {
  it("creates a daily expense rule", async () => {
    const { agent, accountId, categoryId } = await setupUser();
    const res = await agent.post("/recurring-rules").send({
      name: "Coffee subscription",
      txn_type: "expense",
      account_id: accountId,
      category_id: categoryId,
      amount: "5.00",
      frequency: "daily",
      starts_on: yesterday(),
      auto_post: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.recurring_rule.amount).toBe("500");
    expect(res.body.recurring_rule.is_active).toBe(true);
  });
});

describe("runRecurringRulesTick", () => {
  it("auto-posts a due rule as a cleared transaction and updates the account balance", async () => {
    const { agent, accountId, categoryId } = await setupUser();
    const rule = await agent.post("/recurring-rules").send({
      name: "Coffee subscription",
      txn_type: "expense",
      account_id: accountId,
      category_id: categoryId,
      amount: "5.00",
      frequency: "daily",
      starts_on: yesterday(),
      auto_post: true,
    });

    const processed = await runRecurringRulesTick();
    expect(processed).toBe(1);

    const accountsRes = await agent.get("/accounts");
    expect(accountsRes.body.accounts[0].cached_balance).toBe("99500");

    const txnRes = await pool.query("SELECT * FROM transactions WHERE recurring_rule_id = $1", [rule.body.recurring_rule.id]);
    expect(txnRes.rows).toHaveLength(1);
    expect(txnRes.rows[0].status).toBe("cleared");

    const ruleRes = await pool.query("SELECT next_run_at FROM recurring_rules WHERE id = $1", [rule.body.recurring_rule.id]);
    expect(new Date(ruleRes.rows[0].next_run_at).getTime()).toBeGreaterThan(new Date(yesterday()).getTime());
  });

  it("creates a pending transaction for non-auto_post rules, excluded from the balance until confirmed", async () => {
    const { agent, accountId, categoryId } = await setupUser();
    const rule = await agent.post("/recurring-rules").send({
      name: "Rent (needs confirm)",
      txn_type: "expense",
      account_id: accountId,
      category_id: categoryId,
      amount: "800.00",
      frequency: "monthly",
      starts_on: yesterday(),
      auto_post: false,
    });

    await runRecurringRulesTick();

    const accountsRes = await agent.get("/accounts");
    expect(accountsRes.body.accounts[0].cached_balance).toBe("100000");

    const list = await agent.get("/recurring-rules");
    const listed = list.body.recurring_rules.find((r: { id: string }) => r.id === rule.body.recurring_rule.id);
    expect(listed.pending_transaction).not.toBeNull();

    const confirm = await agent.post(`/recurring-rules/${rule.body.recurring_rule.id}/confirm`);
    expect(confirm.status).toBe(200);
    expect(confirm.body.transaction.status).toBe("cleared");

    const afterConfirm = await agent.get("/accounts");
    expect(afterConfirm.body.accounts[0].cached_balance).toBe("20000");
  });

  it("dismisses a pending transaction without affecting the balance", async () => {
    const { agent, accountId, categoryId } = await setupUser();
    const rule = await agent.post("/recurring-rules").send({
      name: "Rent (dismissed)",
      txn_type: "expense",
      account_id: accountId,
      category_id: categoryId,
      amount: "800.00",
      frequency: "monthly",
      starts_on: yesterday(),
      auto_post: false,
    });

    await runRecurringRulesTick();
    const dismiss = await agent.post(`/recurring-rules/${rule.body.recurring_rule.id}/dismiss`);
    expect(dismiss.status).toBe(204);

    const list = await agent.get("/recurring-rules");
    const listed = list.body.recurring_rules.find((r: { id: string }) => r.id === rule.body.recurring_rule.id);
    expect(listed.pending_transaction).toBeNull();

    const accountsRes = await agent.get("/accounts");
    expect(accountsRes.body.accounts[0].cached_balance).toBe("100000");
  });

  it("deactivates a rule once its next run would be past ends_on", async () => {
    const { agent, accountId, categoryId } = await setupUser();
    const rule = await agent.post("/recurring-rules").send({
      name: "Short-lived",
      txn_type: "expense",
      account_id: accountId,
      category_id: categoryId,
      amount: "5.00",
      frequency: "daily",
      starts_on: yesterday(),
      ends_on: yesterday(),
      auto_post: true,
    });

    await runRecurringRulesTick();

    const ruleRes = await pool.query("SELECT is_active FROM recurring_rules WHERE id = $1", [rule.body.recurring_rule.id]);
    expect(ruleRes.rows[0].is_active).toBe(false);
  });
});

describe("DELETE /recurring-rules/:id", () => {
  it("deactivates instead of hard-deleting", async () => {
    const { agent, accountId, categoryId } = await setupUser();
    const rule = await agent.post("/recurring-rules").send({
      name: "Temp",
      txn_type: "expense",
      account_id: accountId,
      category_id: categoryId,
      amount: "5.00",
      frequency: "daily",
      starts_on: yesterday(),
    });
    const del = await agent.delete(`/recurring-rules/${rule.body.recurring_rule.id}`);
    expect(del.status).toBe(204);

    const ruleRes = await pool.query("SELECT is_active FROM recurring_rules WHERE id = $1", [rule.body.recurring_rule.id]);
    expect(ruleRes.rows[0].is_active).toBe(false);
  });
});
