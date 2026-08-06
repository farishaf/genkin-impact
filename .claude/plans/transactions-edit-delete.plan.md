# Plan: Edit & delete transactions

**Source**: conversational (deferred item from `transactions-richness.plan.md`)
**Selected scope**: `PATCH /transactions/:id` (mutable fields only, no account/type/currency move), `DELETE /transactions/:id` (soft delete), wire both into `TransactionsPage.tsx`
**Complexity**: Medium

## Summary

`transactions.ts` only has `POST` (create) and `GET` (list/summary) — no way to fix a typo'd amount or remove a bad entry short of touching the DB directly. Schema already has `transactions.deleted_at` and `recomputeAccountBalance()` already ignores soft-deleted rows, so both operations reuse existing plumbing. Scope is deliberately narrow: **editing account, type, or to_account is out** — moving a transaction between accounts (possibly cross-currency) reopens the FX/locking complexity the original plan flagged as its own slice. This pass only lets you fix what doesn't touch which accounts are involved.

**Deferred to later slices** (do not build in this pass):
- Changing `account_id`/`to_account_id`/`type`/`currency_code` on an existing transaction.
- Editing `amount`/`to_amount` on a transfer (cross-currency two-account recompute, same locking complexity as create).
- Undo/restore of a deleted transaction (soft delete exists in the schema, but no restore endpoint).
- Bulk edit/delete.

## Patterns to Mirror

| Category | Source | Pattern |
|---|---|---|
| Soft delete | `backend/src/routes/savingsGoals.ts:181-192` | `UPDATE ... SET deleted_at = now() WHERE id = $1 AND user_id = $2 RETURNING id`, 404 if no row, `204` on success |
| Partial update | `backend/src/routes/savingsGoals.ts:113-140` | `validateBody` with all-optional fields, `COALESCE($n, col)` in the `UPDATE` |
| Soft-delete a transaction row (already used elsewhere) | `backend/src/routes/recurringRules.ts:217` | `UPDATE transactions SET deleted_at = now(), updated_at = now() WHERE id = $1` |
| Balance recompute after a ledger change | `backend/src/routes/transactions.ts:60-113`, `backend/src/lib/balances.ts` | call `recomputeAccountBalance(client, accountId)` inside `withTransaction`, sorted-id order when two accounts are touched |
| Ownership + ownership-scoped lookups for member/tags | `backend/src/routes/transactions.ts:62-76` (added this session) | re-use as-is for PATCH's `member_id`/`tag_ids` validation |
| Form reuse for create vs edit | none yet — first edit UI in this frontend | generalize `AddTransactionForm.tsx` to accept an optional `editing` transaction prop rather than forking a second component |

## Files to Change

| File | Action | Why |
|---|---|---|
| `backend/src/routes/transactions.ts` | UPDATE | add `PATCH /:id` and `DELETE /:id` |
| `backend/src/routes/transactions.test.ts` | UPDATE | coverage for both, plus balance-recompute assertions |
| `frontend/src/components/AddTransactionForm.tsx` | UPDATE | accept `editing?: TxnItem` + `onCancelEdit?`; PATCH instead of POST when editing; prefill fields |
| `frontend/src/routes/TransactionsPage.tsx` | UPDATE | per-row Edit/Delete buttons; Edit opens the form pre-filled; Delete confirms then calls DELETE |
| `frontend/src/styles/base.css` | UPDATE | row action buttons (icon-button style), additive only |

## Tasks

### Task 1: `PATCH /transactions/:id`
- **Action**: New schema `updateTransactionSchema` — all fields optional: `amount`, `category_id`, `member_id`, `tag_ids`, `note`, `occurred_at`. Load existing transaction scoped to `user_id`, 404 if missing or `deleted_at IS NOT NULL`. If `category_id` provided, re-run the existing kind-match check against the transaction's own `type` (transfers reject `category_id`/`amount` outright — 400 `not_editable_field`). If `amount` provided, re-parse via `parseToMinor` against the account's `decimal_digits` (look up via `account_id` on the existing row), reject transfers. If `member_id`/`tag_ids` provided, reuse the ownership-check blocks from `POST` verbatim. Inside `withTransaction`: `UPDATE transactions SET amount = COALESCE(...), category_id = COALESCE(...), member_id = ..., note = COALESCE(...), occurred_at = COALESCE(...), updated_at = now() WHERE id = $1`; if `tag_ids` provided, `DELETE FROM transaction_tags WHERE transaction_id = $1` then re-insert the new set (full replace, not diff — simplest correct approach for a handful of tags); if `amount` changed, call `recomputeAccountBalance(client, account_id)`.
- **Mirror**: `savingsGoals.ts:113-140` (COALESCE update shape), `transactions.ts:48-119` (validation + `withTransaction` + recompute)
- **Validate**: new tests — edit amount recomputes balance, edit category re-checks kind, edit member/tags round-trips, reject editing a transfer's amount/category, 404 on another user's transaction

