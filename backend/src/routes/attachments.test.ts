import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../app.js";
import { pool } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";

beforeAll(async () => {
  await runMigrations();
});

beforeEach(async () => {
  await pool.query("DELETE FROM attachments");
  await pool.query("DELETE FROM transaction_tags");
  await pool.query("UPDATE transactions SET installment_plan_id = NULL WHERE installment_plan_id IS NOT NULL");
  await pool.query("DELETE FROM installment_plans");
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

async function setUp(email = "attach@example.com") {
  const agent = request.agent(app);
  const registerRes = await agent.post("/auth/register").send({ email, password: "password12345", display_name: "Attach User" });
  await agent.patch("/users/me").send({ main_currency_code: "USD" });
  const accountRes = await agent.post("/accounts").send({ name: "Checking", type: "bank", currency_code: "USD", opening_balance: "1000.00" });
  const catRow = await pool.query("SELECT id FROM categories WHERE kind = 'expense' AND name = 'Delivery' AND user_id = $1 LIMIT 1", [registerRes.body.user.id]);
  const txnRes = await agent.post("/transactions").send({
    type: "expense",
    account_id: accountRes.body.account.id,
    category_id: catRow.rows[0].id,
    amount: "10.00",
    occurred_at: "2026-08-04T09:41:00.000Z",
  });
  return { agent, transactionId: txnRes.body.transaction.id };
}

describe("POST /transactions/:id/attachments", () => {
  it("uploads a receipt and links it to the transaction", async () => {
    const { agent, transactionId } = await setUp();

    const res = await agent
      .post(`/transactions/${transactionId}/attachments`)
      .attach("file", Buffer.from("fake-image-bytes"), { filename: "receipt.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    expect(res.body.attachment.transaction_id).toBe(transactionId);
    expect(res.body.attachment.mime_type).toBe("image/png");
  });

  it("rejects disallowed mime types", async () => {
    const { agent, transactionId } = await setUp();

    const res = await agent
      .post(`/transactions/${transactionId}/attachments`)
      .attach("file", Buffer.from("not-an-image"), { filename: "malware.exe", contentType: "application/x-msdownload" });

    expect(res.status).toBe(400);
  });

  it("404s for a transaction owned by another user", async () => {
    const { transactionId } = await setUp("owner@example.com");
    const { agent: otherAgent } = await setUp("other@example.com");

    const res = await otherAgent
      .post(`/transactions/${transactionId}/attachments`)
      .attach("file", Buffer.from("fake-image-bytes"), { filename: "receipt.png", contentType: "image/png" });

    expect(res.status).toBe(404);
  });
});

describe("GET /attachments/:id and DELETE /attachments/:id", () => {
  it("downloads then deletes an owned attachment, and blocks other users", async () => {
    const { agent, transactionId } = await setUp("owner2@example.com");
    const { agent: otherAgent } = await setUp("other2@example.com");

    const uploadRes = await agent
      .post(`/transactions/${transactionId}/attachments`)
      .attach("file", Buffer.from("fake-image-bytes"), { filename: "receipt.png", contentType: "image/png" });
    const attachmentId = uploadRes.body.attachment.id;

    const getOther = await otherAgent.get(`/attachments/${attachmentId}`);
    expect(getOther.status).toBe(404);

    const getOwn = await agent.get(`/attachments/${attachmentId}`);
    expect(getOwn.status).toBe(200);
    expect(getOwn.headers["content-type"]).toBe("image/png");

    const deleteOther = await otherAgent.delete(`/attachments/${attachmentId}`);
    expect(deleteOther.status).toBe(404);

    const deleteOwn = await agent.delete(`/attachments/${attachmentId}`);
    expect(deleteOwn.status).toBe(204);

    const getAfterDelete = await agent.get(`/attachments/${attachmentId}`);
    expect(getAfterDelete.status).toBe(404);
  });
});
