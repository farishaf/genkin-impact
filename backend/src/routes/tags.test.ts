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
  await pool.query("DELETE FROM accounts");
  await pool.query("DELETE FROM sessions");
  await pool.query("DELETE FROM tags");
  await pool.query("DELETE FROM members");
  await pool.query("DELETE FROM categories");
  await pool.query("DELETE FROM saved_filters");
  await pool.query("DELETE FROM users");
});

afterAll(async () => {
  await pool.end();
});

async function registerAndLogin(email = "tag@example.com") {
  const agent = request.agent(app);
  await agent.post("/auth/register").send({ email, password: "password12345", display_name: "Tag User" });
  return agent;
}

describe("GET/POST /tags", () => {
  it("creates a tag and lists it back, flat (no parent)", async () => {
    const agent = await registerAndLogin();

    const listBefore = await agent.get("/tags");
    expect(listBefore.status).toBe(200);
    expect(listBefore.body.tags).toHaveLength(0);

    const created = await agent.post("/tags").send({ name: "Cars", color: "#00ff00" });
    expect(created.status).toBe(201);
    expect(created.body.tag.name).toBe("Cars");
    expect(created.body.tag.parent_id).toBeNull();

    const listAfter = await agent.get("/tags");
    expect(listAfter.body.tags).toHaveLength(1);
  });

  it("does not return another user's tags", async () => {
    const agentA = await registerAndLogin("a-tags@example.com");
    const agentB = await registerAndLogin("b-tags@example.com");
    await agentA.post("/tags").send({ name: "Cars" });

    const res = await agentB.get("/tags");
    expect(res.body.tags).toHaveLength(0);
  });

  it("returns 400 (not 500) when name is missing", async () => {
    const agent = await registerAndLogin("badtag@example.com");
    const res = await agent.post("/tags").send({ color: "#fff" });
    expect(res.status).toBe(400);
  });
});