### Task 2: `DELETE /transactions/:id`
- **Action**: `UPDATE transactions SET deleted_at = now(), updated_at = now() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING account_id, to_account_id, type`. 404 if no row. Inside `withTransaction`, after the delete, call `recomputeAccountBalance` for `account_id`, and for `to_account_id` too if `type = 'transfer'` (sorted-id order, same as the transfer-create path). `204` on success.
- **Mirror**: `savingsGoals.ts:181-192` (soft-delete + 404 + 204), `transactions.ts:89-91` (sorted-id double recompute)
- **Validate**: new tests — delete an expense restores the account balance to pre-transaction state; delete a transfer restores both accounts; deleted transaction no longer appears in `GET /transactions`; 404 on someone else's transaction or double-delete

### Task 3: `AddTransactionForm.tsx` — double as edit form
- **Action**: Add `editing?: TxnItem | null` and `onDone: () => void` props (rename `onCreated` → `onDone` or keep both, whichever is the smaller diff). When `editing` is set: prefill `type` (locked/disabled — not editable), `accountId` (locked), `categoryId`/`amount`/`note`/`memberId`/`tagIds`/`occurred_at` from the existing row; mutation calls `PATCH /transactions/:id` with only the editable fields instead of `POST`. Submit button label "Save changes" vs "Save transaction".
- **Mirror**: existing mutation/query-invalidation shape already in the file
- **Validate**: manual — edit a transaction's amount and a tag, confirm list + balance update

### Task 4: `TransactionsPage.tsx` — row actions
- **Action**: Add two small icon buttons per `.txn-row` (Edit, Delete). Edit sets `editingTxn` state and opens the form (reuse the existing `showForm` slot, passing `editing={editingTxn}`). Delete does `if (!confirm(...)) return;` then `DELETE /transactions/:id`, invalidate `["transactions"]` + `["accounts"]` on success.
- **Mirror**: existing `showForm` toggle + mutation/invalidate pattern already in the file
- **Validate**: manual — edit and delete from the list, confirm summary + balances update

### Task 5: CSS
- **Action**: Small icon-button style for the row actions, additive, reuse existing tokens (`--space-*`, `--radius-*`, `--color-*`).
- **Mirror**: existing `.btn-primary`/`.tag-chip` button patterns
- **Validate**: visual check in browser

### Task 6: Manual QA
- **Action**: Via chrome-devtools (or `run` skill): create a transaction, edit its amount + tags, confirm balance and list update; delete it, confirm balance reverts and it drops off the list. Repeat delete on a transfer, confirm both accounts recompute. Check console for errors.
- **Validate**: no console errors, balances correct after edit and delete

## Validation

```bash
cd backend && npm run typecheck && npx vitest run
cd frontend && npm run build
```

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Editing `amount` on a transaction that's part of an `installment_plan_id` or has a `refund_of_id` silently desyncs related rows | Low (those features aren't built yet — columns exist but nothing writes them) | out of scope; note in PR description if it comes up |
| Double-delete or delete-then-edit race | Low | `deleted_at IS NULL` guard on both endpoints' `WHERE`, 404 either way |
| `tag_ids: []` on PATCH is ambiguous ("don't touch tags" vs "clear all tags") — the original plan flagged this exact case as N/A pre-edit-endpoint | Now applies | treat `tag_ids` key present (even empty array) as "replace with this set"; key absent = leave tags untouched. Document in the zod schema comment. |

## Acceptance
- [ ] All tasks complete
- [ ] Validation passes (`vitest run` backend, `npm run build` both)
- [ ] Patterns mirrored (`savingsGoals.ts` PATCH/DELETE shape, `transactions.ts` recompute/`withTransaction`), not reinvented
- [ ] Manual QA: edit + delete round-trip through balance recompute, both for a plain expense and a transfer
