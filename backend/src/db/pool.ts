import pg from "pg";
import { env } from "../env.js";

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

const RETRYABLE_PG_ERROR_CODES = new Set([
  "40001", // serialization_failure
  "40P01", // deadlock_detected
]);

/**
 * Runs `fn` inside a BEGIN/COMMIT transaction on a dedicated client, retrying the whole
 * transaction (bounded) if Postgres reports a deadlock or serialization failure.
 *
 * Even when the application only ever takes a single row-level lock per statement (e.g.
 * `SELECT ... FOR UPDATE` against one account row), many concurrent transactions locking
 * that same row and then updating it can still transiently deadlock — Postgres has to
 * hand the wait queue off to the new tuple version on each UPDATE, and under enough
 * simultaneous lockers that handoff can produce a genuine wait-for cycle (verified live:
 * 15 concurrent expense-creation requests against one account reliably produced a real
 * `40P01 deadlock detected`). Postgres's own guidance for both 40001 and 40P01 is that
 * they're expected, transient conditions the application should catch and retry from the
 * top of the transaction — not evidence of a logic bug.
 */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>, retries = 5): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      const code = (err as { code?: string }).code;
      if (!code || !RETRYABLE_PG_ERROR_CODES.has(code) || attempt === retries) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 20));
    } finally {
      client.release();
    }
  }
  // Unreachable: the loop above always either returns or throws.
  throw new Error("withTransaction: exhausted retries without returning or throwing");
}
