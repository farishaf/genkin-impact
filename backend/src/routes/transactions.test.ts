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

  it("rejects an amount with more decimal places than the account's currency supports", async () => {
    const { agent, accountId, categoryId } = await setUp();
    const res = await agent.post("/transactions").send({
      type: "expense",
      account_id: accountId,
      category_id: categoryId,
      amount: "10.999",
      occurred_at: "2026-08-04T09:41:00.000Z",
    });
    expect(res.status).toBe(400);
  });

  it("rejects a decimal amount against a 0-decimal (JPY) account", async () => {
    const { agent, categoryId } = await setUp();
    const jpyAccountRes = await agent.post("/accounts").send({ name: "Japan Cash", type: "cash", currency_code: "JPY", opening_balance: "1000" });
    const res = await agent.post("/transactions").send({
      type: "expense",
      account_id: jpyAccountRes.body.account.id,
      category_id: categoryId,
      amount: "10.5",
      occurred_at: "2026-08-04T09:41:00.000Z",
    });
    expect(res.status).toBe(400);
  });

  it("keeps cached_balance correct under concurrent expense creation against the same account (no lost updates)", async () => {
    // Regression test for C1: recomputeAccountBalance used to blind-write cached_balance
    // with no lock, so N concurrent expense creations against one account could each read
    // the same stale sum and race to overwrite each other's result, permanently corrupting
    // cached_balance (nothing ever recomputes on read). With the advisory lock in place,
    // each transaction serializes on the account and the final balance must exactly equal
    // opening_balance - N * amount.
    const { agent, accountId, categoryId } = await setUp();
    const N = 15;
    const amountMinor = 100n; // "1.00"

    await Promise.all(
      Array.from({ length: N }, () =>
        agent.post("/transactions").send({
          type: "expense",
          account_id: accountId,
          category_id: categoryId,
          amount: "1.00",
          occurred_at: "2026-08-04T09:41:00.000Z",
        })
      )
    );

    const accountRes = await agent.get("/accounts");
    const account = accountRes.body.accounts.find((a: { id: string }) => a.id === accountId);
    expect(BigInt(account.cached_balance)).toBe(100000n - BigInt(N) * amountMinor); // opening_balance 1000.00 minus N * 1.00

    const txCount = await pool.query("SELECT count(*) FROM transactions WHERE account_id = $1 AND deleted_at IS NULL", [accountId]);
    expect(Number(txCount.rows[0].count)).toBe(N);
  });

  it("rejects a cross-currency transfer with a non-positive to_amount", async () => {
    const { agent, accountId } = await setUp();
    const eurAccountRes = await agent.post("/accounts").send({ name: "EUR Savings", type: "bank", currency_code: "EUR", opening_balance: "0.00" });
    const toAccountId = eurAccountRes.body.account.id;

    const res = await agent.post("/transactions").send({
      type: "transfer",
      account_id: accountId,
      to_account_id: toAccountId,
      amount: "100.00",
      to_amount: "0.00",
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

  it("returns 400 (not 500) for a malformed from date", async () => {
    const { agent } = await setUp();
    const res = await agent.get("/transactions").query({ from: "not-a-date" });
    expect(res.status).toBe(400);
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

  it("returns 400 (not 500) when no exchange rate is available for the requested date range", async () => {
    // The exchange_rates seed only has rows for the single date migrations ran, so a
    // summary request for a currency-converted range before that date has no rate at
    // all (not even a prior one) and getRateToUSD/convert throw. That must surface as a
    // clean 400, not an unhandled 500.
    const { agent, categoryId } = await setUp(); // main currency USD
    const jpyAccountRes = await agent.post("/accounts").send({ name: "Japan Cash", type: "cash", currency_code: "JPY", opening_balance: "0" });
    await agent.post("/transactions").send({
      type: "expense",
      account_id: jpyAccountRes.body.account.id,
      category_id: categoryId,
      amount: "1000",
      occurred_at: "2020-01-15T00:00:00.000Z",
    });

    const res = await agent.get("/transactions/summary").query({ from: "2020-01-01", to: "2020-01-31" });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /transactions/:id", () => {
  it("edits amount and recomputes the account balance", async () => {
    const { agent, accountId, categoryId } = await setUp();
    const created = await agent.post("/transactions").send({
      type: "expense", account_id: accountId, category_id: categoryId, amount: "68.00", occurred_at: "2026-08-04T09:41:00.000Z",
    });

    const res = await agent.patch(`/transactions/${created.body.transaction.id}`).send({ amount: "50.00" });
    expect(res.status).toBe(200);
    expect(res.body.transaction.amount).toBe("5000");

    const accountRes = await agent.get("/accounts");
    expect(accountRes.body.accounts[0].cached_balance).toBe("95000"); // 1000.00 - 50.00
  });

  it("re-checks category kind on edit", async () => {
    const { agent, accountId, categoryId } = await setUp();
    const created = await agent.post("/transactions").send({
      type: "expense", account_id: accountId, category_id: categoryId, amount: "20.00", occurred_at: "2026-08-04T09:41:00.000Z",
    });
    const incomeCat = await pool.query("SELECT id FROM categories WHERE kind = 'income' LIMIT 1");

    const res = await agent.patch(`/transactions/${created.body.transaction.id}`).send({ category_id: incomeCat.rows[0].id });
    expect(res.status).toBe(400);
  });

  it("round-trips member and tags on edit", async () => {
    const { agent, accountId, categoryId } = await setUp();
    const created = await agent.post("/transactions").send({
      type: "expense", account_id: accountId, category_id: categoryId, amount: "20.00", occurred_at: "2026-08-04T09:41:00.000Z",
    });
    const memberRes = await agent.post("/members").send({ name: "Alex", initials: "AX" });
    const tagRes = await agent.post("/tags").send({ name: "Cars" });

    const res = await agent.patch(`/transactions/${created.body.transaction.id}`).send({
      member_id: memberRes.body.member.id,
      tag_ids: [tagRes.body.tag.id],
    });
    expect(res.status).toBe(200);

    const list = await agent.get("/transactions");
    expect(list.body.items[0].member_name).toBe("Alex");
    expect(list.body.items[0].tags).toHaveLength(1);
  });

  it("rejects editing a transfer's amount or category_id", async () => {
    const { agent, accountId } = await setUp();
    const secondAccountRes = await agent.post("/accounts").send({ name: "Savings", type: "bank", currency_code: "USD", opening_balance: "0.00" });
    const created = await agent.post("/transactions").send({
      type: "transfer", account_id: accountId, to_account_id: secondAccountRes.body.account.id, amount: "100.00", occurred_at: "2026-08-04T09:41:00.000Z",
    });

    const res = await agent.patch(`/transactions/${created.body.transaction.id}`).send({ amount: "50.00" });
    expect(res.status).toBe(400);
  });

  it("404s on another user's transaction", async () => {
    const { agent, accountId, categoryId } = await setUp();
    const created = await agent.post("/transactions").send({
      type: "expense", account_id: accountId, category_id: categoryId, amount: "20.00", occurred_at: "2026-08-04T09:41:00.000Z",
    });
    const otherAgent = request.agent(app);
    await otherAgent.post("/auth/register").send({ email: "other-patch@example.com", password: "password12345", display_name: "Other" });

    const res = await otherAgent.patch(`/transactions/${created.body.transaction.id}`).send({ amount: "50.00" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /transactions/:id", () => {
  it("soft-deletes an expense and restores the account balance", async () => {
    const { agent, accountId, categoryId } = await setUp();
    const created = await agent.post("/transactions").send({
      type: "expense", account_id: accountId, category_id: categoryId, amount: "68.00", occurred_at: "2026-08-04T09:41:00.000Z",
    });

    const res = await agent.delete(`/transactions/${created.body.transaction.id}`);
    expect(res.status).toBe(204);

    const accountRes = await agent.get("/accounts");
    expect(accountRes.body.accounts[0].cached_balance).toBe("100000"); // back to opening balance

    const list = await agent.get("/transactions");
    expect(list.body.items).toHaveLength(0);
  });

  it("soft-deletes a transfer and restores both accounts", async () => {
    const { agent, accountId } = await setUp();
    const secondAccountRes = await agent.post("/accounts").send({ name: "Savings", type: "bank", currency_code: "USD", opening_balance: "0.00" });
    const toAccountId = secondAccountRes.body.account.id;
    const created = await agent.post("/transactions").send({
      type: "transfer", account_id: accountId, to_account_id: toAccountId, amount: "100.00", occurred_at: "2026-08-04T09:41:00.000Z",
    });

    const res = await agent.delete(`/transactions/${created.body.transaction.id}`);
    expect(res.status).toBe(204);

    const accountsRes = await agent.get("/accounts");
    const byName: Record<string, string> = {};
    for (const a of accountsRes.body.accounts) byName[a.name] = a.cached_balance;
    expect(byName["Checking"]).toBe("100000");
    expect(byName["Savings"]).toBe("0");
  });

  it("404s on another user's transaction or a double-delete", async () => {
    const { agent, accountId, categoryId } = await setUp();
    const created = await agent.post("/transactions").send({
      type: "expense", account_id: accountId, category_id: categoryId, amount: "20.00", occurred_at: "2026-08-04T09:41:00.000Z",
    });
    const otherAgent = request.agent(app);
    await otherAgent.post("/auth/register").send({ email: "other-delete@example.com", password: "password12345", display_name: "Other" });

    const otherRes = await otherAgent.delete(`/transactions/${created.body.transaction.id}`);
    expect(otherRes.status).toBe(404);

    const firstDelete = await agent.delete(`/transactions/${created.body.transaction.id}`);
    expect(firstDelete.status).toBe(204);
    const secondDelete = await agent.delete(`/transactions/${created.body.transaction.id}`);
    expect(secondDelete.status).toBe(404);
  });
});

describe("member + tags on transactions", () => {
  it("attaches a member and tags on create, and round-trips them on list", async () => {
    const { agent, accountId, categoryId } = await setUp();
    const memberRes = await agent.post("/members").send({ name: "Alex", initials: "AX" });
    const tag1 = await agent.post("/tags").send({ name: "Cars" });
    const tag2 = await agent.post("/tags").send({ name: "Fun" });

    const created = await agent.post("/transactions").send({
      type: "expense",
      account_id: accountId,
      category_id: categoryId,
      amount: "20.00",
      occurred_at: "2026-08-04T09:41:00.000Z",
      member_id: memberRes.body.member.id,
      tag_ids: [tag1.body.tag.id, tag2.body.tag.id],
    });
    expect(created.status).toBe(201);

    const list = await agent.get("/transactions");
    expect(list.body.items[0].member_name).toBe("Alex");
    expect(list.body.items[0].tags).toHaveLength(2);
  });

  it("rejects a member or tag that belongs to another user", async () => {
    const { agent, accountId, categoryId } = await setUp();
    const otherAgent = request.agent(app);
    await otherAgent.post("/auth/register").send({ email: "other-txn@example.com", password: "password12345", display_name: "Other" });
    const otherMember = await otherAgent.post("/members").send({ name: "Ghost", initials: "GH" });

    const res = await agent.post("/transactions").send({
      type: "expense",
      account_id: accountId,
      category_id: categoryId,
      amount: "20.00",
      occurred_at: "2026-08-04T09:41:00.000Z",
      member_id: otherMember.body.member.id,
    });
    expect(res.status).toBe(400);
  });

  it("filters the list by member_id, tag_id, and category_id", async () => {
    const { agent, accountId, categoryId } = await setUp();
    const memberRes = await agent.post("/members").send({ name: "Alex", initials: "AX" });
    const tagRes = await agent.post("/tags").send({ name: "Cars" });
    const otherCat = await pool.query("SELECT id FROM categories WHERE kind = 'expense' AND name != 'Delivery' LIMIT 1");

    await agent.post("/transactions").send({
      type: "expense", account_id: accountId, category_id: categoryId, amount: "20.00",
      occurred_at: "2026-08-04T09:41:00.000Z", member_id: memberRes.body.member.id, tag_ids: [tagRes.body.tag.id],
    });
    await agent.post("/transactions").send({
      type: "expense", account_id: accountId, category_id: otherCat.rows[0].id, amount: "30.00",
      occurred_at: "2026-08-04T09:41:00.000Z",
    });

    const byMember = await agent.get("/transactions").query({ member_id: memberRes.body.member.id });
    expect(byMember.body.items).toHaveLength(1);

    const byTag = await agent.get("/transactions").query({ tag_id: tagRes.body.tag.id });
    expect(byTag.body.items).toHaveLength(1);

    const byCategory = await agent.get("/transactions").query({ category_id: categoryId });
    expect(byCategory.body.items).toHaveLength(1);
  });
});
