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
 */
export async function recomputeAccountBalance(client: pg.PoolClient, accountId: string): Promise<bigint> {
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
