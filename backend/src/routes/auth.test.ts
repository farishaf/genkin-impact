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

  it("returns 409 (not a raw 500) when two registrations for the same email race past the pre-check", async () => {
    // The duplicate-email pre-check (SELECT before the transaction) is a
    // fast-path only; it can't fully prevent two concurrent registrations for
    // the same email both passing it and racing to INSERT. Firing both
    // requests together exercises that race directly: each pre-check SELECT
    // resolves (finding no row) well before either request's slower
    // hashPassword + INSERT sequence completes, so both proceed to INSERT and
    // the second hits the users.email UNIQUE constraint. The fix must
    // translate that into a 409, not let it fall through as an unhandled 500.
    const payload = { email: "race@example.com", password: "password12345", display_name: "Racer" };
    const [resA, resB] = await Promise.all([
      request(app).post("/auth/register").send(payload),
      request(app).post("/auth/register").send(payload),
    ]);

    const statuses = [resA.status, resB.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);

    const users = await pool.query("SELECT id FROM users WHERE email = $1", ["race@example.com"]);
    expect(users.rows).toHaveLength(1);
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

  it("still performs a real Argon2id verify for a nonexistent email (closes the timing side-channel)", async () => {
    // Regression test for a user-enumeration timing side-channel: a
    // nonexistent-email login used to fail fast right after the SELECT,
    // while a wrong-password login additionally paid for a real Argon2id
    // verify (tens of ms). An attacker measuring response latency could tell
    // the two cases apart even though the status/message were identical.
    // The fix always runs one real verifyPassword call (against a cached
    // dummy hash when there's no user row) before responding. We can't assert
    // on an exact duration without risking flakiness, but a bare "no such
    // row" DB round trip resolves in a few ms, whereas a real Argon2id verify
    // takes tens of ms on this machine (~35ms measured directly against this
    // repo's argon2 config) — so a floor well below that, comfortably above
    // a trivial DB round trip, confirms the verify path is actually being
    // exercised rather than short-circuited.
    const start = Date.now();
    const res = await request(app).post("/auth/login").send({ email: "nobody-timing@example.com", password: "password12345" });
    const elapsedMs = Date.now() - start;

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("Email or password is incorrect.");
    expect(elapsedMs).toBeGreaterThanOrEqual(10);
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
