# Slice 1 Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the React frontend for slice 1 of Genkin-Impact — login, register, onboarding (pick main currency + create first account), an app shell (topbar/sidebar), the Assets (accounts) screen, and the Transactions screen (list + summary cards + type filter + add-transaction form) — consuming the backend API built in `2026-08-04-slice-1-backend.md`.

**Architecture:** Vite + React 19 + TypeScript. `react-router-dom` for real routes with auth/onboarding guards. TanStack Query for all server state (fetching + cache invalidation after mutations). A thin `fetch`-based API client with cookie credentials (no token handling in JS — the backend's httpOnly cookies do that). Design system ported from the redesigned `Genkin-Impact.dc.html` (monochrome white/black palette, single-family Geist type) into real CSS custom properties + component classes, since the prototype's dc-runtime template syntax doesn't carry over — only its visual language does.

**Tech Stack:** React 19, TypeScript, `react-router-dom`, `@tanstack/react-query`, Vite. No CSS framework — hand-written CSS using the ported token system. No form library — plain controlled `useState` (forms in this slice are small: 2–5 fields each).

## Global Constraints

- Backend API base URL comes from `VITE_API_URL` (frontend `.env`), defaulting to `http://localhost:4000` in dev.
- All requests use `credentials: 'include'` — auth is entirely cookie-based, no tokens ever touch `localStorage` or JS-visible state.
- Design tokens ported from `Genkin-Impact.dc.html`'s current (post-pivot) `:root` block: true white paper, near-black ink doubling as the UI accent, single-family Geist type. Do not reintroduce the earlier serif/luxury palette — that was superseded.
- Slice-1 scope only: Login, Register, Onboarding, Assets (accounts list + create), Transactions (list + summary + type filter + create expense/income/transfer). No Analytics, Plans, right-side Report panel, tag/member filtering, or Saved Filters — matches the backend plan's scope exactly.
- Money display: amounts arrive from the API as minor-unit strings (e.g. `"6800"`) plus a `currency_code`. Format using the shared `formatAmount()` helper (Task 2), not ad hoc `/100` math, since JPY has 0 decimal digits and the others have 2.
- `.gitignore` already covers `.env`/`.env.*` at the repo root (set up in the backend plan's Task 1) — `frontend/.env` is safe to create with real values.

---

## File Structure

```
frontend/.env.example
frontend/src/styles/tokens.css
frontend/src/styles/base.css
frontend/src/lib/api.ts
frontend/src/lib/formatAmount.ts
frontend/src/lib/queryClient.ts
frontend/src/hooks/useAuth.ts
frontend/src/routes/RequireAuth.tsx
frontend/src/routes/LoginPage.tsx
frontend/src/routes/RegisterPage.tsx
frontend/src/routes/VerifyEmailPage.tsx
frontend/src/routes/OnboardingPage.tsx
frontend/src/routes/AssetsPage.tsx
frontend/src/routes/TransactionsPage.tsx
frontend/src/components/AddAccountForm.tsx
frontend/src/components/AddTransactionForm.tsx
frontend/src/layout/AppShell.tsx
frontend/src/App.tsx
frontend/src/main.tsx
frontend/src/App.css                         # deleted — replaced by styles/base.css
frontend/src/index.css                       # deleted — replaced by styles/tokens.css
```

---

### Task 1: Dependencies, env, design tokens + base CSS

**Files:**
- Create: `frontend/.env.example`
- Create: `frontend/src/styles/tokens.css`
- Create: `frontend/src/styles/base.css`
- Modify: `frontend/package.json`
- Delete: `frontend/src/App.css`, `frontend/src/index.css` (content moves into `styles/`)

**Interfaces:**
- Produces: CSS custom properties (`--color-*`, `--font-body`, `--space-*`, `--text-*`, `--radius-*`, `--ease-out`, `--dur-short`) and component classes (`.card`, `.btn-primary`, `.btn-outline`, `.field`, `.field-error`, `.auth-screen`, `.auth-card`, `.app`, `.topbar`, `.sidebar`, `.nav-item`, `.main`, `.page`, `.page-head`, `.summary-grid`, `.stat-card`, `.txn-card`, `.txn-row`, `.cat-badge`, `.amount`, `.account-list`, `.account-card`, `.muted`) consumed by every later task.

- [ ] **Step 1: Add dependencies**

```bash
cd frontend && npm install react-router-dom @tanstack/react-query
```

- [ ] **Step 2: Write `frontend/.env.example`**

```
VITE_API_URL=http://localhost:4000
```

Create `frontend/.env` as a copy (safe to commit-ignore; already covered by the root `.gitignore`).

- [ ] **Step 3: Add the Geist font and write `frontend/src/styles/tokens.css`**

```css
/* Ported from Genkin-Impact.dc.html — monochrome white/black, single-family Geist */
:root {
  --color-paper: oklch(100% 0 0);
  --color-paper-2: oklch(98.4% 0.004 255);
  --color-paper-3: oklch(96.2% 0.007 255);

  --color-rule: oklch(90.5% 0.006 255);
  --color-ink: oklch(19% 0.008 255);
  --color-ink-2: oklch(40% 0.008 255);
  --color-muted: oklch(57% 0.006 255);

  --color-accent: oklch(19% 0.008 255);
  --color-accent-ink: oklch(100% 0 0);

  --color-positive: oklch(47% 0.095 152);
  --color-negative: oklch(45% 0.145 25);
  --color-info: oklch(48% 0.1 258);
  --color-focus: var(--color-accent);

  --font-body: "Geist", ui-sans-serif, system-ui, sans-serif;

  --space-2xs: 0.25rem;
  --space-xs: 0.5rem;
  --space-sm: 0.75rem;
  --space-md: 1rem;
  --space-lg: 1.5rem;
  --space-xl: 2.5rem;
  --space-2xl: 4rem;

  --text-2xs: 0.75rem;
  --text-xs: 0.8125rem;
  --text-sm: 0.875rem;
  --text-base: 0.9375rem;
  --text-md: 1.0625rem;
  --text-lg: 1.25rem;
  --text-xl: 1.5rem;
  --text-figure: clamp(1.375rem, 1vw + 1.1rem, 1.625rem);

  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;

  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --dur-short: 150ms;
}
```

Add the Geist font link to `frontend/index.html`, inside `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet">
```

- [ ] **Step 4: Write `frontend/src/styles/base.css`**

```css
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; overflow-x: clip; }
body {
  background: var(--color-paper);
  color: var(--color-ink);
  font-family: var(--font-body);
}
#root { min-height: 100dvh; }
button, input, select { font-family: inherit; font-size: inherit; }
:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; border-radius: 4px; }

.card {
  background: var(--color-paper-2);
  border: 1px solid var(--color-rule);
  border-radius: var(--radius-lg);
}

.btn-primary {
  background: var(--color-accent);
  color: var(--color-accent-ink);
  border: none;
  border-radius: var(--radius-md);
  padding: 9px 15px;
  font-size: var(--text-xs);
  font-weight: 600;
  cursor: pointer;
  transition: background-color var(--dur-short) var(--ease-out);
}
.btn-primary:hover { background: color-mix(in oklch, var(--color-accent) 88%, black 12%); }
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

.btn-outline {
  background: var(--color-paper-2);
  border: 1px solid var(--color-rule);
  border-radius: var(--radius-md);
  padding: 9px 15px;
  font-size: var(--text-xs);
  font-weight: 600;
  cursor: pointer;
}
.btn-outline:hover { background: var(--color-paper-3); }

.field { display: flex; flex-direction: column; gap: var(--space-2xs); margin-bottom: var(--space-md); font-size: var(--text-sm); }
.field span { font-weight: 600; color: var(--color-ink-2); font-size: var(--text-xs); }
.field input, .field select {
  border: 1px solid var(--color-rule);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  background: var(--color-paper);
  color: var(--color-ink);
}
.field-error { color: var(--color-negative); font-size: var(--text-xs); margin: 0 0 var(--space-md); }

.auth-screen {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-lg);
}
.auth-card {
  width: 100%;
  max-width: 360px;
  background: var(--color-paper-2);
  border: 1px solid var(--color-rule);
  border-radius: var(--radius-lg);
  padding: var(--space-xl);
}
.auth-title { font-size: var(--text-xl); font-weight: 700; margin: 0 0 var(--space-2xs); }
.auth-sub { color: var(--color-ink-2); margin: 0 0 var(--space-lg); font-size: var(--text-sm); }
.auth-switch { margin-top: var(--space-md); font-size: var(--text-sm); color: var(--color-ink-2); }
.auth-switch a { color: var(--color-accent); font-weight: 600; }

.app { min-height: 100dvh; display: flex; flex-direction: column; }
.topbar {
  display: flex; align-items: center; gap: var(--space-sm);
  min-height: 60px; padding: 0 var(--space-md);
  border-bottom: 1px solid var(--color-rule);
  background: var(--color-paper-2);
}
.menu-btn { border: none; background: var(--color-paper-3); border-radius: var(--radius-sm); width: 36px; height: 36px; cursor: pointer; }
.brand { display: flex; align-items: center; gap: var(--space-xs); }
.brand-mark {
  width: 27px; height: 27px; border-radius: var(--radius-sm);
  background: var(--color-accent); color: var(--color-accent-ink);
  display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 15px;
}
.brand-name { font-weight: 600; font-size: 17px; }
.topbar-spacer { flex: 1; }
.cur-btn { background: var(--color-paper-3); border: 1px solid var(--color-rule); border-radius: var(--radius-md); padding: 8px 12px; font-size: var(--text-xs); font-weight: 600; }

.body-row { flex: 1; display: flex; min-height: 0; }
.sidebar {
  width: 220px; flex-shrink: 0; background: var(--color-paper-3);
  border-right: 1px solid var(--color-rule);
}
@media (max-width: 60rem) {
  .sidebar { position: fixed; top: 60px; left: 0; bottom: 0; width: 240px; transform: translateX(-102%); transition: transform var(--dur-short) var(--ease-out); z-index: 50; }
  .sidebar.sidebar--open { transform: translateX(0); }
}
.sidebar-inner { padding: var(--space-md) var(--space-sm); display: flex; flex-direction: column; gap: 4px; }
.nav-item {
  display: block; padding: 9px 12px; border-radius: var(--radius-md);
  font-size: var(--text-sm); font-weight: 500; color: var(--color-ink-2);
  text-decoration: none;
}
.nav-item:hover { background: color-mix(in oklch, var(--color-ink) 5%, transparent); }
.nav-item--active { background: color-mix(in oklch, var(--color-accent) 13%, var(--color-paper-3) 87%); color: var(--color-accent); font-weight: 600; }

.main { flex: 1; min-width: 0; overflow-y: auto; }
.page-loading { padding: var(--space-xl); color: var(--color-ink-2); }

.page-head { display: flex; align-items: center; gap: var(--space-sm); flex-wrap: wrap; padding: var(--space-lg) var(--space-xl) var(--space-xs); }
.page-head h1 { margin: 0; font-size: var(--text-xl); font-weight: 600; }
.count-badge { background: var(--color-rule); border-radius: var(--radius-sm); padding: 2px 9px; font-size: var(--text-2xs); }
.head-spacer { flex: 1; }
.seg { border: 1px solid var(--color-rule); border-radius: var(--radius-md); padding: 6px 10px; background: var(--color-paper-2); font-size: var(--text-xs); }

.summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--space-sm); padding: var(--space-sm) var(--space-xl) var(--space-xs); }
.stat-card { padding: 16px 18px; }
.stat-card__label { font-size: var(--text-xs); font-weight: 600; color: var(--color-ink-2); margin-bottom: var(--space-xs); }
.stat-card__figure { font-size: var(--text-figure); font-weight: 600; }
.stat-card__figure--positive { color: var(--color-positive); }
.stat-card__figure--negative { color: var(--color-negative); }

.account-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--space-sm); padding: 0 var(--space-xl) var(--space-2xl); }
.account-card { padding: var(--space-md); }
.account-card__name { font-weight: 600; }
.account-card__type { color: var(--color-muted); font-size: var(--text-xs); text-transform: capitalize; }
.account-card__balance { font-size: var(--text-figure); font-weight: 600; margin-top: var(--space-xs); }

.txn-card { padding: 5px; }
.txn-row { display: flex; align-items: flex-start; gap: 13px; padding: 13px; border-radius: var(--radius-md); }
.txn-row:hover { background: color-mix(in oklch, var(--color-ink) 4%, transparent); }
.cat-badge {
  width: 38px; height: 38px; border-radius: var(--radius-md); flex-shrink: 0;
  background: var(--color-paper-3); color: var(--color-ink-2);
  display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 15px;
}
.txn-row__body { flex: 1; min-width: 0; }
.txn-row__top { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.txn-row__cat { font-weight: 600; }
.txn-row__time { font-size: var(--text-2xs); color: var(--color-muted); }
.txn-row__note { font-size: var(--text-2xs); color: var(--color-ink-2); margin-top: 3px; }
.amount { margin-left: auto; font-weight: 600; }
.amount--neg { color: var(--color-negative); }
.amount--pos { color: var(--color-positive); }

.muted { color: var(--color-muted); padding: var(--space-md); }
```

- [ ] **Step 5: Delete the stock CRA/Vite CSS and update imports**

```bash
rm frontend/src/App.css frontend/src/index.css
```

(References are updated when `main.tsx` is rewritten in Task 3.)

- [ ] **Step 6: Commit**

```bash
git add frontend/.env.example frontend/src/styles frontend/index.html frontend/package.json frontend/package-lock.json
git rm frontend/src/App.css frontend/src/index.css
git commit -m "feat: design tokens + base CSS ported from Genkin-Impact.dc.html, router/query deps"
```

---

### Task 2: API client, amount formatter, query client

**Files:**
- Create: `frontend/src/lib/api.ts`
- Create: `frontend/src/lib/formatAmount.ts`
- Create: `frontend/src/lib/queryClient.ts`

**Interfaces:**
- Produces: `api.get<T>(path)`, `api.post<T>(path, data?)`, `api.patch<T>(path, data?)` and `ApiError` class from `api.ts`. `formatAmount(minorUnitsString: string, currencyCode: string): string` from `formatAmount.ts`. `queryClient: QueryClient` from `queryClient.ts`.

- [ ] **Step 1: Write `frontend/src/lib/api.ts`**

```ts
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.code ?? "unknown_error", body?.error?.message ?? "Something went wrong.");
  }

  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) => request<T>(path, { method: "POST", body: data ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(data) }),
};
```

- [ ] **Step 2: Write `frontend/src/lib/formatAmount.ts`**

```ts
// Mirrors backend/migrations/0001_currencies_users_sessions.sql's seeded decimal_digits.
// A later slice can fetch this from GET /currencies instead of hardcoding it here.
const DECIMAL_DIGITS: Record<string, number> = { CNY: 2, USD: 2, EUR: 2, JPY: 0, GBP: 2, HKD: 2 };

export function formatAmount(minorUnits: string, currencyCode: string): string {
  const digits = DECIMAL_DIGITS[currencyCode] ?? 2;
  const value = Number(minorUnits) / 10 ** digits;
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
```

- [ ] **Step 3: Write `frontend/src/lib/queryClient.ts`**

```ts
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 30_000 },
  },
});
```

- [ ] **Step 4: Verify the files compile**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no type errors. (Real functional verification of `api.ts` happens end-to-end in Task 4's manual login test, once a page exists to call it.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib
git commit -m "feat: API client, amount formatter, TanStack query client"
```

---

### Task 3: Auth hooks + router skeleton + guards

**Files:**
- Create: `frontend/src/hooks/useAuth.ts`
- Create: `frontend/src/routes/RequireAuth.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/main.tsx`

**Interfaces:**
- Consumes: `api`, `ApiError` (Task 2), `queryClient` (Task 2).
- Produces: `User` type, `useCurrentUser()`, `useLogin()`, `useRegister()`, `useLogout()` from `useAuth.ts`. `RequireAuth` and `RequireOnboarded` wrapper components from `RequireAuth.tsx`.

- [ ] **Step 1: Write `frontend/src/hooks/useAuth.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

export interface User {
  id: string;
  email: string;
  display_name: string;
  main_currency_code: string | null;
  onboarded_at: string | null;
  accent_color: string;
  show_cents: boolean;
  color_convention: string;
}

export function useCurrentUser() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<{ user: User }>("/auth/me").then((r) => r.user),
    retry: false,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string }) => api.post<{ user: User }>("/auth/login", input),
    onSuccess: (data) => qc.setQueryData(["me"], data.user),
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string; display_name: string }) =>
      api.post<{ user: User }>("/auth/register", input),
    onSuccess: (data) => qc.setQueryData(["me"], data.user),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/auth/logout"),
    onSuccess: () => qc.setQueryData(["me"], null),
  });
}
```

- [ ] **Step 2: Write `frontend/src/routes/RequireAuth.tsx`**

```tsx
import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useCurrentUser } from "../hooks/useAuth";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: user, isLoading, isError } = useCurrentUser();
  if (isLoading) return <div className="page-loading">Loading…</div>;
  if (isError || !user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function RequireOnboarded({ children }: { children: ReactNode }) {
  const { data: user } = useCurrentUser();
  if (user && !user.onboarded_at) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}
```

- [ ] **Step 3: Rewrite `frontend/src/App.tsx`**

Placeholder routes reference pages built in later tasks — this compiles once Tasks 4–8 add them; for this task, stub `LoginPage`/`RegisterPage`/etc. as minimal exported components so the router compiles, then replace the stubs in later tasks (do not leave the stubs behind — each later task's "Modify" note removes its stub).

```tsx
// frontend/src/App.tsx
import { Routes, Route, Navigate } from "react-router-dom";
import { LoginPage } from "./routes/LoginPage";
import { RegisterPage } from "./routes/RegisterPage";
import { VerifyEmailPage } from "./routes/VerifyEmailPage";
import { OnboardingPage } from "./routes/OnboardingPage";
import { AppShell } from "./layout/AppShell";
import { AssetsPage } from "./routes/AssetsPage";
import { TransactionsPage } from "./routes/TransactionsPage";
import { RequireAuth, RequireOnboarded } from "./routes/RequireAuth";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route
        path="/onboarding"
        element={
          <RequireAuth>
            <OnboardingPage />
          </RequireAuth>
        }
      />
      <Route
        path="/app"
        element={
          <RequireAuth>
            <RequireOnboarded>
              <AppShell />
            </RequireOnboarded>
          </RequireAuth>
        }
      >
        <Route path="transactions" element={<TransactionsPage />} />
        <Route path="assets" element={<AssetsPage />} />
        <Route index element={<Navigate to="transactions" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/app/transactions" replace />} />
    </Routes>
  );
}
```

This task creates minimal stub files so the above compiles — each is replaced in full by its dedicated task below (do not skip the later tasks thinking the stub is "done"):

```tsx
// frontend/src/routes/LoginPage.tsx (stub — replaced in Task 4)
export function LoginPage() { return <div>Login stub</div>; }
```
```tsx
// frontend/src/routes/RegisterPage.tsx (stub — replaced in Task 4)
export function RegisterPage() { return <div>Register stub</div>; }
```
```tsx
// frontend/src/routes/VerifyEmailPage.tsx (stub — replaced in Task 8)
export function VerifyEmailPage() { return <div>Verify stub</div>; }
```
```tsx
// frontend/src/routes/OnboardingPage.tsx (stub — replaced in Task 5)
export function OnboardingPage() { return <div>Onboarding stub</div>; }
```
```tsx
// frontend/src/layout/AppShell.tsx (stub — replaced in Task 6)
import { Outlet } from "react-router-dom";
export function AppShell() { return <Outlet />; }
```
```tsx
// frontend/src/routes/AssetsPage.tsx (stub — replaced in Task 7)
export function AssetsPage() { return <div>Assets stub</div>; }
```
```tsx
// frontend/src/routes/TransactionsPage.tsx (stub — replaced in Task 8)
export function TransactionsPage() { return <div>Transactions stub</div>; }
```

- [ ] **Step 4: Rewrite `frontend/src/main.tsx`**

```tsx
// frontend/src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { queryClient } from "./lib/queryClient";
import { App } from "./App";
import "./styles/tokens.css";
import "./styles/base.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
```

- [ ] **Step 5: Verify the app boots**

```bash
cd frontend && npm run dev &
sleep 2
curl -s http://localhost:5173 | grep -q "root" && echo "OK"
kill %1
```
Expected: `OK`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks frontend/src/routes/RequireAuth.tsx frontend/src/App.tsx frontend/src/main.tsx frontend/src/layout frontend/src/routes/*.tsx
git commit -m "feat: auth hooks, router skeleton with auth/onboarding guards, page stubs"
```

