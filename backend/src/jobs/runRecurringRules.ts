import { pool, withTransaction } from "../db/pool.js";
import { newId } from "../lib/ids.js";
import { recomputeAccountBalance } from "../lib/balances.js";
import { advanceNextRun, isPastEnd } from "../lib/recurring.js";

/**
 * Processes every active recurring rule whose next_run_at is due, per data model §9:
 * auto_post rules insert a cleared transaction immediately; non-auto_post rules insert a
 * pending one for the user to confirm/dismiss via POST /recurring-rules/:id/confirm|dismiss.
 * Each rule is its own DB transaction so one bad rule can't block the rest of the tick.
 */
export async function runRecurringRulesTick(now: Date = new Date()): Promise<number> {
  const due = await pool.query("SELECT * FROM recurring_rules WHERE is_active = true AND next_run_at <= $1", [now.toISOString()]);

  let processed = 0;
  for (const rule of due.rows) {
    await withTransaction(async (client) => {
      const id = newId();
      const status = rule.auto_post ? "cleared" : "pending";

      if (rule.txn_type === "transfer") {
        await client.query(
          `INSERT INTO transactions (id, user_id, type, account_id, to_account_id, amount, currency_code, to_amount, occurred_at, status, recurring_rule_id)
           VALUES ($1, $2, 'transfer', $3, $4, $5, $6, $5, $7, $8, $9)`,
          [id, rule.user_id, rule.account_id, rule.to_account_id, rule.amount, rule.currency_code, rule.next_run_at, status, rule.id]
        );
      } else {
        await client.query(
          `INSERT INTO transactions (id, user_id, type, account_id, category_id, amount, currency_code, occurred_at, status, recurring_rule_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [id, rule.user_id, rule.txn_type, rule.account_id, rule.category_id, rule.amount, rule.currency_code, rule.next_run_at, status, rule.id]
        );
      }

      if (rule.auto_post) {
        for (const accountId of [rule.account_id, rule.to_account_id].filter(Boolean).sort()) {
          await recomputeAccountBalance(client, accountId);
        }
      }

      const next = advanceNextRun(new Date(rule.next_run_at), {
        frequency: rule.frequency,
        intervalCount: rule.interval_count,
        dayOfMonth: rule.day_of_month,
      });
      const pastEnd = isPastEnd(next, rule.ends_on);

      await client.query("UPDATE recurring_rules SET next_run_at = $1, last_run_at = now(), is_active = $2 WHERE id = $3", [
        next.toISOString(),
        !pastEnd,
        rule.id,
      ]);
    });
    processed++;
  }

  return processed;
}
