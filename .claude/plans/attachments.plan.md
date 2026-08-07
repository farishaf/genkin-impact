# Plan: Transaction Attachments (receipts)

**Source spec**: Genkin-Impact.dc.html + genkin-impact-data-model.md §3 (ATTACHMENTS entity), §6 ("Attach tags, note, receipt")
**Complexity**: Medium

## Summary
Data model defines an `attachments` table linked 1:many to `transactions`, and the transaction-creation flow explicitly includes "attach... receipt." No code exists for this yet (no migration, no route, no upload UI). OCR is explicitly deferred (§11) — plain file storage is not. This scope adds: file upload on create/edit, storage on local disk (no S3 in repo, keep it simple), download route gated by ownership, and a small receipt affordance in the transaction row.

## Patterns to Mirror
| Category | Source | Pattern |
|---|---|---|
| Migration | `backend/migrations/0005_installment_plans.sql` | numbered SQL file, table + index, FK added via ALTER if it targets an earlier table |
| Route auth+ownership | `backend/src/routes/transactions.ts:64-72` (`loadOwnedAccount`) | load-and-check-ownership helper before any mutation, `AppError(400/404, code, msg)` on miss |
| Route validation | `backend/src/routes/transactions.ts:16-62` | zod schema per route, `validateBody`/`validateQuery` middleware |
| Router wiring | `backend/src/app.ts:6-42` | one `xRouter` import + `app.use("/x", xRouter)` |
| Tests | `backend/src/routes/transactions.test.ts` | supertest against real Express app + real Postgres (per memory: tests share the dev DB — expect it to get wiped on `vitest run`) |
| Frontend mutation | `frontend/src/routes/TransactionsPage.tsx:264-277` (`refundTxn`, `installmentsTxn`) | `useMutation` + `api.post`, inline `<form>` toggled by local state |
| GSAP entrance | `frontend/src/components/TransactionsReportPanel.tsx:87-91` | `useGSAP(() => gsap.from(".report-bar", {...}))` registered once, scoped by ref |

## Files to Change
| File | Action | Why |
|---|---|---|
| `backend/migrations/0007_attachments.sql` | CREATE | `attachments` table per ERD: id, transaction_id FK, storage_key, mime_type, byte_size, created_at |
| `backend/package.json` | UPDATE | add `multer` + `@types/multer` — no existing multipart handling |
| `backend/src/routes/attachments.ts` | CREATE | `POST /transactions/:id/attachments` (multipart, ≤5MB, image/jpeg/png/webp/pdf allow-list), `GET /attachments/:id` (stream file, ownership-checked), `DELETE /attachments/:id` |
| `backend/src/app.ts` | UPDATE | wire `attachmentsRouter` |
| `backend/uploads/.gitkeep` | CREATE | local disk target dir, gitignored contents |
| `.gitignore` | UPDATE | ignore `backend/uploads/*` except `.gitkeep` |
| `backend/src/routes/attachments.test.ts` | CREATE | upload/download/delete + cross-user 404 + bad-mime 400 |
| `frontend/src/lib/api.ts` | UPDATE (maybe) | check current client supports `FormData` bodies; add if missing |
| `frontend/src/components/AddTransactionForm.tsx` | UPDATE | file input, upload after txn create succeeds |
| `frontend/src/routes/TransactionsPage.tsx` | UPDATE | receipt chip/icon on rows that have attachments, click → open in new tab, delete affordance |
| `frontend/src/styles/*` | UPDATE | small `.chip-attachment` style per hallmark tokens (`--radius-sm`, `--color-paper-3`, existing `.chip-tag` as base) |

## Tasks
### Task 1: Migration
- **Action**: write `attachments` table (uuid id, transaction_id FK → transactions, storage_key text, mime_type text, byte_size int, created_at). No `user_id` column (ownership derives through the transaction, per ERD) — enforce via join in queries.
- **Mirror**: `0005_installment_plans.sql` structure
- **Validate**: `npm run migrate` (or repo's migrate script) applies cleanly

### Task 2: Backend upload/download/delete routes
- **Action**: multer disk storage → `backend/uploads/{uuid}`, mime/size validated in multer `fileFilter`; insert row with `storage_key` = generated filename; `GET /attachments/:id` loads row joined to transaction on `user_id = req.userId`, 404 if not found/not owned, streams with correct `Content-Type`; `DELETE` unlinks file + row, same ownership check.
- **Mirror**: `loadOwnedAccount` ownership pattern, `AppError` usage, router wiring in `app.ts`
- **Validate**: `attachments.test.ts` green

### Task 3: Frontend upload UI
- **Action**: file input in `AddTransactionForm`; on submit, create transaction first (existing flow), then if a file was picked, `POST` it to `/transactions/:id/attachments` as a second request; surface upload errors without blocking the already-created transaction.
- **Mirror**: existing two-step mutation chains aren't present yet — closest analog is `refundTxn`/`installmentsTxn`'s single mutation; keep this as two sequential `mutate`s, not a shared abstraction (one caller, no premature helper).
- **Validate**: manual run — create a transaction with a receipt, confirm it appears

### Task 4: Frontend display + gsap touch
- **Action**: paperclip icon/chip on txn rows with `has_attachment` (join into the list query), click opens `GET /attachments/:id` in new tab; small `gsap.from` fade/scale on the chip when a new attachment lands (mirrors report-bar entrance, not a new pattern)
- **Mirror**: `.chip-tag` styling, `TxnIcons.tsx` for a paperclip glyph if one doesn't exist yet
- **Validate**: visual check in dev server; respects `prefers-reduced-motion` (existing global CSS block already handles this — no extra work needed)

## Validation
```bash
cd backend && npm run typecheck && npx vitest run src/routes/attachments.test.ts
cd frontend && npm run typecheck && npm run build
```
Per memory: `npx vitest run` (unscoped) wipes dev/QA data in the shared DB — scope the test run to the new file, or warn before running the full suite.

## Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| Local disk storage won't survive container restarts/deploys (no S3 config in repo) | High, but accepted | `ponytail:` comment noting the ceiling; swap to S3-backed multer storage engine later, interface (storage_key) already decouples it |
| Full `vitest run` wipes shared dev DB (known issue) | Medium | Run only the new test file, per repo memory |
| Stale worktree backend may squat port 4000 during manual verification | Medium | Check `lsof -i :4000` before trusting dev-server checks (per repo memory) |

## Acceptance
- [ ] Migration applied, attachments table exists
- [ ] Upload/download/delete routes ownership-checked and tested
- [ ] AddTransactionForm can attach a receipt on create
- [ ] Transaction row shows a receipt affordance, opens the file
- [ ] `backend` and `frontend` typecheck clean
