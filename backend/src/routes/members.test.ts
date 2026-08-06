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

async function registerAndLogin(email = "member@example.com") {
  const agent = request.agent(app);
  await agent.post("/auth/register").send({ email, password: "password12345", display_name: "Member User" });
  return agent;
}

describe("GET/POST /members", () => {
  it("returns the seeded default member, then a created member", async () => {
    const agent = await registerAndLogin();

    const listBefore = await agent.get("/members");
    expect(listBefore.status).toBe(200);
    expect(listBefore.body.members).toHaveLength(1);
    expect(listBefore.body.members[0].is_default).toBe(true);

    const created = await agent.post("/members").send({ name: "Alex", initials: "AX", color: "#ff0000" });
    expect(created.status).toBe(201);
    expect(created.body.member.name).toBe("Alex");

    const listAfter = await agent.get("/members");
    expect(listAfter.body.members).toHaveLength(2);
  });

  it("does not return another user's members", async () => {
    const agentA = await registerAndLogin("a-members@example.com");
    const agentB = await registerAndLogin("b-members@example.com");
    await agentA.post("/members").send({ name: "Alex", initials: "AX" });

    const res = await agentB.get("/members");
    expect(res.body.members).toHaveLength(1); // only B's own default member
  });

  it("returns 400 (not 500) when name is missing", async () => {
    const agent = await registerAndLogin("badmember@example.com");
    const res = await agent.post("/members").send({ initials: "AX" });
    expect(res.status).toBe(400);
  });
});