---

### Task 4: Login + Register pages

**Files:**
- Modify: `frontend/src/routes/LoginPage.tsx` (replace stub)
- Modify: `frontend/src/routes/RegisterPage.tsx` (replace stub)

**Interfaces:**
- Consumes: `useLogin`, `useRegister` (Task 3), `ApiError` (Task 2).

- [ ] **Step 1: Write `frontend/src/routes/LoginPage.tsx`**

```tsx
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLogin } from "../hooks/useAuth";
import { ApiError } from "../lib/api";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const login = useLogin();
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login.mutateAsync({ email, password });
      navigate("/app/transactions");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={onSubmit}>
        <h1 className="auth-title">Genkin-Impact</h1>
        <p className="auth-sub">Sign in to your ledger.</p>
        <label className="field">
          <span>Email</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="field-error">{error}</p>}
        <button className="btn-primary" type="submit" disabled={login.isPending}>
          {login.isPending ? "Signing in…" : "Sign in"}
        </button>
        <p className="auth-switch">
          No account? <Link to="/register">Register</Link>
        </p>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Write `frontend/src/routes/RegisterPage.tsx`**

```tsx
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useRegister } from "../hooks/useAuth";
import { ApiError } from "../lib/api";

export function RegisterPage() {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const register = useRegister();
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await register.mutateAsync({ email, password, display_name: displayName });
      navigate("/onboarding");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={onSubmit}>
        <h1 className="auth-title">Genkin-Impact</h1>
        <p className="auth-sub">Create your ledger.</p>
        <label className="field">
          <span>Name</span>
          <input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <label className="field">
          <span>Email</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="field-error">{error}</p>}
        <button className="btn-primary" type="submit" disabled={register.isPending}>
          {register.isPending ? "Creating account…" : "Create account"}
        </button>
        <p className="auth-switch">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Manual end-to-end verification (backend must be running per the backend plan)**

