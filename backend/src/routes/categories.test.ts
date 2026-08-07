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

describe("POST /categories", () => {
  it("creates a custom category owned by the user", async () => {
    const agent = request.agent(app);
    await agent.post("/auth/register").send({ email: "create@example.com", password: "password12345", display_name: "Create" });

    const res = await agent.post("/categories").send({ name: "Pet Supplies", emoji: "🐾", kind: "expense" });
    expect(res.status).toBe(201);
    expect(res.body.category.name).toBe("Pet Supplies");
    expect(res.body.category.is_system).toBe(false);

    const list = await agent.get("/categories");
    expect(list.body.categories).toHaveLength(10);
  });
});

describe("PATCH /categories/:id", () => {
  it("renames a category", async () => {
    const agent = request.agent(app);
    await agent.post("/auth/register").send({ email: "rename@example.com", password: "password12345", display_name: "Rename" });
    const created = await agent.post("/categories").send({ name: "Old Name", kind: "expense" });

    const res = await agent.patch(`/categories/${created.body.category.id}`).send({ name: "New Name" });
    expect(res.status).toBe(200);
    expect(res.body.category.name).toBe("New Name");
  });

  it("404s for another user's category", async () => {
    const agentA = request.agent(app);
    await agentA.post("/auth/register").send({ email: "owner@example.com", password: "password12345", display_name: "Owner" });
    const created = await agentA.post("/categories").send({ name: "Mine", kind: "expense" });

    const agentB = request.agent(app);
    await agentB.post("/auth/register").send({ email: "intruder@example.com", password: "password12345", display_name: "Intruder" });
    const res = await agentB.patch(`/categories/${created.body.category.id}`).send({ name: "Hijacked" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /categories/:id", () => {
  it("soft-deletes a custom category", async () => {
    const agent = request.agent(app);
    await agent.post("/auth/register").send({ email: "delete@example.com", password: "password12345", display_name: "Delete" });
    const created = await agent.post("/categories").send({ name: "Temp", kind: "expense" });

    const res = await agent.delete(`/categories/${created.body.category.id}`);
    expect(res.status).toBe(204);

    const list = await agent.get("/categories");
    expect(list.body.categories.find((c: { id: string }) => c.id === created.body.category.id)).toBeUndefined();
  });

  it("refuses to delete a built-in (is_system) category", async () => {
    const agent = request.agent(app);
    await agent.post("/auth/register").send({ email: "system@example.com", password: "password12345", display_name: "System" });
    const seeded = await agent.get("/categories");
    const systemCat = seeded.body.categories[0];

    const res = await agent.delete(`/categories/${systemCat.id}`);
    expect(res.status).toBe(400);
  });
});
