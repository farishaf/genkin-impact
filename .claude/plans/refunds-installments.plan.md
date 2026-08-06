# Plan: Refunds + Installments

**Source**: conversational (grounded in `genkin-impact-data-model.md` §6, §11 and `Genkin-Impact.dc.html`'s report action-grid: Edit / Refund / Pay by Installments)
**Selected scope**: `POST /transactions/:id/refund`, `POST /transactions/:id/installments` (+ new `installment_plans` table), wired into `TransactionsPage.tsx`
**Complexity**: Medium-large

## Context

Everything through the last commit (`8d2bb6e`) covers accounts, transactions CRUD, analytics, budgets, savings, recurring rules, members, tags. Three columns from the data model sit unused: `transactions.refund_of_id`, `installment_plan_id`, `installment_seq`. `balances.ts` already excludes installment-origin rows from balance sums (`installment_plan_id IS NULL OR installment_seq IS NOT NULL`), but nothing ever sets those columns, and no `installment_plans` table exists yet. This slice completes §6 of the transaction lifecycle: refund creates a real opposite-type transaction linked by `refund_of_id`; installments split an existing transaction into N dated child transactions and exclude the origin from money totals.

**Deferred to later slices** (do not build in this pass):
- Editing or canceling an installment plan once created.
- Refunding a refund (allowed by the schema, not specially handled — just another expense/income row).
- Any UI badge/detail view for an installment plan as a whole (children show individually in the list).

## Correctness catch (must fix, not optional)

`balances.ts`'s exclusion filter — `(installment_plan_id IS NULL OR installment_seq IS NOT NULL)` — only lives in `recomputeAccountBalance`. Three other money-aggregation queries sum `transactions.amount` directly and will double-count once an installment origin row exists (origin's full amount *and* every child's amount):
- `backend/src/routes/transactions.ts` `GET /summary` (line ~243, the `grouped` query)
- `backend/src/routes/analytics.ts` `GET /summary` (line 36-40, the `grouped` query)
- `backend/src/routes/budgets.ts` `sumExpensesInWindow` (line 42, `conditions` array)

Fix: export the fragment as a constant from `backend/src/lib/balances.ts` (`export const EXCLUDE_INSTALLMENT_ORIGIN_SQL = "(installment_plan_id IS NULL OR installment_seq IS NOT NULL)";`), use it in `recomputeAccountBalance`'s own query too (single source of truth), and splice it into the three `WHERE`/`conditions` blocks above via string interpolation (matches the existing `conditions.push(...)` array pattern already used in all three files).

## Patterns to Mirror

| Category | Source | Pattern |
|---|---|---|
| Sub-resource action route (`POST /:id/verb`) | `backend/src/routes/recurringRules.ts:195-222` (`/:id/confirm`, `/:id/dismiss`) | load-and-scope-by-user helper, `withTransaction`, recompute, 200/204 |
| Ownership-scoped transaction lookup | `backend/src/routes/transactions.ts` PATCH handler | `SELECT * FROM transactions WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`, 404 if missing |
| Generating N dated child rows from one origin | `backend/src/jobs/runRecurringRules.ts` + `backend/src/lib/recurring.ts` `advanceNextRun` | reuse `advanceNextRun({frequency: interval_unit==='month'?'monthly':'weekly', intervalCount:1}, date)` stepped in a loop, not reinvented date math |
| New table + migration | `backend/migrations/0004_budgets_savings_recurring.sql` | `CREATE TABLE`, indexes, no seed data needed |
| Inline expandable row-action mini-form | `frontend/src/components/RecurringTab.tsx` `RecurringRuleCard` (`plan-card__pending` block) | toggle a small inline form/buttons under a card row rather than a modal |

## Files to Change

| File | Action | Why |
|---|---|---|
| `backend/migrations/0005_installment_plans.sql` | CREATE | `installment_plans` table + FK from `transactions.installment_plan_id` |
| `backend/src/lib/balances.ts` | UPDATE | export `EXCLUDE_INSTALLMENT_ORIGIN_SQL`, use it internally |
| `backend/src/routes/transactions.ts` | UPDATE | `POST /:id/refund`, `POST /:id/installments`; apply exclusion fragment to `GET /summary` |
| `backend/src/routes/transactions.test.ts` | UPDATE | coverage for both new routes + summary exclusion |
| `backend/src/routes/analytics.ts` | UPDATE | apply exclusion fragment to the day-grouped query |
| `backend/src/routes/budgets.ts` | UPDATE | apply exclusion fragment to `sumExpensesInWindow` |
| `backend/src/routes/analytics.test.ts` / `budgets.test.ts` | UPDATE | one assertion each: installment origin excluded |
| `frontend/src/routes/TransactionsPage.tsx` | UPDATE | Refund + Installments row actions (expense/income only), inline mini-forms, badges for refund/installment rows |
| `frontend/src/styles/base.css` | UPDATE | additive: badge chip + inline-form row styles (reuse existing `.tag-chip`, `.field` patterns) |

## Tasks

### Task 1: Migration
- **Action**: `installment_plans (id, user_id, origin_transaction_id, total_amount, installment_count, interval_unit CHECK IN ('month','week'), fee_amount DEFAULT 0, first_due_date, status DEFAULT 'active' CHECK IN ('active','completed','canceled'), created_at)`. Add `ALTER TABLE transactions ADD CONSTRAINT transactions_installment_plan_id_fkey FOREIGN KEY (installment_plan_id) REFERENCES installment_plans(id)` (column already exists, unconstrained, from migration 0003). Index `(user_id)`.
- **Mirror**: `0004_budgets_savings_recurring.sql`
- **Validate**: `npm run build` (backend), migration runs clean via existing `runMigrations()` in test `beforeAll`

### Task 2: Shared exclusion fragment + apply to the three summing queries
- **Action**: In `balances.ts`, add `export const EXCLUDE_INSTALLMENT_ORIGIN_SQL = "(installment_plan_id IS NULL OR installment_seq IS NOT NULL)";`, replace the inline literal in `recomputeAccountBalance`'s query with it. Import and append to: `transactions.ts` `GET /summary`'s `conditions` array (it already builds `conditions.join(" AND ")`), `analytics.ts` `GET /summary`'s WHERE clause, `budgets.ts` `sumExpensesInWindow`'s `conditions` array.
- **Mirror**: existing `conditions.push(...)` pattern in all three files
- **Validate**: new tests (Task 5) proving an installment origin doesn't inflate summary/analytics/budget totals

### Task 3: `POST /transactions/:id/refund`
- **Action**: Load origin scoped to `user_id`, 404 if missing/deleted. Reject `type === 'transfer'` (400 `refund_not_supported`). Compute already-refunded total: `SELECT COALESCE(SUM(amount),0) FROM transactions WHERE refund_of_id = $1 AND deleted_at IS NULL`. `remaining = origin.amount - alreadyRefunded`. Body: `{ amount?: string, occurred_at?: string, note?: string }` — `amount` optional (default `remaining`), parse via `parseToMinor` against the origin account's `decimal_digits`; 400 if `<= 0` or `> remaining`. Inside `withTransaction`: insert a new transaction with `type` flipped (`expense`↔`income`), same `account_id`/`currency_code`/`member_id`, `category_id = NULL`, `occurred_at = body.occurred_at ?? now`, `note = body.note ?? null`, `refund_of_id = origin.id`; then `recomputeAccountBalance(client, origin.account_id)`. Return `201 { transaction }`.
- **Mirror**: `transactions.ts` PATCH handler's ownership-load pattern; `withTransaction` + single-account recompute from the POST `/` handler
- **Validate**: full refund restores balance to pre-purchase, partial refund leaves remainder, over-refund 400, transfer 400, 404 other user's txn

### Task 4: `POST /transactions/:id/installments`
- **Action**: Body: `{ installment_count: number (2-60), interval_unit: 'month'|'week', fee_amount?: string, first_due_date: YYYY-MM-DD }`. Load origin scoped to `user_id`, 404 if missing/deleted, reject `type === 'transfer'` and reject if `installment_plan_id` already set (400 `already_installment`). `feeMinor = parseToMinor(fee_amount ?? "0", decimals)`. `totalMinor = origin.amount + feeMinor`. Split: `base = totalMinor / BigInt(count)`, `remainder = totalMinor % BigInt(count)`; installments `1..count-1` get `base`, installment `count` gets `base + remainder` (keeps the sum exact). Dates: `date[0] = first_due_date`, `date[i] = advanceNextRun(date[i-1], {frequency: interval_unit==='month'?'monthly':'weekly', intervalCount:1})`. Inside `withTransaction`: insert `installment_plans` row; `UPDATE transactions SET installment_plan_id = $plan WHERE id = origin.id` (seq stays NULL — this is what excludes it from sums); insert N child transactions (`installment_plan_id`, `installment_seq = i+1`, same `account_id`/`type`/`category_id`/`member_id`/`currency_code`, `note` copied from origin, `status = 'cleared'`); `recomputeAccountBalance(client, origin.account_id)`. Return `201 { installment_plan, transactions }`.
- **Mirror**: `advanceNextRun` from `lib/recurring.ts` (date stepping, don't reimplement), `withTransaction` + recompute pattern
- **Validate**: creates plan + N children summing to total, origin excluded from balance but children included, remainder lands on last installment, rejects transfer / double-installment / 404 other user

### Task 5: Tests for the exclusion fix
- **Action**: One test each in `transactions.test.ts` (`GET /summary` unaffected by an installment origin), `analytics.test.ts` (day total unaffected), `budgets.test.ts` (spent-in-window unaffected) — create an expense, split into installments, assert the aggregate matches the children's sum, not origin+children.
- **Validate**: `npx vitest run`

### Task 6: Frontend — row actions
- **Action**: In `TransactionsPage.tsx`, extend `TxnItem` with `refund_of_id: string | null`, `installment_plan_id: string | null`, `installment_seq: number | null`. For expense/income rows (not transfers): add "Refund" icon button (reuse `.icon-btn`) that toggles a small inline form under the row (amount prefilled to full remaining — just use `t.amount` for simplicity since partial-refund tracking isn't surfaced in the list response this pass — optional note field, Confirm/Cancel) calling `POST /transactions/:id/refund`. Add "Installments" icon button (only when `installment_plan_id === null`) toggling a similar inline form (count, interval unit select, optional fee, first due date defaulting to today) calling `POST /transactions/:id/installments`. Both `onSuccess`: invalidate `["transactions"]` + `["accounts"]`, close the inline form. Add small static badges: `refund_of_id` → "Refund" chip; `installment_plan_id && installment_seq === null` → "Installment plan" chip; `installment_seq` set → "Installment #N" chip. Reuse `tag-chip--static` for all three.
- **Mirror**: `RecurringTab.tsx`'s `plan-card__pending` inline-toggle pattern; existing `AddTransactionForm`/row-action state shape from the edit/delete slice
- **Validate**: manual — refund an expense (full, then partial on another), confirm balance math; split an expense into 3 monthly installments, confirm origin excluded from balance/summary and 3 children appear dated a month apart

### Task 7: CSS
- **Action**: Additive only — inline-form-under-row container (reuse `.field`/`.txn-row` spacing tokens), no new colors/tokens.
- **Validate**: visual check in browser

### Task 8: Manual QA
- **Action**: Via chrome-devtools: create an expense, refund it fully (balance restores), create another, refund it partially (balance reflects remainder), create a third, split into 3 monthly installments (confirm summary/balance match children sum, not origin+children), check console for errors.
- **Validate**: no console errors, balances and summary correct

## Verification

```bash
cd backend && npm run typecheck && npx vitest run
cd frontend && npm run build
```
Plus the chrome-devtools manual QA in Task 8 (register a fresh QA user — `npx vitest run` wipes the shared dev DB per existing project memory).

## Acceptance
- [ ] All tasks complete
- [ ] Validation passes (`vitest run` backend, `npm run build` both)
- [ ] Exclusion fragment shared from one source (`balances.ts`), not copy-pasted four times
- [ ] Patterns mirrored (`recurringRules.ts` sub-resource routes, `advanceNextRun`, `RecurringTab.tsx` inline-toggle UI), not reinvented
- [ ] Manual QA: refund (full + partial) and installment split both round-trip through balance recompute correctly
