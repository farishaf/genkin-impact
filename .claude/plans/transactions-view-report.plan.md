# Plan: Transaction Table View + Report Panel

**Source**: conversational (grounded in `genkin-impact-data-model.md` §7 nav/IA — "List / Calendar / Table" view modes and a right-panel report with "dimensions, group by, outliers")
**Selected scope**: Table view mode + right-panel dimension report (group-by + outlier) on `TransactionsPage.tsx`, backed by a new `GET /transactions/report` endpoint
**Complexity**: Medium

## Context

Everything through the uncommitted refund/installments/saved-filters work covers the full transaction lifecycle and filtering. §7 of the data model calls for three view modes (List/Calendar/Table) plus a right-panel report with dimension breakdowns, group-by, and outliers — only List view exists today. §11 explicitly defers a "custom report builder beyond the existing dimension and group-by controls," which implies the *baseline* dimension/group-by report is in scope, just not a builder UI on top of it.

**Deferred to a later slice** (do not build in this pass):
- Calendar view mode — Analytics already has a heatmap calendar covering daily gain/loss; a second calendar on Transactions is separable scope, not a natural pair with the report panel.
- Any outlier detection beyond "largest single transaction in the current filtered range" (no anomaly/statistical detection).
- Persisting view mode or group-by selection (URL params, saved with saved-filters) — local component state only.

## Patterns to Mirror

| Category | Source | Pattern |
|---|---|---|
| Filtered aggregation query, multi-currency convert loop | `backend/src/routes/transactions.ts:477-545` (`GET /summary`) | `conditions` array + `conditions.join(" AND ")`, then per-currency-group `convert()` loop to fold into main currency |
| Money-aggregation queries must exclude installment origins | `backend/src/lib/balances.ts` `EXCLUDE_INSTALLMENT_ORIGIN_SQL`, spliced into `transactions.ts`/`analytics.ts`/`budgets.ts` | any new `SUM(amount)` query over transactions needs this fragment in its `WHERE`, or an installment origin double-counts against its own children |
| Grouped-by-day query shape | `backend/src/routes/analytics.ts:36-40` | `GROUP BY <dimension>, currency_code` then convert per group, matches the per-currency-then-convert shape the report groupBy needs |
| List query filter params | `backend/src/routes/transactions.ts:404-413` (`listQuerySchema`) | same query params (`type`, `from`, `to`, `member_id`, `tag_id`, `category_id`) — reuse verbatim on the new report endpoint so the panel always matches the list |
| Two-pane page layout | none exists yet — no `.txn-layout`/right-panel grid in `base.css` (checked); nearest analog is `.summary-grid`/`.tile-grid` (`frontend/src/styles/base.css:119,270`), both `auto-fit` card grids, not a fixed main+sidebar split | new CSS is genuinely new, not mirrored — state this explicitly rather than force-fitting an existing class |
| Standalone chart/panel component | `frontend/src/components/HeatmapCalendar.tsx` + `frontend/src/components/TrendChart.tsx`, composed into `AnalyticsPage.tsx` | small presentational component taking pre-fetched data + a selection callback as props, not owning its own fetch beyond its own query |

## Files to Change

| File | Action | Why |
|---|---|---|
| `backend/src/routes/transactions.ts` | UPDATE | add `GET /transactions/report` (group-by dimension breakdown + largest-transaction outlier) |
| `backend/src/routes/transactions.test.ts` | UPDATE | coverage for grouping, multi-currency conversion, installment-origin exclusion, outlier pick |
| `frontend/src/components/TransactionsReportPanel.tsx` | CREATE | group-by selector, bar list, outlier callout; clicking a bar applies that dimension as a filter via callback prop |
| `frontend/src/routes/TransactionsPage.tsx` | UPDATE | List/Table view toggle, table rendering, two-pane layout wrapping list + `TransactionsReportPanel` |
| `frontend/src/styles/base.css` | UPDATE | additive: `.txn-layout` two-column grid, `.txn-table`, report bar/outlier styles |

## Tasks

### Task 1: `GET /transactions/report`
- **Action**: Query params identical to `listQuerySchema` (`type`, `from`, `to`, `member_id`, `tag_id`, `category_id`) plus `group_by: z.enum(["category", "tag", "member", "account"])`. Build the same `conditions` array as `GET /summary`, append `EXCLUDE_INSTALLMENT_ORIGIN_SQL`, restrict to `type IN ('income','expense')`. Group query: join the dimension table (categories/tags via `transaction_tags`/members/accounts), `GROUP BY dimension.id, dimension.name, t.currency_code`. Fold each currency group into main currency via `convert()` (same loop as `GET /summary`), sum per dimension label, sort desc by converted total. Outlier: `SELECT DISTINCT ON (currency_code) id, note, category_id, amount, currency_code, occurred_at FROM transactions WHERE <same conditions> ORDER BY currency_code, amount DESC`, convert each of the (small, one-per-currency) candidates to main currency, return the max. Response: `{ groups: [{ id, label, total_minor, count }], outlier: { id, label, amount_minor, currency_code, occurred_at } | null, main_currency_code }`.
- **Mirror**: `GET /summary`'s conditions + convert loop; `analytics.ts`'s grouped-then-convert shape
- **Validate**: `npx vitest run`

