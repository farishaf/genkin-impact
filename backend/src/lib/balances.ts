import type pg from "pg";

export interface BalanceInputs {
  openingBalance: bigint;
  incomeSum: bigint;
  expenseSum: bigint;
  transfersInSum: bigint;
  transfersOutSum: bigint;
}

export function computeBalance(inputs: BalanceInputs): bigint {
  return (
    inputs.openingBalance +
    inputs.incomeSum -
    inputs.expenseSum +
    inputs.transfersInSum -
    inputs.transfersOutSum
  );
}

/**
 * Recomputes and persists cached_balance for one account from its transaction history.
 * Must be called within the same DB transaction as the write that changed the account's ledger.
 *
 * Takes a transaction-scoped Postgres advisory lock keyed on the account id before reading
 * opening_balance, so concurrent writers against the same account serialize on this lock
 * instead of racing a read-sum-write cycle (which would otherwise let a slower transaction's
 * blind write silently clobber a faster one's correct result — a classic lost update).
 *
 * pg_advisory_xact_lock is used instead of `SELECT ... FOR UPDATE` because plain row-level
 * locking hit a real Postgres deadlock under load in testing: many concurrent transactions
 * doing SELECT ... FOR UPDATE followed by UPDATE on the very same single row can trigger a
 * genuine wait-for cycle (40P01) as Postgres hands the tuple-lock wait queue off to each new
 * row version — verified live with 15 concurrent expense-creation requests against one
 * account. An advisory lock is a simple, non-MVCC mutex keyed by an arbitrary bigint, so it
 * doesn't have that tuple-version-handoff failure mode. Like a row lock, it auto-releases at
 * COMMIT/ROLLBACK, so it's safe to just take-and-forget within the caller's transaction.
 *
 * Callers that recompute more than one account in the same transaction (e.g. a transfer)
 * must acquire these locks in a consistent order (e.g. sorted account id) across all call
 * sites to avoid deadlocking against an opposing transfer between the same two accounts.
 */
export async function recomputeAccountBalance(client: pg.PoolClient, accountId: string): Promise<bigint> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [accountId]);
  const accountRow = await client.query("SELECT opening_balance FROM accounts WHERE id = $1", [accountId]);
  if (accountRow.rows.length === 0) throw new Error(`account ${accountId} not found`);
  const openingBalance = BigInt(accountRow.rows[0].opening_balance);

  const sums = await client.query(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE type = 'income' AND account_id = $1), 0) AS income_sum,
       COALESCE(SUM(amount) FILTER (WHERE type = 'expense' AND account_id = $1), 0) AS expense_sum,
       COALESCE(SUM(to_amount) FILTER (WHERE type = 'transfer' AND to_account_id = $1), 0) AS transfers_in_sum,
       COALESCE(SUM(amount) FILTER (WHERE type = 'transfer' AND account_id = $1), 0) AS transfers_out_sum
     FROM transactions
     WHERE (account_id = $1 OR to_account_id = $1)
       AND deleted_at IS NULL
       AND status = 'cleared'
       AND (installment_plan_id IS NULL OR installment_seq IS NOT NULL)`,
    [accountId]
  );

  const row = sums.rows[0];
  const balance = computeBalance({
    openingBalance,
    incomeSum: BigInt(row.income_sum),
    expenseSum: BigInt(row.expense_sum),
    transfersInSum: BigInt(row.transfers_in_sum),
    transfersOutSum: BigInt(row.transfers_out_sum),
  });

  await client.query("UPDATE accounts SET cached_balance = $1 WHERE id = $2", [balance, accountId]);
  return balance;
}
