import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../app.js";
import { pool } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";

beforeAll(async () => {
  await runMigrations();
});

beforeEach(async () => {
  await pool.query("DELETE FROM saved_filters");
  await pool.query("DELETE FROM transaction_tags");
  await pool.query("UPDATE transactions SET installment_plan_id = NULL WHERE installment_plan_id IS NOT NULL");
  await pool.query("DELETE FROM installment_plans");
  await pool.query("DELETE FROM transactions");
  await pool.query("DELETE FROM accounts");
  await pool.query("DELETE FROM sessions");
  await pool.query("DELETE FROM tags");
  await pool.query("DELETE FROM members");
  await pool.query("DELETE FROM categories");
  await pool.query("DELETE FROM users");
});

afterAll(async () => {
  await pool.end();
});

async function registerAndLogin(email = "savedfilter@example.com") {
  const agent = request.agent(app);
  await agent.post("/auth/register").send({ email, password: "password12345", display_name: "Filter User" });
  return agent;
}

describe("GET/POST/DELETE /saved-filters", () => {
  it("creates a saved filter and lists it back", async () => {
    const agent = await registerAndLogin();

    const listBefore = await agent.get("/saved-filters");
    expect(listBefore.status).toBe(200);
    expect(listBefore.body.saved_filters).toHaveLength(0);

    const created = await agent.post("/saved-filters").send({
      name: "This month's expenses",
      criteria: { type: "expense", from: "2026-08-01", to: "2026-08-31" },
    });
    expect(created.status).toBe(201);
    expect(created.body.saved_filter.name).toBe("This month's expenses");
    expect(created.body.saved_filter.criteria).toEqual({ type: "expense", from: "2026-08-01", to: "2026-08-31" });

    const listAfter = await agent.get("/saved-filters");
    expect(listAfter.body.saved_filters).toHaveLength(1);
  });

  it("assigns increasing sort_order per user", async () => {
    const agent = await registerAndLogin("order@example.com");
    const first = await agent.post("/saved-filters").send({ name: "First", criteria: {} });
    const second = await agent.post("/saved-filters").send({ name: "Second", criteria: {} });
    expect(first.body.saved_filter.sort_order).toBe(0);
    expect(second.body.saved_filter.sort_order).toBe(1);
  });

  it("does not return another user's saved filters", async () => {
    const agentA = await registerAndLogin("a-filters@example.com");
    const agentB = await registerAndLogin("b-filters@example.com");
    await agentA.post("/saved-filters").send({ name: "Mine", criteria: {} });

    const res = await agentB.get("/saved-filters");
    expect(res.body.saved_filters).toHaveLength(0);
  });

  it("returns 400 (not 500) when name is missing", async () => {
    const agent = await registerAndLogin("badfilter@example.com");
    const res = await agent.post("/saved-filters").send({ criteria: {} });
    expect(res.status).toBe(400);
  });

  it("deletes a saved filter, 404s for someone else's", async () => {
    const agentA = await registerAndLogin("del-a@example.com");
    const agentB = await registerAndLogin("del-b@example.com");
    const created = await agentA.post("/saved-filters").send({ name: "Temp", criteria: {} });

    const forbidden = await agentB.delete(`/saved-filters/${created.body.saved_filter.id}`);
    expect(forbidden.status).toBe(404);

    const ok = await agentA.delete(`/saved-filters/${created.body.saved_filter.id}`);
    expect(ok.status).toBe(204);

    const list = await agentA.get("/saved-filters");
    expect(list.body.saved_filters).toHaveLength(0);
  });
});