### Task 2: Tests
- **Action**: In `transactions.test.ts` — group-by category totals correct across two currencies (converted, not raw-summed); installment origin excluded from its own category's total (children counted instead); transfers excluded from all groups; outlier picks the true largest after conversion, not the largest raw minor-unit number; empty range returns `groups: []`, `outlier: null`.
- **Validate**: `npx vitest run`

### Task 3: `TransactionsReportPanel.tsx`
- **Action**: Props: current filter params (same shape as the page's filter state) + `onSelectGroup(dimension, id)` callback. Own `groupBy` state (default `"category"`), fetch `/transactions/report` keyed on `[groupBy, ...filters]`. Render a group-by `<select>` (Category/Tag/Member/Account), a bar list (label + converted amount + count, width proportional to max in the set — plain divs, no chart lib), and an outlier callout card ("Largest: {label} {amount}" ) reusing `.card`/`.stat-card` patterns. Clicking a bar calls `onSelectGroup` so the parent can set `categoryFilter`/`tagFilter`/`memberFilter` directly (no account filter exists yet on the page — account-dimension bars are display-only, not clickable).
- **Mirror**: `HeatmapCalendar`/`TrendChart` composition style — pre-typed props, no internal routing or global state
- **Validate**: manual — switching group-by re-renders bars correctly, clicking a category bar sets the existing category filter and both list and panel update

### Task 4: View toggle + Table view in `TransactionsPage.tsx`
- **Action**: Add `const [viewMode, setViewMode] = useState<"list" | "table">("list")` and a small segmented toggle in `.page-head` next to the existing filters. Table view renders the same `items` array (no new fetch) as an HTML `<table>`: Date | Category | Member | Account | Note | Amount columns, one row per transaction, refund/installment badges collapsed into a small superscript marker rather than full chips (space-constrained). Keep List view's existing row markup, actions, and inline refund/installment forms untouched — Table view is read-only (no inline row actions), matching how compact table views typically work; edit/delete/refund stay available from List view.
- **Mirror**: existing `items` query and `TxnItem` shape — no backend change needed for this part
- **Validate**: manual — toggle switches rendering, same filtered data in both, no console errors

### Task 5: Two-pane layout
- **Action**: Wrap the existing `.txn-card` (list/table) and the new `TransactionsReportPanel` in a new `.txn-layout` grid (`grid-template-columns: 1fr 300px`, single column under a mobile breakpoint). Wire `TransactionsReportPanel`'s `onSelectGroup` to the page's existing `setCategoryFilter`/`setTagFilter`/`setMemberFilter`.
- **Mirror**: none — new layout, stated above
- **Validate**: visual check at desktop and narrow widths

### Task 6: CSS
- **Action**: Additive only — `.txn-layout` grid, `.txn-table` (border-collapse, row padding matching `.txn-row`'s spacing tokens), `.report-bar`/`.report-bar__fill` (reuse `--color-gain`/`--color-loss` tokens already defined), `.outlier-card` (reuse `.stat-card` if it fits, extend only if it doesn't).
- **Validate**: visual check in browser, both themes if the app has a dark mode toggle (check `base.css` for `prefers-color-scheme` — mirror whatever's already there, don't introduce a new theming mechanism)

### Task 7: Manual QA
- **Action**: Via chrome-devtools on a fresh QA user (register new, don't reuse — `npx vitest run` wipes shared dev DB per project memory): create transactions in 2+ categories and 2+ currencies (if multi-currency accounts exist for that user), confirm report panel totals match manual sum after conversion, confirm outlier is genuinely the largest after conversion not raw minor units, toggle List/Table view, click a report bar and confirm the list filters accordingly, check console for errors.
- **Validate**: no console errors, report totals and outlier correct

## Verification

```bash
cd backend && npm run typecheck && npx vitest run
cd frontend && npm run build
```
Plus the chrome-devtools manual QA in Task 7.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Cross-currency outlier ranking is subtly wrong if a user has many currencies (DISTINCT ON caps candidates at one-per-currency, which is correct only if the true max in a given currency is also that currency's single largest raw row — it is, by definition) | Low | covered by Task 2's multi-currency outlier test |
| Report query cost grows with tag cardinality (group_by=tag joins `transaction_tags`) | Low | same join pattern already used in the list endpoint's `tag_id` filter; no new index needed at current scale |
| Two-pane layout collides with existing `.page` padding/width assumptions used by other pages | Low | scope the new grid class to `.txn-layout` only, don't touch shared `.page`/`.page-head` |

## Acceptance
- [ ] All tasks complete
- [ ] Validation passes (`vitest run` backend, `npm run build` both)
- [ ] Report endpoint reuses `EXCLUDE_INSTALLMENT_ORIGIN_SQL` and the existing filter param shape, not reinvented
- [ ] Manual QA: group-by switch, bar-click-to-filter, List/Table toggle, and outlier correctness all verified live