```bash
docker compose up -d postgres
cd backend && npm run migrate && npm run dev &
cd frontend && npm run dev &
sleep 2
```
Open `http://localhost:5173/register` in a browser, fill the form, submit. Expected: redirected to `/onboarding` (the stub page). Then open dev tools → Application → Cookies and confirm `access_token` and `refresh_token` are set as httpOnly cookies on `localhost:4000`.

```bash
kill %1 %2
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/routes/LoginPage.tsx frontend/src/routes/RegisterPage.tsx
git commit -m "feat: login and register pages"
```

---

### Task 5: Onboarding page + shared AddAccountForm

**Files:**
- Create: `frontend/src/components/AddAccountForm.tsx`
- Modify: `frontend/src/routes/OnboardingPage.tsx` (replace stub)

**Interfaces:**
- Consumes: `api`, `ApiError` (Task 2).
- Produces: `AddAccountForm({ onCreated: () => void })` — reused as-is by the Assets page in Task 7, matching §5's "adding further accounts later reuses steps 2–3 as a modal — same handler" note.

- [ ] **Step 1: Write `frontend/src/components/AddAccountForm.tsx`**

```tsx
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";

interface Currency {
  code: string;
  name: string;
}

const ACCOUNT_TYPES = [
  { value: "cash", label: "Cash" },
  { value: "bank", label: "Bank" },
  { value: "credit_card", label: "Credit card" },
  { value: "e_wallet", label: "E-wallet" },
  { value: "investment", label: "Investment" },
  { value: "liability", label: "Liability" },
];

export function AddAccountForm({ onCreated }: { onCreated: () => void }) {
  const { data: currencies } = useQuery({
    queryKey: ["currencies"],
    queryFn: () => api.get<{ currencies: Currency[] }>("/currencies").then((r) => r.currencies),
  });
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [type, setType] = useState("bank");
  const [currencyCode, setCurrencyCode] = useState("USD");
  const [openingBalance, setOpeningBalance] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createAccount = useMutation({
    mutationFn: () => api.post("/accounts", { name, type, currency_code: currencyCode, opening_balance: openingBalance || "0" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["me"] });
      onCreated();
    },
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createAccount.mutateAsync();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  return (
    <form className="account-form" onSubmit={onSubmit}>
      <label className="field">
        <span>Account name</span>
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Checking" />
      </label>
      <label className="field">
        <span>Type</span>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {ACCOUNT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Currency</span>
        <select value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)}>
          {(currencies ?? []).map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Current balance</span>
        <input required inputMode="decimal" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} placeholder="0.00" />
      </label>
      {error && <p className="field-error">{error}</p>}
      <button className="btn-primary" type="submit" disabled={createAccount.isPending}>
        {createAccount.isPending ? "Saving…" : "Save account"}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Write `frontend/src/routes/OnboardingPage.tsx`**

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { AddAccountForm } from "../components/AddAccountForm";

interface Currency {
  code: string;
  name: string;
}

export function OnboardingPage() {
  const [step, setStep] = useState<1 | 2>(1);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: currencies } = useQuery({
    queryKey: ["currencies"],
    queryFn: () => api.get<{ currencies: Currency[] }>("/currencies").then((r) => r.currencies),
  });

  const [mainCurrency, setMainCurrency] = useState("USD");
  const setCurrency = useMutation({
    mutationFn: () => api.patch("/users/me", { main_currency_code: mainCurrency }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      setStep(2);
    },
  });

  async function onPickCurrency() {
    setError(null);
    try {
      await setCurrency.mutateAsync();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-title">Genkin-Impact</h1>
        {step === 1 && (
          <>
            <p className="auth-sub">Step 1 of 2 — pick your main currency.</p>
            <label className="field">
              <span>Main currency</span>
              <select value={mainCurrency} onChange={(e) => setMainCurrency(e.target.value)}>
                {(currencies ?? []).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </label>
            {error && <p className="field-error">{error}</p>}
            <button className="btn-primary" onClick={onPickCurrency} disabled={setCurrency.isPending}>
              {setCurrency.isPending ? "Saving…" : "Continue"}
            </button>
          </>
        )}
        {step === 2 && (
          <>
            <p className="auth-sub">Step 2 of 2 — add your first account.</p>
            <AddAccountForm onCreated={() => navigate("/app/transactions")} />
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Manual end-to-end verification**

Continue from Task 4's register flow (or register a fresh user). Expected: land on Step 1, pick a currency, click Continue, land on Step 2, fill the account form, submit, and land on `/app/transactions` (the stub page). Confirm via the Network tab that `PATCH /users/me` and `POST /accounts` both returned `200`/`201`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/AddAccountForm.tsx frontend/src/routes/OnboardingPage.tsx
git commit -m "feat: onboarding flow (currency + first account) and shared AddAccountForm"
```

