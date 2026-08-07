# Plan: Landing Page + Luminous Ledger Token Rebase

**Source brief**: `/Users/farishhaf/Downloads/genkin_impact_project_prd.md`
**Design references**: `/Users/farishhaf/Downloads/stitch/{DESIGN.md,screen.png,code.html}` (light) + user-supplied dark-mode screenshot
**Selected milestone**: Core Feature 2 — Landing Page, plus the design-token groundwork the PRD's "Design System: Luminous Ledger" section implies
**Complexity**: Medium-Large

## Summary

Add a public marketing landing page at `/` (the app currently has no `/` — it redirects straight to `/app/transactions`), built from the supplied Luminous Ledger DNA in both light and dark themes with real glassmorphism. Alongside it, rewrite `frontend/src/styles/tokens.css` into a complete dual-theme token system so the rest of the app can be redesigned incrementally without another token migration. Every existing token name survives as an alias, so no existing page changes appearance in this pass.

## Design decisions (Hallmark)

Pre-flight found: Geist via Google Fonts (`frontend/index.html:10`), OKLCH light-only tokens (`frontend/src/styles/tokens.css:2-49`), GSAP 3.15 installed (motion-on project), React 19 + Vite 8, plain CSS (no Tailwind), no dark mode and no `backdrop-filter` anywhere in the 457-line `base.css`.

| Axis | Pick | Why |
|---|---|---|
| Genre | modern-minimal | Analytics platform; both references are the Stripe/Linear school |
| Theme route | **studied-DNA — "Luminous Ledger"** | The user supplied a complete design system (`stitch/DESIGN.md`) plus two screenshots. Catalog rotation and theme diversification are suspended for this build; we follow the supplied DNA. |
| Macrostructure | **03 · Marquee Hero** | Statement fills the fold, product panel carries it, page becomes a feature grid below |
| Hero | H1 Marquee — size `xl`, alignment centred, underlay none | Matches both references |
| Nav | **N1b · Canonical SaaS three-section** — centre links 3, dropdowns none, scroll frost-on-scroll | Reference nav is exactly this shape (wordmark · Features/Analytics/Security · Sign Up) |
| Features | **F1 Bento** — tiles 3, spans regular, border hairline-all | Reference "Why Genkin?" row |
| Footer | **Ft2 · Inline single line** — order credit/links, separator middot, density spaced | Reference footer is exactly this |
| Enrichment | Product panel built as real DOM from real product markup, static demo data | Not a re-drawn browser/phone frame (Hallmark gate 47) — it is the product's own UI, so building it honestly beats a fake screenshot |
| Motion | 3 primitives: nav frost-on-scroll · hero panel rise-in (GSAP, once) · feature card hairline lift on hover | Under Hallmark's 3-primitive cap; all collapse under `prefers-reduced-motion` |

**Font**: switching to Inter per the confirmed decision. Geist and Inter have near-identical metrics, so existing layouts should be visually stable — but this changes every page's type, so it gets its own verification step.

## Honest-copy concerns (must resolve before build)

Two items in the PRD/reference are fabricated proof. Hallmark gate 46 forbids shipping them, and they are also a real credibility liability on a product with no customers.

1. **"Trusted by" bank logo bar.** The PRD asks for "major financial institutions to establish credibility." Genkin-Impact has no institutional relationships and the reference logos are generic bank glyphs. **Plan default**: replace with an honest capability strip — "Multi-currency · IDR, USD, JPY, CNY, EUR, GBP, HKD · Manual entry or CSV import · Your data stays yours." Same visual slot, same rhythm, no invented claim. Say the word and I ship the logo bar instead.
2. **"Watch Demo" secondary CTA.** No demo video exists. **Plan default**: secondary CTA becomes "See how it works" anchoring to the feature section. If a demo gets recorded later it swaps in cleanly.

Sample figures in the hero panel are fine (they are a labelled product preview, not a customer metric) but will use **IDR** via the app's real `formatAmount` conventions, not the references' ¥/HK$ — `IDR` is 0-decimal and already seeded (`frontend/src/lib/formatAmount.ts:3`, `backend/migrations/0008_idr_currency.sql`).

## Patterns to Mirror

| Category | Source | Pattern |
|---|---|---|
| Tokens | `frontend/src/styles/tokens.css:2-49` | OKLCH custom properties on `:root`, semantic names, `--space-*` / `--text-*` / `--radius-*` / `--ease-*` / `--dur-*` groups |
| Styling | `frontend/src/styles/base.css:13-60` | Plain CSS, class-per-component (`.card`, `.btn`, `.btn--primary`), tokens by name never raw values |
| Component | `frontend/src/components/Button.tsx` | Existing reusable button — landing CTAs reuse it, no new button component |
| Route | `frontend/src/App.tsx:16-46` | Flat `<Route>` list; guards are wrapper components (`RequireAuth`, `RequireOnboarded`) |
| Page | `frontend/src/routes/LoginPage.tsx:6-47` | Named export function component, no default export |
| Auth state | `frontend/src/hooks/useAuth.ts` (`useCurrentUser`) | React Query hook — landing uses it to redirect signed-in visitors |
| Currency | `frontend/src/lib/formatAmount.ts:5-9` | `formatAmount(minorUnits, code)` — demo data goes through it, not hardcoded strings |

