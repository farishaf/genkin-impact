import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../app.js";
import { pool } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";

beforeAll(async () => {
  await runMigrations();
});

beforeEach(async () => {
  await pool.query("DELETE FROM transactions");
  await pool.query("DELETE FROM accounts");
  await pool.query("DELETE FROM sessions");
  await pool.query("DELETE FROM members");
  await pool.query("DELETE FROM categories");
  await pool.query("DELETE FROM users");
});

afterAll(async () => {
  await pool.end();
});

describe("GET /categories", () => {
  it("returns the current user's seeded categories, optionally filtered by kind", async () => {
    const agent = request.agent(app);
    await agent.post("/auth/register").send({ email: "cats@example.com", password: "password12345", display_name: "Cats" });

    const all = await agent.get("/categories");
    expect(all.status).toBe(200);
    expect(all.body.categories).toHaveLength(9);

    const income = await agent.get("/categories").query({ kind: "income" });
    expect(income.body.categories).toHaveLength(3);
    expect(income.body.categories.every((c: { kind: string }) => c.kind === "income")).toBe(true);
  });

  it("does not return another user's categories", async () => {
    const agentA = request.agent(app);
    await agentA.post("/auth/register").send({ email: "a@example.com", password: "password12345", display_name: "A" });
    const agentB = request.agent(app);
    await agentB.post("/auth/register").send({ email: "b@example.com", password: "password12345", display_name: "B" });

    const res = await agentA.get("/categories");
    expect(res.body.categories).toHaveLength(9); // only their own 9, not 18
  });

  it("returns 400 (not 500) for an invalid kind value", async () => {
    const agent = request.agent(app);
    await agent.post("/auth/register").send({ email: "badkind@example.com", password: "password12345", display_name: "Bad Kind" });

    const res = await agent.get("/categories").query({ kind: "bogus" });
    expect(res.status).toBe(400);
  });
});
