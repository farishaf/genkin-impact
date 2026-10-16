import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { createHash } from "node:crypto";
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
  await pool.query("DELETE FROM password_reset_tokens");
  await pool.query("DELETE FROM members");
  await pool.query("DELETE FROM categories");
  await pool.query("DELETE FROM tags");
  await pool.query("DELETE FROM saved_filters");
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
    const setCookie = res.headers["set-cookie"];
    const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    expect(cookies.some((c: string) => c.startsWith("access_token="))).toBe(true);
    expect(cookies.some((c: string) => c.startsWith("refresh_token="))).toBe(true);

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

  it("rejects refresh for a soft-deleted user, even with a still-valid, unrevoked refresh token", async () => {
    // Regression test for I3: the refresh handler used to check only the sessions table
    // (revoked_at/expires_at), never joining users to check deleted_at. A soft-deleted
    // user could keep refreshing forever. The session lookup now joins users and
    // requires deleted_at IS NULL.
    const agent = request.agent(app);
    await agent.post("/auth/register").send({ email: "deleted-refresh@example.com", password: "password12345", display_name: "D" });

    const userRes = await pool.query("SELECT id FROM users WHERE email = $1", ["deleted-refresh@example.com"]);
    await pool.query("UPDATE users SET deleted_at = now() WHERE id = $1", [userRes.rows[0].id]);

    const refreshRes = await agent.post("/auth/refresh");
    expect(refreshRes.status).toBe(401);
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

// The raw reset token is only ever emailed, so tests plant a token whose raw value they know.
async function plantResetToken(email: string, raw: string, opts: { expiresInMs?: number; used?: boolean } = {}) {
  const user = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
  const hash = createHash("sha256").update(raw).digest("hex");
  await pool.query(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, used_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
    [user.rows[0].id, hash, new Date(Date.now() + (opts.expiresInMs ?? 60 * 60 * 1000)), opts.used ? new Date() : null]
  );
}

describe("POST /auth/forgot-password", () => {
  it("returns 200 for an unknown email without creating a token (no account enumeration)", async () => {
    const res = await request(app).post("/auth/forgot-password").send({ email: "nobody@example.com" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const tokens = await pool.query("SELECT id FROM password_reset_tokens");
    expect(tokens.rows).toHaveLength(0);
  });

  it("stores only a hashed, short-lived token for a known email", async () => {
    await request(app).post("/auth/register").send({ email: "forgot@example.com", password: "password12345", display_name: "F" });
    const res = await request(app).post("/auth/forgot-password").send({ email: "forgot@example.com" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const tokens = await pool.query("SELECT token_hash, expires_at, used_at FROM password_reset_tokens");
    expect(tokens.rows).toHaveLength(1);
    expect(tokens.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokens.rows[0].used_at).toBeNull();
    const ttlMs = new Date(tokens.rows[0].expires_at).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(55 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(60 * 60 * 1000);
  });

  it("does not issue a second token within the cooldown window", async () => {
    await request(app).post("/auth/register").send({ email: "spam@example.com", password: "password12345", display_name: "S" });
    await request(app).post("/auth/forgot-password").send({ email: "spam@example.com" });
    const again = await request(app).post("/auth/forgot-password").send({ email: "spam@example.com" });
    expect(again.status).toBe(200);
    const tokens = await pool.query("SELECT id FROM password_reset_tokens");
    expect(tokens.rows).toHaveLength(1);
  });

  it("rejects a malformed email", async () => {
    const res = await request(app).post("/auth/forgot-password").send({ email: "not-an-email" });
    expect(res.status).toBe(400);
  });
});

describe("POST /auth/reset-password", () => {
  const email = "reset@example.com";
  const oldPassword = "old-password-123";
  const newPassword = "brand-new-password-456";

  beforeEach(async () => {
    await request(app).post("/auth/register").send({ email, password: oldPassword, display_name: "R" });
  });

  it("sets the new password, burns the token, revokes old sessions and signs the user in", async () => {
    await plantResetToken(email, "valid-raw-token");
    const res = await request(app).post("/auth/reset-password").send({ token: "valid-raw-token", password: newPassword });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
    expect(res.body.user.password_hash).toBeUndefined();
    const setCookie = res.headers["set-cookie"];
    const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    expect(cookies.some((c: string) => c.startsWith("access_token="))).toBe(true);

    const used = await pool.query("SELECT used_at FROM password_reset_tokens");
    expect(used.rows[0].used_at).not.toBeNull();

    // the session created at registration is revoked; only the fresh one is live
    const live = await pool.query("SELECT id FROM sessions WHERE revoked_at IS NULL");
    expect(live.rows).toHaveLength(1);

    const oldLogin = await request(app).post("/auth/login").send({ email, password: oldPassword });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app).post("/auth/login").send({ email, password: newPassword });
    expect(newLogin.status).toBe(200);
  });

  it("rejects a token that was already used", async () => {
    await plantResetToken(email, "used-raw-token", { used: true });
    const res = await request(app).post("/auth/reset-password").send({ token: "used-raw-token", password: newPassword });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_token");
  });

  it("rejects an expired token", async () => {
    await plantResetToken(email, "expired-raw-token", { expiresInMs: -1000 });
    const res = await request(app).post("/auth/reset-password").send({ token: "expired-raw-token", password: newPassword });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown token", async () => {
    const res = await request(app).post("/auth/reset-password").send({ token: "never-issued", password: newPassword });
    expect(res.status).toBe(400);
  });

  it("rejects a password shorter than 10 characters without burning the token", async () => {
    await plantResetToken(email, "short-pw-token");
    const res = await request(app).post("/auth/reset-password").send({ token: "short-pw-token", password: "short" });
    expect(res.status).toBe(400);
    const used = await pool.query("SELECT used_at FROM password_reset_tokens");
    expect(used.rows[0].used_at).toBeNull();
  });

  it("only lets one of two concurrent requests use the same token", async () => {
    await plantResetToken(email, "race-raw-token");
    const [a, b] = await Promise.all([
      request(app).post("/auth/reset-password").send({ token: "race-raw-token", password: newPassword }),
      request(app).post("/auth/reset-password").send({ token: "race-raw-token", password: "another-password-789" }),
    ]);
    expect([a.status, b.status].sort((x, y) => x - y)).toEqual([200, 400]);
  });
});
