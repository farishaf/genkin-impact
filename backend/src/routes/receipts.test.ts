import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../app.js";
import { pool } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";
import { env } from "../env.js";

// A 1×1 PNG: the model is stubbed, so the bytes only need to pass the upload filter.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

async function login(email: string) {
  const agent = request.agent(app);
  await agent.post("/auth/register").send({ email, password: "password12345", display_name: "Receipt User" });
  return agent;
}

/** Stub only the model call; supertest talks to the app over node:http, not fetch. */
function stubModel(reply: unknown, status = 200) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: typeof reply === "string" ? reply : JSON.stringify(reply) } }] }), { status })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const savedKey = env.DEEPSEEK_API_KEY;
beforeAll(async () => {
  await runMigrations();
});
beforeEach(async () => {
  // Same wipe as the other route suites: the test DB (<db>_test) is shared and FK-ordered.
  for (const q of [
    "DELETE FROM planner_events", "DELETE FROM planner_routines", "DELETE FROM planner_days", "DELETE FROM planner_pages",
    "DELETE FROM transaction_tags", "UPDATE transactions SET installment_plan_id = NULL WHERE installment_plan_id IS NOT NULL",
    "DELETE FROM installment_plans", "DELETE FROM transactions", "DELETE FROM budgets", "DELETE FROM savings_goals",
    "DELETE FROM recurring_rules", "DELETE FROM accounts", "DELETE FROM sessions", "DELETE FROM members",
    "DELETE FROM categories", "DELETE FROM tags", "DELETE FROM saved_filters", "DELETE FROM users",
  ]) await pool.query(q);
  env.DEEPSEEK_API_KEY = "test-key";
});
afterEach(() => {
  vi.unstubAllGlobals();
  env.DEEPSEEK_API_KEY = savedKey;
});
afterAll(async () => {
  await pool.end();
});

describe("POST /receipts/scan", () => {
  it("is off without an API key", async () => {
    env.DEEPSEEK_API_KEY = undefined;
    const agent = await login("scan-off@example.com");
    const res = await agent.post("/receipts/scan").attach("file", PNG, { filename: "r.png", contentType: "image/png" });
    expect(res.status).toBe(503);
  });

  it("returns the read receipt, keeping only the user's own category ids", async () => {
    const agent = await login("scan-ok@example.com");
    const cats = await agent.get("/categories?kind=expense");
    const groceries = cats.body.categories[0].id;
    const fetchMock = stubModel({
      store: "Superindo",
      date: "2026-11-08",
      currency: "IDR",
      total: 37500,
      items: [
        { name: "Milk", qty: 2, unit_price: 12500, category_id: groceries },
        { name: "Bread", qty: 1, unit_price: 12500, category_id: "not-a-real-category" },
      ],
    });

    const res = await agent.post("/receipts/scan").attach("file", PNG, { filename: "r.png", contentType: "image/png" });
    expect(res.status).toBe(200);
    expect(res.body.scan).toMatchObject({ store: "Superindo", date: "2026-11-08", total: 37500 });
    expect(res.body.scan.items[0]).toMatchObject({ name: "Milk", qty: 2, unit_price: 12500, category_id: groceries });
    expect(res.body.scan.items[1].category_id).toBeUndefined();

    // The key travels in a header, never in the URL.
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain("test-key");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
  });

  it("turns an unreadable model reply into a 502, not a crash", async () => {
    const agent = await login("scan-bad@example.com");
    stubModel("sorry, I can't read this");
    const res = await agent.post("/receipts/scan").attach("file", PNG, { filename: "r.png", contentType: "image/png" });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("scan_failed");
  });

  it("rejects a non-image upload", async () => {
    const agent = await login("scan-pdf@example.com");
    const res = await agent.post("/receipts/scan").attach("file", Buffer.from("%PDF-1.4"), { filename: "r.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(400);
  });
});