---

### Task 6: App shell (topbar + sidebar)

**Files:**
- Modify: `frontend/src/layout/AppShell.tsx` (replace stub)

**Interfaces:**
- Consumes: `useCurrentUser`, `useLogout` (Task 3).

- [ ] **Step 1: Write `frontend/src/layout/AppShell.tsx`**

```tsx
import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useCurrentUser, useLogout } from "../hooks/useAuth";

export function AppShell() {
  const { data: user } = useCurrentUser();
  const logout = useLogout();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="app" style={{ ["--color-accent" as string]: user?.accent_color || undefined }}>
      <div className="topbar">
        <button className="menu-btn" type="button" aria-label="Toggle menu" onClick={() => setDrawerOpen((v) => !v)}>
          ☰
        </button>
        <div className="brand">
          <div className="brand-mark">G</div>
          <span className="brand-name">Genkin-Impact</span>
        </div>
        <div className="topbar-spacer" />
        {user?.main_currency_code && <span className="cur-btn">{user.main_currency_code}</span>}
        <button className="btn-outline" type="button" onClick={() => logout.mutate()}>
          Log out
        </button>
      </div>
      <div className="body-row">
        <aside className={`sidebar${drawerOpen ? " sidebar--open" : ""}`}>
          <div className="sidebar-inner">
            <NavLink to="/app/transactions" className={({ isActive }) => `nav-item${isActive ? " nav-item--active" : ""}`}>
              Transactions
            </NavLink>
            <NavLink to="/app/assets" className={({ isActive }) => `nav-item${isActive ? " nav-item--active" : ""}`}>
              Assets
            </NavLink>
          </div>
        </aside>
        <main className="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
```