No existing dark-mode or glassmorphism pattern exists in this repo. Both are new.

## Files to Change

| File | Action | Why |
|---|---|---|
| `frontend/src/styles/tokens.css` | UPDATE (rewrite) | Dual-theme Luminous Ledger system + back-compat aliases |
| `frontend/src/styles/base.css` | UPDATE (append only) | Glass utility classes, dark-safe base rules. Never clobber the existing 457 lines. |
| `frontend/src/styles/landing.css` | CREATE | All landing-page styling, carries the Hallmark stamp comment |
| `frontend/src/routes/LandingPage.tsx` | CREATE | Nav + hero + panel + features + footer in one file |
| `frontend/src/hooks/useDisplayPrefs.ts` | CREATE | Theme (light/dark/system) + gain-loss convention, persisted to `localStorage`, applied as `data-theme` / `data-convention` on `<html>` |
| `frontend/src/App.tsx` | UPDATE | `/` route + change the `*` fallback |
| `frontend/index.html` | UPDATE | Inter font, `color-scheme` meta, inline no-flash theme script |
| `frontend/src/layout/AppShell.tsx` | UPDATE | Theme toggle + convention toggle in the topbar |
| `.hallmark/log.json` | CREATE | Hallmark project memory for future runs |

No deletions. `LoginPage.tsx` stays at `/login`, untouched.

## Tasks

### Task 1 · Token system rewrite

