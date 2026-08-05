import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../app.js";
import { pool } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";

beforeAll(async () => {
  await runMigrations();
});

beforeEach(async () => {
  await pool.query("DELETE FROM sessions");
  await pool.query("DELETE FROM members");
  await pool.query("DELETE FROM categories");
  await pool.query("DELETE FROM users");
});

afterAll(async () => {
  await pool.end();
});

describe("POST /auth/register", () => {
  it("creates a user, seeds defaults, and sets auth cookies", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ email: "test@example.com", password: "correct horse battery staple", display_name: "Test User" });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe("test@example.com");
    expect(res.body.user.password_hash).toBeUndefined();
    expect(res.headers["set-cookie"].some((c: string) => c.startsWith("access_token="))).toBe(true);
    expect(res.headers["set-cookie"].some((c: string) => c.startsWith("refresh_token="))).toBe(true);

    const categories = await pool.query("SELECT kind, count(*) FROM categories GROUP BY kind ORDER BY kind");
    expect(categories.rows).toEqual([
      { kind: "expense", count: "6" },
      { kind: "income", count: "3" },
    ]);

    const members = await pool.query("SELECT name, is_default FROM members");
    expect(members.rows).toEqual([{ name: "Test User", is_default: true }]);
  });

  it("rejects a duplicate email", async () => {
    await request(app).post("/auth/register").send({ email: "dup@example.com", password: "password12345", display_name: "A" });
    const res = await request(app).post("/auth/register").send({ email: "dup@example.com", password: "password12345", display_name: "B" });
    expect(res.status).toBe(409);
  });
});

describe("POST /auth/login and GET /auth/me", () => {
  it("logs in with correct credentials and /me reflects the session", async () => {
    await request(app).post("/auth/register").send({ email: "login@example.com", password: "password12345", display_name: "Login User" });

    const agent = request.agent(app);
    const loginRes = await agent.post("/auth/login").send({ email: "login@example.com", password: "password12345" });
    expect(loginRes.status).toBe(200);

    const meRes = await agent.get("/auth/me");
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe("login@example.com");
  });

  it("returns a generic error for wrong password", async () => {
    await request(app).post("/auth/register").send({ email: "wrongpw@example.com", password: "password12345", display_name: "U" });
    const res = await request(app).post("/auth/login").send({ email: "wrongpw@example.com", password: "nope-nope-nope" });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("Email or password is incorrect.");
  });

  it("returns the same generic error for a nonexistent email", async () => {
    const res = await request(app).post("/auth/login").send({ email: "nobody@example.com", password: "password12345" });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("Email or password is incorrect.");
  });
});

describe("POST /auth/refresh", () => {
  it("rotates the refresh token and revokes the old session", async () => {
    const agent = request.agent(app);
    await agent.post("/auth/register").send({ email: "refresh@example.com", password: "password12345", display_name: "R" });

    const sessionsBefore = await pool.query("SELECT id, revoked_at FROM sessions");
    expect(sessionsBefore.rows).toHaveLength(1);

    const refreshRes = await agent.post("/auth/refresh");
    expect(refreshRes.status).toBe(200);

    const sessionsAfter = await pool.query("SELECT id, revoked_at FROM sessions ORDER BY created_at");
    expect(sessionsAfter.rows).toHaveLength(2);
    expect(sessionsAfter.rows[0].revoked_at).not.toBeNull();
    expect(sessionsAfter.rows[1].revoked_at).toBeNull();
  });
});

describe("POST /auth/logout", () => {
  it("revokes the session so /me subsequently requires re-login", async () => {
    const agent = request.agent(app);
    await agent.post("/auth/register").send({ email: "logout@example.com", password: "password12345", display_name: "L" });
    const logoutRes = await agent.post("/auth/logout");
    expect(logoutRes.status).toBe(204);

    const session = await pool.query("SELECT revoked_at FROM sessions");
    expect(session.rows[0].revoked_at).not.toBeNull();
  });
});