Note: `user.accent_color` (a hex string from the DB, defaulting to `#17181b`) drives `--color-accent` per-user, same mechanism as the `.dc.html` prototype's `accent` prop — just sourced from the real `users.accent_color` column instead of a design-tool prop editor.

- [ ] **Step 2: Manual verification**

With a logged-in, onboarded user, navigate to `/app/transactions` and `/app/assets`. Expected: sidebar highlights the active link, topbar shows the main currency code and a working "Log out" button that redirects to `/login` (via `RequireAuth` once `me` becomes `null`).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/layout/AppShell.tsx
git commit -m "feat: app shell - topbar, sidebar, per-user accent color"
```

---

### Task 7: Assets (accounts) page

**Files:**
- Modify: `frontend/src/routes/AssetsPage.tsx` (replace stub)

**Interfaces:**
- Consumes: `api` (Task 2 — `GET /accounts` already returns a server-formatted `balance_display`, so this page uses that field directly), `AddAccountForm` (Task 5).

- [ ] **Step 1: Write `frontend/src/routes/AssetsPage.tsx`**

```tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { AddAccountForm } from "../components/AddAccountForm";

interface Account {
  id: string;
  name: string;
  type: string;
  currency_code: string;
  balance_display: string;
}

export function AssetsPage() {
  const [showForm, setShowForm] = useState(false);
  const { data: accounts, isLoading } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get<{ accounts: Account[] }>("/accounts").then((r) => r.accounts),
  });

  return (
    <div className="page">
      <div className="page-head">
        <h1>Assets</h1>
        <div className="head-spacer" />
        <button className="btn-primary" type="button" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ Add account"}
        </button>
      </div>
      {showForm && (
        <div className="card" style={{ margin: "0 var(--space-xl) var(--space-lg)", padding: "var(--space-lg)" }}>
          <AddAccountForm onCreated={() => setShowForm(false)} />
        </div>
      )}
      <div className="account-list">
        {isLoading && <p className="muted">Loading…</p>}
        {accounts?.map((a) => (
          <div className="card account-card" key={a.id}>
            <div className="account-card__name">{a.name}</div>
            <div className="account-card__type">{a.type.replace("_", " ")}</div>
            <div className="account-card__balance">{a.balance_display}</div>
          </div>
        ))}
        {accounts?.length === 0 && <p className="muted">No accounts yet.</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Manual verification**

Navigate to `/app/assets`. Expected: the account created during onboarding is listed with its correct balance. Click "+ Add account", submit a second account, confirm it appears without a page reload (TanStack Query's `invalidateQueries(['accounts'])` from `AddAccountForm` refetches automatically).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/routes/AssetsPage.tsx
git commit -m "feat: assets page - account list + add-account modal"
```

---

### Task 8: Transactions page, AddTransactionForm, verify-email page, final smoke test

**Files:**
- Create: `frontend/src/components/AddTransactionForm.tsx`
- Modify: `frontend/src/routes/TransactionsPage.tsx` (replace stub)
- Modify: `frontend/src/routes/VerifyEmailPage.tsx` (replace stub)

**Interfaces:**
- Consumes: `api`, `ApiError`, `formatAmount` (Task 2).

- [ ] **Step 1: Write `frontend/src/components/AddTransactionForm.tsx`**

```tsx
import { useState, useEffect, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";

interface Account {
  id: string;
  name: string;
}
interface Category {
  id: string;
  name: string;
  kind: "expense" | "income";
}

export function AddTransactionForm({ onCreated }: { onCreated: () => void }) {
  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get<{ accounts: Account[] }>("/accounts").then((r) => r.accounts),
  });

  const [type, setType] = useState<"expense" | "income" | "transfer">("expense");

  const { data: categories } = useQuery({
    queryKey: ["categories", type],
    queryFn: () => api.get<{ categories: Category[] }>(`/categories?kind=${type}`).then((r) => r.categories),
    enabled: type !== "transfer",
  });

  const [accountId, setAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    setCategoryId("");
  }, [type]);

  const createTxn = useMutation({
    mutationFn: () => {
      const body =
        type === "transfer"
          ? { type, account_id: accountId, to_account_id: toAccountId, amount, occurred_at: new Date().toISOString(), note: note || undefined }
          : { type, account_id: accountId, category_id: categoryId, amount, occurred_at: new Date().toISOString(), note: note || undefined };
      return api.post("/transactions", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      onCreated();
    },
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createTxn.mutateAsync();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  return (
    <form className="txn-form" onSubmit={onSubmit}>
      <label className="field">
        <span>Type</span>
        <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          <option value="expense">Expense</option>
          <option value="income">Income</option>
          <option value="transfer">Transfer</option>
        </select>
      </label>
      <label className="field">
        <span>From account</span>
        <select required value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="" disabled>
            Select an account
          </option>
          {(accounts ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      {type === "transfer" ? (
        <label className="field">
          <span>To account</span>
          <select required value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
            <option value="" disabled>
              Select an account
            </option>
            {(accounts ?? []).filter((a) => a.id !== accountId).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label className="field">
          <span>Category</span>
          <select required value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="" disabled>
              Select a category
            </option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span>Amount</span>
        <input required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
      </label>
      <label className="field">
        <span>Note</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
      </label>
      {error && <p className="field-error">{error}</p>}
      <button className="btn-primary" type="submit" disabled={createTxn.isPending}>
        {createTxn.isPending ? "Saving…" : "Save transaction"}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Write `frontend/src/routes/TransactionsPage.tsx`**

```tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatAmount } from "../lib/formatAmount";
import { AddTransactionForm } from "../components/AddTransactionForm";

interface Summary {
  income_minor: string;
  expenditure_minor: string;
  balance_minor: string;
  count: number;
  main_currency_code: string;
}

interface TxnItem {
  id: string;
  type: string;
  amount: string;
  currency_code: string;
  occurred_at: string;
  note: string | null;
  category_name: string | null;
  account_name: string;
}

export function TransactionsPage() {
  const [showForm, setShowForm] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("");

  const { data: summary } = useQuery({
    queryKey: ["transactions", "summary"],
    queryFn: () => api.get<{ summary: Summary }>("/transactions/summary").then((r) => r.summary),
  });

  const { data: items, isLoading } = useQuery({
    queryKey: ["transactions", "list", typeFilter],
    queryFn: () => api.get<{ items: TxnItem[] }>(`/transactions${typeFilter ? `?type=${typeFilter}` : ""}`).then((r) => r.items),
  });

  return (
    <div className="page">
      <div className="page-head">
        <h1>Transactions</h1>
        <span className="count-badge">{summary?.count ?? 0}</span>
        <div className="head-spacer" />
        <select className="seg" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          <option value="expense">Expenses</option>
          <option value="income">Income</option>
          <option value="transfer">Transfers</option>
        </select>
        <button className="btn-primary" type="button" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ New"}
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ margin: "0 var(--space-xl) var(--space-lg)", padding: "var(--space-lg)" }}>
          <AddTransactionForm onCreated={() => setShowForm(false)} />
        </div>
      )}

      {summary && (
        <div className="summary-grid">
          <div className="card stat-card">
            <div className="stat-card__label">Income</div>
            <div className="stat-card__figure stat-card__figure--positive">
              {summary.main_currency_code} {formatAmount(summary.income_minor, summary.main_currency_code)}
            </div>
          </div>
          <div className="card stat-card">
            <div className="stat-card__label">Expenditure</div>
            <div className="stat-card__figure stat-card__figure--negative">
              {summary.main_currency_code} {formatAmount(summary.expenditure_minor, summary.main_currency_code)}
            </div>
          </div>
          <div className="card stat-card">
            <div className="stat-card__label">Balance</div>
            <div className="stat-card__figure">
              {summary.main_currency_code} {formatAmount(summary.balance_minor, summary.main_currency_code)}
            </div>
          </div>
          <div className="card stat-card">
            <div className="stat-card__label">Transactions</div>
            <div className="stat-card__figure">{summary.count}</div>
          </div>
        </div>
      )}

      <div className="card txn-card" style={{ margin: "0 var(--space-xl) var(--space-2xl)" }}>
        {isLoading && <p className="muted">Loading…</p>}
        {items?.map((t) => (
          <div className="txn-row" key={t.id}>
            <span className="cat-badge">{(t.category_name ?? t.account_name).charAt(0).toUpperCase()}</span>
            <div className="txn-row__body">
              <div className="txn-row__top">
                <span className="txn-row__cat">{t.category_name ?? "Transfer"}</span>
                <span className="txn-row__time">{new Date(t.occurred_at).toLocaleString()}</span>
              </div>
              {t.note && <div className="txn-row__note">{t.note}</div>}
            </div>
            <span className={`amount amount--${t.type === "expense" ? "neg" : "pos"}`}>
              {t.type === "expense" ? "-" : "+"}
              {formatAmount(t.amount, t.currency_code)}
            </span>
          </div>
        ))}
        {items?.length === 0 && <p className="muted">No transactions yet.</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write `frontend/src/routes/VerifyEmailPage.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { api } from "../lib/api";

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState<"checking" | "ok" | "error">("checking");

  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      setStatus("error");
      return;
    }
    api
      .post("/auth/verify", { token })
      .then(() => setStatus("ok"))
      .catch(() => setStatus("error"));
  }, [params]);

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-title">Genkin-Impact</h1>
        {status === "checking" && <p>Verifying…</p>}
        {status === "ok" && <p>Your email is verified.</p>}
        {status === "error" && <p>This verification link is invalid or expired.</p>}
        <p className="auth-switch">
          <Link to="/login">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Full end-to-end smoke test**

```bash
docker compose up -d postgres
cd backend && npm run migrate && npm run dev &
cd frontend && npm run dev &
sleep 2
```

In a browser: register a new user → onboarding step 1 (pick USD) → step 2 (create "Checking" account, balance 1000.00) → lands on `/app/transactions`. Click "+ New", create an expense (Delivery, 25.00). Expected: the summary cards update (Expenditure shows 25.00), the transaction appears in the list, and `/app/assets` shows the account balance reduced to 975.00. Check the inbox for the pasted Gmail address for the verification email, click its link, land on `/verify-email`, see "Your email is verified."

```bash
kill %1 %2
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AddTransactionForm.tsx frontend/src/routes/TransactionsPage.tsx frontend/src/routes/VerifyEmailPage.tsx
git commit -m "feat: transactions page (list/summary/filter/create), verify-email page"
```

---

## Self-Review Notes

- **Spec coverage:** §5 onboarding UI (Task 5), §7 IA — Assets/Transactions nav + sidebar (Task 6), Transactions list/filters (Task 8), Assets list (Task 7). Deferred per the backend plan's own scope cut (agreed during grilling): Analytics, Plans, right-side Report panel, tag/member filtering, Saved Filters — none of these have frontend tasks, matching the backend having no routes for them.
- **Placeholder scan:** every step has real, runnable code. The Task 3 "stub" components are an explicit, temporary compile-bridge (each is named as the exact task that replaces it, and no task is allowed to be skipped while its stub remains) — not an unresolved placeholder.
- **Type consistency:** `AddAccountForm({ onCreated })` signature matches its two call sites (Task 5's `OnboardingPage`, Task 7's `AssetsPage`). `AddTransactionForm({ onCreated })` matches its Task 8 call site. `formatAmount(minorUnits, currencyCode)` signature matches across Task 2's definition and Task 8's call sites. `User` type fields (`main_currency_code`, `onboarded_at`, `accent_color`) match the backend's `toPublicUser()` output shape from the backend plan's Task 12.