- **Action**: Rewrite `tokens.css` with these groups, light values on `:root`, dark values under **both** `@media (prefers-color-scheme: dark)` and `[data-theme="dark"]`, with `[data-theme="light"]` winning back over the media query.
  - **Surface ladder** — `--color-paper` … `--color-paper-3` plus a new `--color-paper-4` (light: `#f8f9ff` → white → `#eff4ff` → `#e5eeff`; dark: the deep-charcoal band from the dark screenshot).
  - **Ink ladder** — `--color-ink`, `--color-ink-2`, `--color-muted` (light anchor `#0b1c30`).
  - **Primary** — `--color-primary` emerald `#10b981` in OKLCH, `--color-primary-ink`, `--color-primary-container`.
  - **Fixed money semantics** — `--color-income` (emerald), `--color-expense` (coral `#dc2c4f`), `--color-balance` (blue). These never flip; income is money in, expense is money out.
  - **Convention-swappable** — `--color-gain` / `--color-loss` resolve under `[data-convention="eastern"]` (default, preserves today's red-gain behaviour) and `[data-convention="western"]`.
  - **Glass** — `--glass-bg`, `--glass-blur` (12px), `--glass-border`, `--glass-highlight`, `--glass-shadow` (`0 4px 20px rgba(15,23,42,0.05)` light; a darker, tighter ambient in dark).
  - **Type** — `--font-body` → Inter; new `--text-display`, `--text-display-s`, `--text-headline` per DESIGN.md's scale; keep every existing `--text-*`.
  - Keep `--radius-*`, `--space-*`, `--ease-out`, `--dur-short` and add `--radius-xl: 24px`, `--ease-in`, `--ease-in-out`, `--dur-med`.
- **Back-compat aliases (non-negotiable)**: every currently-used name — `--color-paper`, `--color-paper-2`, `--color-paper-3`, `--color-rule`, `--color-ink`, `--color-ink-2`, `--color-muted`, `--color-accent`, `--color-accent-ink`, `--color-positive`, `--color-negative`, `--color-info`, `--color-focus`, `--color-gain`, `--color-loss` — must resolve to values that keep existing pages looking as they do today in light mode. Note `--color-positive` is currently *red* and `--color-negative` *green* (`tokens.css:15-16`); preserve that mapping rather than "fixing" it, and leave a comment saying so.
- **Mirror**: existing OKLCH + semantic-name style in `tokens.css`.
- **Validate**: `npm run build`; open `/app/transactions`, `/app/analytics`, `/app/assets`, `/app/plans` in light mode and diff against a pre-change screenshot — nothing should move.

### Task 2 · Display preferences hook + toggles

- **Action**: `useDisplayPrefs.ts` exporting `useTheme()` (`"light" | "dark" | "system"`) and `useConvention()` (`"eastern" | "western"`, default `"eastern"`). Both persist to `localStorage` and write `data-theme` / `data-convention` on `document.documentElement`. Add the matching inline script in `index.html` `<head>` to set the attribute before first paint (no flash-of-wrong-theme).
- Add two small controls to the `AppShell` topbar next to the currency chip (`AppShell.tsx:21`): theme toggle, and a gain/loss convention control.
- **Mirror**: `useAuth.ts` hook style; `AppShell.tsx` topbar button conventions (`.btn-outline`).
- **Validate**: toggle each, hard-reload, setting persists; `data-convention="western"` flips Analytics gain/loss colours and nothing else.

### Task 3 · Landing page

- **Action**: `LandingPage.tsx` + `landing.css`. Sections in DOM order: **Nav (N1b) · Hero (H1 marquee) · Glass product panel · Capability strip · Why Genkin (F1 bento, 3 tiles) · Final CTA · Footer (Ft2)**.
  - Glass panel reproduces the Daily overview: Income / Expenditure / Balance / Transactions summary cards + a short transaction list, all IDR via `formatAmount`, all static demo constants in the same file.
  - Feature tiles carry real miniatures (heatmap grid, trend bars, activity rows) drawn in CSS/SVG — not icons, not stock art.
  - CTAs reuse `components/Button.tsx`. Primary → `/register`, secondary → in-page anchor.
  - `landing.css` opens with the Hallmark stamp comment recording macrostructure, theme, archetypes, knobs.
- **Mirror**: `LoginPage.tsx` named-export component shape; `base.css` class-per-component styling.
- **Validate**: renders at 320 / 375 / 414 / 768 / 1280 px with no horizontal scroll; light and dark both correct; glass blur visible on both.

### Task 4 · Routing

- **Action**: In `App.tsx`, add `<Route path="/" element={<LandingPage />} />` and change the `*` fallback from `/app/transactions` to `/`. `LandingPage` redirects to `/app/transactions` when `useCurrentUser()` returns a signed-in, onboarded user — so returning users never see the marketing page.
- **Mirror**: existing flat route list and guard-wrapper pattern (`App.tsx:16-46`).
- **Validate**: signed-out `/` shows landing; signed-in `/` redirects; `/login` and `/register` still work; an unknown path lands on `/` not a redirect loop.

### Task 5 · Font swap + glass utilities

- **Action**: Swap the Geist `<link>` for Inter (`index.html:10`), point `--font-body` at Inter. Append glass utility classes to `base.css` with a `@supports not (backdrop-filter: blur(1px))` fallback to an opaque surface.
- **Validate**: `npm run build`; walk every existing page checking for wrapping/overflow the metric change introduced.

### Task 6 · Hallmark slop test + memory

- **Action**: Run the 58-gate slop test against the emitted page. Write `.hallmark/log.json` with this build's entry.
- **Validate**: all gates pass, with the mobile non-negotiables (34, 49, 50, 51, 52) checked explicitly at all four widths.

## Validation

```bash
cd /Users/farishhaf/genkin-impact/frontend
npm run build     # tsc -b && vite build
npm run lint
npm run dev       # then check / , /login , /app/transactions , /app/analytics
```

Manual matrix: {light, dark, system} × {320, 375, 414, 768, 1280} px, plus `prefers-reduced-motion: reduce`, plus `data-convention` eastern/western on Analytics.

Backend tests are untouched by this work. Note: `npx vitest run` in `backend/` wipes dev data — do not run it to "check nothing broke."

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Token rewrite silently changes existing pages | High | Alias every existing token name to a value-identical light-mode result; screenshot-diff all four app pages before/after |
| Inter swap shifts existing layouts | Medium | Near-identical metrics to Geist; dedicated verification step (Task 5) across all pages |
| Dark mode half-applied — landing dark, app light-only | Medium | Expected and intentional this pass. App pages stay pinned to light via `color-scheme` until they are migrated; the toggle is documented as landing-first. |
| `backdrop-filter` unsupported / disabled | Low | `@supports` fallback to opaque `--color-paper-2`; blur is decoration, never the only contrast source |
| Per-user `--color-accent` override (`AppShell.tsx:11`) clashes with emerald primary | Medium | Keep `--color-accent` as the user-overridable token; landing uses `--color-primary`, which is not overridable. They are deliberately separate. |
| `*` fallback change causes a redirect loop | Low | Landing redirects only on a confirmed signed-in+onboarded user; explicit test in Task 4 |
| Fabricated social proof ships | Medium | Resolved above — honest capability strip is the default; the logo bar is opt-in |

## Acceptance

- [ ] All six tasks complete
- [ ] `npm run build` and `npm run lint` clean
- [ ] Landing page renders correctly in light and dark at 320/375/414/768/1280 px, no horizontal scroll
- [ ] Glass blur visibly applied on the hero panel and nav, with a working `@supports` fallback
- [ ] Existing app pages visually unchanged in light mode
- [ ] Theme and convention settings persist across reload, no flash of wrong theme
- [ ] Hallmark slop test passes 58/58; stamp present in `landing.css`; `.hallmark/log.json` written
- [ ] No invented metrics, logos, or testimonials anywhere on the page
