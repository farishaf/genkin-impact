# Plan: Transactions richness (tags + members + filters)

**Source**: conversational (grounded in `Genkin-Impact.dc.html` and `genkin-impact-data-model.md`)
**Selected scope**: Members + Tags CRUD, attach both to transactions, filter panel on Transactions list
**Complexity**: Medium

## Summary

Registration already seeds a default member (`backend/src/routes/auth.ts:126`) and default categories, but there are no read/write API routes for members or tags, and transactions can't be attributed to a member or tagged even though the schema (`members`, `tags`, `transaction_tags` tables, `transactions.member_id` column) already supports it. This slice exposes that schema through the API and wires it into transaction creation and list filtering.

**Deferred to later slices** (do not build in this pass):
- Saved filters — needs a new `saved_filters` table, none exists yet.
- Edit/delete transactions — no PATCH/DELETE endpoint exists at all today; balance-recompute implications make it its own slice.
- Calendar/table view modes for the Transactions page.
- Nested tags UI — schema supports `parent_id` (e.g. "Cars" parent of "Benz"), but this pass ships flat tags only (`parent_id` always null on create).

## Patterns to Mirror

| Category | Source | Pattern |
|---|---|---|
| Simple list route | `backend/src/routes/categories.ts` | `GET` + `validateQuery`, scoped by `user_id` + `deleted_at IS NULL` |
| Create route | `backend/src/routes/accounts.ts:41-85` | `validateBody`, `newId()`, `RETURNING *` |
| Transaction insert | `backend/src/routes/transactions.ts:48-119` | zod union schema, `withTransaction` |
| Create-form | `frontend/src/components/AddTransactionForm.tsx` | `useQuery` for options, controlled `<select>`, mutation + `invalidateQueries` |

## Files to Change

| File | Action | Why |
|---|---|---|
| `backend/src/routes/members.ts` | CREATE | `GET /members`, `POST /members` |
| `backend/src/routes/members.test.ts` | CREATE | coverage |
| `backend/src/routes/tags.ts` | CREATE | `GET /tags`, `POST /tags` (flat, `parent_id` always null this pass) |
| `backend/src/routes/tags.test.ts` | CREATE | coverage |
| `backend/src/app.ts` | UPDATE | mount both routers |
| `backend/src/routes/transactions.ts` | UPDATE | accept optional `member_id`/`tag_ids[]` on create, insert into `transaction_tags`; list accepts `member_id`/`tag_id`/`category_id` filters, returns `member_name` + `tags[]` per row |
| `backend/src/routes/transactions.test.ts` | UPDATE | new tests for attach + filters |
| `frontend/src/components/AddTransactionForm.tsx` | UPDATE | member `<select>` (optional), tag multi-select chips |
| `frontend/src/routes/TransactionsPage.tsx` | UPDATE | filter row: member, tag, category selects alongside existing type filter |
| `frontend/src/styles/base.css` | UPDATE | tag-chip / filter-row classes (additive) |

## Tasks

### Task 1: Members + Tags backend routes
- **Action**: Create `members.ts` and `tags.ts`, each with `GET` (list) mirroring `categories.ts`, and `POST` (create) mirroring `accounts.ts`'s create pattern (validateBody, newId, RETURNING *). Members: `name` required, `initials` required (derive suggestion client-side, but accept as sent), `color` optional. Tags: `name` required, `color` optional, `parent_id` always omitted/null this pass.
- **Mirror**: `backend/src/routes/categories.ts` (list), `backend/src/routes/accounts.ts:41-85` (create)
- **Validate**: `members.test.ts`, `tags.test.ts`

### Task 2: Wire members + tags into transactions
- **Action**: Extend `createTransactionSchema` in `transactions.ts` with `member_id: z.string().uuid().optional()` and `tag_ids: z.string().uuid().array().optional()`. Validate both belong to `req.userId` before insert. Insert `transaction_tags` rows inside the existing `withTransaction` block. Extend `listQuerySchema` with `member_id`, `tag_id`, `category_id` (optional uuid filters). Update the list `SELECT` to LEFT JOIN `members`, and aggregate tags via `transaction_tags`/`tags` (e.g. `json_agg` or a second query per page of results — keep it simple, mirror the existing category/account JOIN style already in the list query).
- **Mirror**: `backend/src/routes/transactions.ts:48-119` (create, `withTransaction`), `:133-168` (list, JOIN + conditions array)
- **Validate**: updated `transactions.test.ts` — create with member+tags, filter list by each

### Task 3: Mount routers
- **Action**: Import and `app.use("/members", membersRouter)`, `app.use("/tags", tagsRouter)` in `app.ts`.
- **Mirror**: existing router mounts in `app.ts`
- **Validate**: `npm run build` (backend)

### Task 4: AddTransactionForm — member + tag inputs
- **Action**: Fetch `/members` and `/tags` via `useQuery` (mirror the existing `accounts`/`categories` queries in the same file). Add an optional member `<select>` and a tag multi-select (chip-toggle buttons, not a native multi-select — better UX for a handful of tags). Include `member_id`/`tag_ids` in the mutation body when set.
- **Mirror**: existing `accounts`/`categories` `useQuery` blocks in `AddTransactionForm.tsx`
- **Validate**: manual — create a transaction with a member and 2 tags, confirm it round-trips

### Task 5: TransactionsPage — filter panel
- **Action**: Add member/tag/category `<select>` filters alongside the existing type filter (`typeFilter` state pattern). Pass selected values into the `/transactions` query string. Reuse `.seg` class for consistency with the existing type filter.
- **Mirror**: existing `typeFilter` state + query in `TransactionsPage.tsx`
- **Validate**: manual — filter by member, by tag, by category; confirm result counts match

### Task 6: CSS
- **Action**: Add tag-chip toggle classes and any filter-row layout tweaks to `base.css`, additive only, reusing existing tokens (`--space-*`, `--radius-*`, `--color-*`). No new tokens needed.
- **Mirror**: existing `.seg`, `.plans-tab` toggle-button patterns
- **Validate**: visual check in browser

### Task 7: Manual QA
- **Action**: Via chrome-devtools (or `run` skill): register/reuse a test user, create a transaction with a member and 2 tags, filter the Transactions list by member, by tag, and by category, confirm results match. Check console for errors.
- **Validate**: no console errors, filter results correct

## Validation

```bash
cd backend && npm run build && npm test
cd frontend && npm run build
```

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Tag/member `id` from another user injected via API | Low | scope every lookup by `user_id`, mirror existing category-ownership check in `transactions.ts:93-100` |
| List query grows another LEFT JOIN + aggregate — perf at scale | Low | fine at slice scope (personal ledger), same precedent as existing category/account joins |
| Empty `tag_ids` vs omitted — ambiguous "clear tags" semantics | N/A this pass | create-only in this slice (no edit endpoint yet), so no clear-tags case exists |

## Acceptance
- [ ] All tasks complete
- [ ] Validation passes (`npm test` backend, `npm run build` both)
- [ ] Patterns mirrored (categories.ts / accounts.ts / transactions.ts / AddTransactionForm.tsx), not reinvented
- [ ] Manual QA: member + tags round-trip through create and filter

## Notes for the next session

This file is the full handoff — no other context needed. Reminder before running the backend test suite: `npx vitest run` wipes the dev DB (no separate `TEST_DATABASE_URL`), so any manually-created QA data will be lost. See the `project_backend_tests_share_dev_db` memory if picking this plan up in a fresh session.
