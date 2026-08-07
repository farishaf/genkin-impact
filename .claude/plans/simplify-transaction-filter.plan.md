# Plan: Simplify Transaction Filter to Match dc.html UI

**Source**: `Genkin-Impact.dc.html` (Daily/Analytics scenes), user request
**Complexity**: Medium

## Summary
Collapse `TransactionsPage`'s current filter UI — 4 always-visible `<select>` dropdowns (type/member/tag/category) plus two separate chip rows (date presets, saved filters) — into a single `filter-chip` trigger in the page-head that opens a popover, mirroring dc.html's pattern where the page-head only shows a compact `Preset Filters` chip + an emphasized active-filter-name chip (`Genkin-Impact.dc.html:606-607`). Saved filters and date presets move inside that popover as sections instead of separate rows.

## Patterns to Mirror
| Category | Source | Pattern |
|---|---|---|
| Chip markup | `Genkin-Impact.dc.html:606-607` | `<span class="filter-chip">Preset Filters</span>` + `<span class="filter-chip" data-emph="true">Last Month</span>` — a label chip and an emphasized value chip |
| Chip CSS | `frontend/src/styles/base.css:240-241` | `.filter-chip` / `.filter-chip--emph` already ported (dc.html uses `data-emph`, app uses a class — keep app's existing convention) |
| Toggle/segmented | `frontend/src/styles/base.css:322-325` | `.seg-toggle` pattern for List/Table toggle — reuse same look for popover internal toggles if needed |
| Existing chip row | `frontend/src/routes/TransactionsPage.tsx:501-534` | `.tag-chips` + `.tag-chip` used for date presets and saved filters — reuse inside popover body |
| Page-head structure | `frontend/src/routes/TransactionsPage.tsx:454-499` | `.page-head` with `h1`, count badge, `head-spacer`, controls, ends with primary action button |

## Files to Change
| File | Action | Why |
|---|---|---|
| `frontend/src/routes/TransactionsPage.tsx` | UPDATE | Replace 4 selects + date-preset row + saved-filter row with one filter-chip trigger + popover panel containing all filter controls |
| `frontend/src/styles/base.css` | UPDATE | Add minimal popover positioning styles (`.filter-popover` — absolute panel anchored under trigger); reuse existing `.filter-chip`, `.tag-chips`, `.seg` styles inside it |

No new component file — this is one page's local UI state, doesn't warrant extraction.

## Tasks

### Task 1: Popover state + outside-click close
- **Action**: Add `const [filterOpen, setFilterOpen] = useState(false)` and a ref + click-outside handler (or a simple `<details>`/native approach if simpler — decide inline, favor least code) to close the popover.
- **Mirror**: No existing popover in codebase; keep it minimal — a positioned `<div>` conditionally rendered, closed on outside click and Escape.
- **Validate**: Manual click test in browser.

### Task 2: Page-head trigger chip
- **Action**: Replace the 4 `<select className="seg">` elements in the page-head (`TransactionsPage.tsx:458-487`) with a single button styled as `.filter-chip`, showing "Filters" and, when any filter is active, a second emphasized chip summarizing count (e.g. "3 active") — mirrors `Preset Filters` + `Last Month` pair from dc.html.
- **Mirror**: `Genkin-Impact.dc.html:606-607`
- **Validate**: Visual check — page-head no longer shows 4 dropdowns.

### Task 3: Popover body — filter controls
- **Action**: Move the type/member/tag/category selects, the date-preset `.tag-chips` row (`TransactionsPage.tsx:501-512`), and the saved-filters `.tag-chips` row (`TransactionsPage.tsx:514-534`) into the popover panel, stacked as labeled sections. Keep existing state/handlers (`typeFilter`, `applyRangePreset`, `applySavedFilter`, `handleSaveCurrentFilter`) unchanged — this is a layout move, not a logic rewrite.
- **Mirror**: Existing `.tag-chips`/`.tag-chip` markup, just relocated.
- **Validate**: Each filter still narrows the transaction list and summary as before.

### Task 4: Clear-all affordance
- **Action**: Add a small "Clear filters" action inside the popover (visible only when a filter is active) that resets all filter state — dc.html doesn't show this explicitly but it's needed once selects are hidden, otherwise users can't tell what's active without opening the popover.
- **Validate**: Clicking it resets list to unfiltered state.

### Task 5: CSS for popover
- **Action**: Add `.filter-popover { position: absolute; top: ...; z-index: ...; background: var(--color-paper-2); border: 1px solid var(--color-rule); border-radius: var(--radius-md); box-shadow: ...; padding: var(--space-lg); }` sized to fit stacked sections. Trigger wrapper gets `position: relative`.
- **Validate**: Popover renders below trigger, doesn't clip/overflow page.

## Validation
```bash
cd frontend && npm run build   # type-check
cd frontend && npm run dev     # manual check: open Transactions, click Filters chip, apply each filter type, verify list/summary update, verify saved filter save/apply/delete still works, verify Clear filters resets
```

## Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| `TransactionsReportPanel` (right sidebar) reads filter state via props — moving markup must not change the state shape it receives | Low | Keep all `useState` filter variables as-is; only JSX layout moves |
| Popover clipped by `overflow: hidden` on an ancestor | Medium | Check `.page-head`/`.txn-page__content` for overflow rules before finalizing CSS |
| Losing at-a-glance visibility of which filters are active (previously all 4 selects showed their value) | Medium | Task 4's active-count chip + popover keeping selects' current values pre-filled covers this |

## Acceptance
- [ ] Page-head shows one filter-chip trigger instead of 4 selects + 2 chip rows
- [ ] All existing filter behavior (type/member/tag/category/date range/saved filters) still works, unchanged logic
- [ ] `npm run build` passes
- [ ] Manually verified in browser
