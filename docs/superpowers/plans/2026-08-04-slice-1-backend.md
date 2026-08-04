# Slice 1 Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend API for slice 1 of Genkin-Impact — register, login, onboarding (main currency + first account), account listing, and core transaction CRUD (expense/income/transfer) with correct balance derivation — as a working, curl/Vitest-testable Express + vanilla PostgreSQL API with no frontend dependency.

**Architecture:** Express 5 + TypeScript backend talking to PostgreSQL via the raw `pg` driver (no ORM). Hand-rolled numbered SQL migrations applied by a small runner script. Auth is JWT access token (15 min, stateless) + rotating opaque refresh token (hashed, stored in `sessions`, matches the data model exactly), both delivered as httpOnly cookies. All money is `bigint` minor units. Business logic (money formatting, balance derivation, FX conversion) lives in pure/near-pure lib functions with Vitest unit tests; routes are thin and covered by supertest integration tests against a real local Postgres.

**Tech Stack:** Express 5, TypeScript, `pg`, `argon2`, `jsonwebtoken`, `zod`, `nodemailer`, `cookie-parser`, `cors`, `dotenv`, `uuid` (for `uuidv7`), Vitest, `supertest`, `tsx` (dev runner).

## Global Constraints

- Source of truth for schema/behavior is `genkin-impact-data-model.md` at the repo root. Where the redesigned `Genkin-Impact.dc.html` disagrees with it, the data model wins (already reconciled during grilling: no `Scenes` sidebar section, currencies come from the DB not hardcoded).
- Money is always `bigint` minor units server-side. Never floats for stored amounts. `transactions.amount` is always positive; direction comes from `transactions.type`.
- Every user-owned table query is scoped by `user_id` — no exceptions, every route handler filters by the authenticated user's id.
- Soft delete (`deleted_at`) on `transactions`, `accounts`, `categories`, `tags`. All list/lookup queries filter `deleted_at IS NULL`.
- Slice-1 scope only: no Budgets, Savings Goals, Recurring Rules, Analytics, Saved Filters, refunds, or installments in this plan. Transaction filtering is `type` + date range only (no tags/members filtering yet).
- Live FX rates (§8 "fetch daily via a scheduled job") are out of scope for slice 1. Rates are seeded statically via migration, keyed off `rate_date = CURRENT_DATE` at migration time, with the fallback-to-most-recent-prior-rate logic still implemented and tested (so the later real job is a drop-in).
- Email verification token storage (`users.email_verification_token_hash`, `users.email_verification_expires_at`) is an addition beyond the ERD — the data model requires "send verification email" as a step but doesn't schema out how the token is stored. This is additive, not a contradiction of the model, and is called out here for transparency.
- All secrets (`DATABASE_URL`, `JWT_SECRET`, `SMTP_*`) come from `backend/.env`, which must be gitignored. Never hardcode secrets in source.

---

## File Structure

```
docker-compose.yml                          # Postgres only, repo root
.gitignore                                  # root — .env, .env.*, node_modules, dist
backend/.env.example
backend/migrations/0001_currencies_users_sessions.sql
backend/migrations/0002_accounts_categories_tags_members.sql
backend/migrations/0003_transactions_exchange_rates.sql
backend/src/env.ts
backend/src/db/pool.ts
backend/src/db/migrate.ts
backend/src/lib/money.ts
backend/src/lib/money.test.ts
backend/src/lib/password.ts
backend/src/lib/password.test.ts
backend/src/lib/tokens.ts
backend/src/lib/tokens.test.ts
backend/src/lib/balances.ts
backend/src/lib/balances.test.ts
backend/src/lib/fx.ts
backend/src/lib/fx.test.ts
backend/src/lib/mailer.ts
backend/src/lib/ids.ts                      # uuidv7 wrapper
backend/src/middleware/auth.ts
backend/src/middleware/errorHandler.ts
backend/src/middleware/validate.ts          # zod request-validation helper
backend/src/routes/auth.ts
backend/src/routes/auth.test.ts
backend/src/routes/users.ts
backend/src/routes/currencies.ts
backend/src/routes/accounts.ts
backend/src/routes/accounts.test.ts
backend/src/routes/transactions.ts
backend/src/routes/transactions.test.ts
backend/src/app.ts
backend/src/server.ts
backend/vitest.config.ts
backend/tsconfig.json                       # add module/moduleResolution if missing
backend/package.json                        # add deps + scripts
```

---

### Task 1: Docker Compose, env scaffolding, migration runner infrastructure

**Files:**
- Create: `docker-compose.yml`
- Create: `.gitignore`
- Create: `backend/.env.example`
- Create: `backend/src/env.ts`
- Create: `backend/src/db/pool.ts`
- Create: `backend/src/db/migrate.ts`
- Create: `backend/src/lib/ids.ts`
- Modify: `backend/package.json`
- Modify: `backend/tsconfig.json`

**Interfaces:**
- Produces: `pool` (a `pg.Pool`) from `backend/src/db/pool.ts`. `runMigrations(): Promise<string[]>` from `backend/src/db/migrate.ts`. `env` object from `backend/src/env.ts` with fields `PORT, DATABASE_URL, JWT_SECRET, SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, CONTACT_EMAIL_FROM, APP_ORIGIN, NODE_ENV`. `newId(): string` from `backend/src/lib/ids.ts`.

- [ ] **Step 1: Write `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: genkin
      POSTGRES_PASSWORD: genkin_dev_password
      POSTGRES_DB: genkin_impact
    ports:
      - "5432:5432"
    volumes:
      - genkin_pg_data:/var/lib/postgresql/data

volumes:
  genkin_pg_data:
```

- [ ] **Step 2: Write the root `.gitignore`**

```gitignore
node_modules/
dist/
dist-ssr/
.env
.env.*
!.env.example
*.local
.DS_Store
npm-debug.log*
```

- [ ] **Step 3: Write `backend/.env.example`**

```
PORT=4000
DATABASE_URL=postgres://genkin:genkin_dev_password@localhost:5432/genkin_impact
JWT_SECRET=replace-with-a-long-random-string
APP_ORIGIN=http://localhost:5173
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-address@gmail.com
SMTP_PASS=your-app-password
CONTACT_EMAIL_FROM="Genkin-Impact <your-address@gmail.com>"
NODE_ENV=development
```

Create `backend/.env` as a copy of this with the real values (this file must never be committed — it's covered by the root `.gitignore`).

- [ ] **Step 4: Add dependencies to `backend/package.json`**

Run:
```bash
cd backend && npm install pg argon2 jsonwebtoken zod nodemailer cookie-parser cors dotenv uuid && npm install -D @types/pg @types/jsonwebtoken @types/cookie-parser @types/cors @types/supertest supertest vitest tsx
```

Add scripts to `backend/package.json`:

```json
{
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "migrate": "tsx src/db/migrate.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 5: Ensure `backend/tsconfig.json` supports ESM + Node resolution**

Read the existing file first. It must include (merge in, don't blindly overwrite):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

Add `"type": "module"` to `backend/package.json` if not already present, since we use `NodeNext` + `.js` extension imports in source (TypeScript ESM convention: import compiled-`.js` paths from `.ts` files).

- [ ] **Step 6: Write `backend/src/env.ts`**

```ts
import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

export const env = {
  PORT: Number(process.env.PORT ?? 4000),
  DATABASE_URL: required("DATABASE_URL"),
  JWT_SECRET: required("JWT_SECRET"),
  SMTP_HOST: required("SMTP_HOST"),
  SMTP_PORT: Number(required("SMTP_PORT")),
  SMTP_SECURE: process.env.SMTP_SECURE === "true",
  SMTP_USER: required("SMTP_USER"),
  SMTP_PASS: required("SMTP_PASS"),
  CONTACT_EMAIL_FROM: required("CONTACT_EMAIL_FROM"),
  APP_ORIGIN: process.env.APP_ORIGIN ?? "http://localhost:5173",
  NODE_ENV: process.env.NODE_ENV ?? "development",
};
```

- [ ] **Step 7: Write `backend/src/db/pool.ts`**

```ts
import pg from "pg";
import { env } from "../env.js";

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
```

- [ ] **Step 8: Write `backend/src/lib/ids.ts`**

```ts
import { v7 as uuidv7 } from "uuid";

export function newId(): string {
  return uuidv7();
}
```

- [ ] **Step 9: Write `backend/src/db/migrate.ts`**

```ts
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../migrations");

export async function runMigrations(): Promise<string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const appliedRows = await pool.query("SELECT version FROM schema_migrations");
  const applied = new Set(appliedRows.rows.map((r) => r.version as string));

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const newlyApplied: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
      await client.query("COMMIT");
      newlyApplied.push(file);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }

  return newlyApplied;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  runMigrations()
    .then((applied) => {
      console.log(applied.length ? `Applied: ${applied.join(", ")}` : "No new migrations.");
      return pool.end();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
```

- [ ] **Step 10: Create the (still-empty) `backend/migrations/` directory and verify the runner works against a fresh DB**

```bash
mkdir -p backend/migrations
docker compose up -d postgres
cd backend && npm run migrate
```

Expected: prints `No new migrations.` with no errors — this proves the runner connects, creates `schema_migrations`, and finds zero `.sql` files.

- [ ] **Step 11: Commit**

```bash
git add docker-compose.yml .gitignore backend/.env.example backend/src/env.ts backend/src/db backend/src/lib/ids.ts backend/package.json backend/package-lock.json backend/tsconfig.json backend/migrations
git commit -m "chore: docker postgres, env loading, migration runner infra"
```

---

### Task 2: Migrations — currencies, users, sessions

**Files:**
- Create: `backend/migrations/0001_currencies_users_sessions.sql`
- Test: `backend/src/db/migrate.test.ts`

**Interfaces:**
- Consumes: `runMigrations()` from Task 1.
- Produces: tables `currencies`, `users`, `sessions` in Postgres. Columns match `genkin-impact-data-model.md` §3 exactly, plus the additive `users.email_verification_token_hash` / `users.email_verification_expires_at` noted in Global Constraints.

- [ ] **Step 1: Write the migration SQL**

```sql
CREATE TABLE currencies (
  code CHAR(3) PRIMARY KEY,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  decimal_digits SMALLINT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO currencies (code, name, symbol, decimal_digits) VALUES
  ('CNY', 'Chinese Yuan', '¥', 2),
  ('USD', 'US Dollar', '$', 2),
  ('EUR', 'Euro', '€', 2),
  ('JPY', 'Japanese Yen', '¥', 0),
  ('GBP', 'British Pound', '£', 2),
  ('HKD', 'Hong Kong Dollar', 'HK$', 2);

CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  main_currency_code CHAR(3) REFERENCES currencies(code),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  color_convention TEXT NOT NULL DEFAULT 'western' CHECK (color_convention IN ('western', 'eastern')),
  show_cents BOOLEAN NOT NULL DEFAULT false,
  accent_color TEXT NOT NULL DEFAULT '#17181b',
  email_verified_at TIMESTAMPTZ,
  email_verification_token_hash TEXT,
  email_verification_expires_at TIMESTAMPTZ,
  onboarded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  refresh_token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  ip_address TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sessions_refresh_token_hash_idx ON sessions (refresh_token_hash);
```

- [ ] **Step 2: Write the failing test**

```ts
// backend/src/db/migrate.test.ts
import { describe, it, expect, afterAll } from "vitest";
import { pool } from "./pool.js";
import { runMigrations } from "./migrate.js";

describe("runMigrations", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("creates currencies, users, sessions tables and seeds 6 currencies", async () => {
    await runMigrations();

    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('currencies','users','sessions')`
    );
    expect(tables.rows.map((r) => r.table_name).sort()).toEqual(["currencies", "sessions", "users"]);

    const currencies = await pool.query("SELECT code FROM currencies ORDER BY code");
    expect(currencies.rows.map((r) => r.code)).toEqual(["CNY", "EUR", "GBP", "HKD", "JPY", "USD"]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
docker compose up -d postgres
cd backend && npm test -- migrate.test.ts
```
Expected: FAIL if run before Step 1's SQL file is saved (no such table `currencies`).

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npm test -- migrate.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/0001_currencies_users_sessions.sql backend/src/db/migrate.test.ts
git commit -m "feat: migration 0001 - currencies, users, sessions"
```

---

### Task 3: Migrations — accounts, categories, tags, members

**Files:**
- Create: `backend/migrations/0002_accounts_categories_tags_members.sql`
- Modify: `backend/src/db/migrate.test.ts`

**Interfaces:**
- Produces: tables `accounts`, `categories`, `tags`, `members`.

- [ ] **Step 1: Write the migration SQL**

```sql
CREATE TABLE accounts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('cash', 'bank', 'credit_card', 'e_wallet', 'investment', 'liability')),
  currency_code CHAR(3) NOT NULL REFERENCES currencies(code),
  opening_balance BIGINT NOT NULL,
  cached_balance BIGINT NOT NULL,
  credit_limit BIGINT,
  statement_day SMALLINT,
  icon TEXT,
  color TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  exclude_from_net_worth BOOLEAN NOT NULL DEFAULT false,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX accounts_user_archived_idx ON accounts (user_id, is_archived);

CREATE TABLE categories (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  parent_id UUID REFERENCES categories(id),
  name TEXT NOT NULL,
  emoji TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
  sort_order INT NOT NULL DEFAULT 0,
  is_system BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE tags (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  parent_id UUID REFERENCES tags(id),
  name TEXT NOT NULL,
  color TEXT,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE members (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  initials TEXT NOT NULL,
  color TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ
);
```

- [ ] **Step 2: Extend the migration test**

Add to `backend/src/db/migrate.test.ts`, inside the same `describe` block:

```ts
  it("creates accounts, categories, tags, members tables", async () => {
    await runMigrations();
    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('accounts','categories','tags','members')`
    );
    expect(tables.rows.map((r) => r.table_name).sort()).toEqual(["accounts", "categories", "members", "tags"]);
  });
```

- [ ] **Step 3: Run test to verify it fails, then passes**

```bash
cd backend && npm test -- migrate.test.ts
```
Expected: fails before the SQL file exists, passes after.

- [ ] **Step 4: Commit**

```bash
git add backend/migrations/0002_accounts_categories_tags_members.sql backend/src/db/migrate.test.ts
git commit -m "feat: migration 0002 - accounts, categories, tags, members"
```

---

### Task 4: Migrations — transactions, transaction_tags, exchange_rates (+ seed)

**Files:**
- Create: `backend/migrations/0003_transactions_exchange_rates.sql`
- Modify: `backend/src/db/migrate.test.ts`

**Interfaces:**
- Produces: tables `transactions`, `transaction_tags`, `exchange_rates`, seeded with rates for the day the migration runs (base `USD`).

- [ ] **Step 1: Write the migration SQL**

```sql
CREATE TABLE transactions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('expense', 'income', 'transfer')),
  account_id UUID NOT NULL REFERENCES accounts(id),
  to_account_id UUID REFERENCES accounts(id),
  category_id UUID REFERENCES categories(id),
  member_id UUID REFERENCES members(id),
  amount BIGINT NOT NULL CHECK (amount > 0),
  currency_code CHAR(3) NOT NULL REFERENCES currencies(code),
  to_amount BIGINT,
  occurred_at TIMESTAMPTZ NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'cleared' CHECK (status IN ('cleared', 'pending')),
  refund_of_id UUID REFERENCES transactions(id),
  installment_plan_id UUID,
  installment_seq INT,
  recurring_rule_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX transactions_user_occurred_idx ON transactions (user_id, occurred_at DESC);
CREATE INDEX transactions_user_type_occurred_idx ON transactions (user_id, type, occurred_at DESC);
CREATE INDEX transactions_account_occurred_idx ON transactions (account_id, occurred_at);
CREATE INDEX transactions_user_category_occurred_idx ON transactions (user_id, category_id, occurred_at);
CREATE INDEX transactions_not_deleted_idx ON transactions (user_id, occurred_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE transaction_tags (
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  tag_id UUID NOT NULL REFERENCES tags(id),
  PRIMARY KEY (transaction_id, tag_id)
);

CREATE INDEX transaction_tags_tag_idx ON transaction_tags (tag_id, transaction_id);

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE exchange_rates (
  id UUID PRIMARY KEY,
  base_code CHAR(3) NOT NULL REFERENCES currencies(code),
  quote_code CHAR(3) NOT NULL REFERENCES currencies(code),
  rate_date DATE NOT NULL,
  rate NUMERIC(20, 10) NOT NULL,
  source TEXT NOT NULL DEFAULT 'seed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (base_code, quote_code, rate_date)
);

-- Seed static USD-base rates for "today" so slice-1 environments always have a rate.
-- Approximate market values; a later slice replaces this with the scheduled live-fetch job (§8/§9 deferred).
INSERT INTO exchange_rates (id, base_code, quote_code, rate_date, rate, source) VALUES
  (gen_random_uuid(), 'USD', 'USD', CURRENT_DATE, 1.0, 'seed'),
  (gen_random_uuid(), 'USD', 'CNY', CURRENT_DATE, 7.15, 'seed'),
  (gen_random_uuid(), 'USD', 'EUR', CURRENT_DATE, 0.92, 'seed'),
  (gen_random_uuid(), 'USD', 'JPY', CURRENT_DATE, 149.5, 'seed'),
  (gen_random_uuid(), 'USD', 'GBP', CURRENT_DATE, 0.78, 'seed'),
  (gen_random_uuid(), 'USD', 'HKD', CURRENT_DATE, 7.82, 'seed');
```

Note: `installment_plan_id` and `recurring_rule_id` are left as bare `UUID` columns (no FK) since `installment_plans` and `recurring_rules` tables are deferred past slice 1 — this matches the data model's own columns but without the FK constraint until those tables exist.

- [ ] **Step 2: Extend the migration test**

Append to `backend/src/db/migrate.test.ts`:

```ts
  it("creates transactions, transaction_tags, exchange_rates and seeds today's USD rates", async () => {
    await runMigrations();
    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('transactions','transaction_tags','exchange_rates')`
    );
    expect(tables.rows.map((r) => r.table_name).sort()).toEqual(["exchange_rates", "transaction_tags", "transactions"]);

    const rates = await pool.query(
      `SELECT quote_code FROM exchange_rates WHERE base_code='USD' AND rate_date = CURRENT_DATE ORDER BY quote_code`
    );
    expect(rates.rows.map((r) => r.quote_code)).toEqual(["CNY", "EUR", "GBP", "HKD", "JPY", "USD"]);
  });
```

- [ ] **Step 3: Run test to verify it fails, then passes**

```bash
cd backend && npm test -- migrate.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add backend/migrations/0003_transactions_exchange_rates.sql backend/src/db/migrate.test.ts
git commit -m "feat: migration 0003 - transactions, transaction_tags, exchange_rates seed"
```

---

### Task 5: Money lib — minor-units formatting and parsing

**Files:**
- Create: `backend/src/lib/money.ts`
- Test: `backend/src/lib/money.test.ts`

**Interfaces:**
- Produces: `formatMinor(amountMinor: bigint, decimalDigits: number, symbol: string): string`, `parseToMinor(input: string, decimalDigits: number): bigint`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/lib/money.test.ts
import { describe, it, expect } from "vitest";
import { formatMinor, parseToMinor } from "./money.js";

describe("formatMinor", () => {
  it("formats 2-decimal currencies", () => {
    expect(formatMinor(6800n, 2, "¥")).toBe("¥68.00");
    expect(formatMinor(123456n, 2, "$")).toBe("$1,234.56");
  });

  it("formats 0-decimal currencies (JPY)", () => {
    expect(formatMinor(15000n, 0, "¥")).toBe("¥15,000");
  });

  it("formats negative amounts with a leading minus before the symbol", () => {
    expect(formatMinor(-6800n, 2, "¥")).toBe("-¥68.00");
  });
});

describe("parseToMinor", () => {
  it("parses whole numbers", () => {
    expect(parseToMinor("68", 2)).toBe(6800n);
  });

  it("parses decimals and pads short fractions", () => {
    expect(parseToMinor("68.5", 2)).toBe(6850n);
    expect(parseToMinor("68.50", 2)).toBe(6850n);
  });

  it("parses 0-decimal currencies", () => {
    expect(parseToMinor("15000", 0)).toBe(15000n);
  });

  it("rejects non-numeric input", () => {
    expect(() => parseToMinor("abc", 2)).toThrow();
    expect(() => parseToMinor("-5", 2)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npm test -- money.test.ts
```
Expected: FAIL — `money.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// backend/src/lib/money.ts
export function formatMinor(amountMinor: bigint, decimalDigits: number, symbol: string): string {
  const negative = amountMinor < 0n;
  const abs = negative ? -amountMinor : amountMinor;
  const divisor = 10n ** BigInt(decimalDigits);
  const whole = abs / divisor;
  const fraction = abs % divisor;

  const wholeStr = whole.toLocaleString("en-US");
  const fractionStr = decimalDigits > 0 ? "." + fraction.toString().padStart(decimalDigits, "0") : "";

  return (negative ? "-" : "") + symbol + wholeStr + fractionStr;
}

export function parseToMinor(input: string, decimalDigits: number): bigint {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`invalid amount: ${input}`);
  }

  const [wholePart, fracPart = ""] = trimmed.split(".");
  const fracPadded = (fracPart + "0".repeat(decimalDigits)).slice(0, decimalDigits);

  return BigInt(wholePart) * 10n ** BigInt(decimalDigits) + (fracPadded ? BigInt(fracPadded) : 0n);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npm test -- money.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/money.ts backend/src/lib/money.test.ts
git commit -m "feat: money lib - minor-units format/parse with tests"
```

---

### Task 6: Password lib (Argon2id)

**Files:**
- Create: `backend/src/lib/password.ts`
- Test: `backend/src/lib/password.test.ts`

**Interfaces:**
- Produces: `hashPassword(plain: string): Promise<string>`, `verifyPassword(hash: string, plain: string): Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/lib/password.test.ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password hashing", () => {
  it("hashes and verifies a correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).not.toBe("correct horse battery staple");
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword(hash, "wrong password")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npm test -- password.test.ts
```

- [ ] **Step 3: Write the implementation**

```ts
// backend/src/lib/password.ts
import argon2 from "argon2";

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npm test -- password.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/password.ts backend/src/lib/password.test.ts
git commit -m "feat: argon2id password hashing lib with tests"
```

---

### Task 7: Tokens lib — JWT access token + rotating refresh token

**Files:**
- Create: `backend/src/lib/tokens.ts`
- Test: `backend/src/lib/tokens.test.ts`

**Interfaces:**
- Produces: `signAccessToken(userId: string, secret: string): string`, `verifyAccessToken(token: string, secret: string): string` (returns userId, throws on invalid/expired), `generateRefreshToken(): { raw: string; hash: string; expiresAt: Date }`, `hashRefreshToken(raw: string): string`, `ACCESS_TOKEN_TTL_MS: number`, `REFRESH_TOKEN_TTL_MS: number`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/lib/tokens.test.ts
import { describe, it, expect } from "vitest";
import { signAccessToken, verifyAccessToken, generateRefreshToken, hashRefreshToken } from "./tokens.js";

const SECRET = "test-secret";

describe("access tokens", () => {
  it("round-trips a userId", () => {
    const token = signAccessToken("user-123", SECRET);
    expect(verifyAccessToken(token, SECRET)).toBe("user-123");
  });

  it("throws on a token signed with a different secret", () => {
    const token = signAccessToken("user-123", "other-secret");
    expect(() => verifyAccessToken(token, SECRET)).toThrow();
  });

  it("throws on garbage input", () => {
    expect(() => verifyAccessToken("not-a-jwt", SECRET)).toThrow();
  });
});

describe("refresh tokens", () => {
  it("generates a raw token whose hash matches hashRefreshToken(raw)", () => {
    const { raw, hash, expiresAt } = generateRefreshToken();
    expect(raw.length).toBeGreaterThan(20);
    expect(hashRefreshToken(raw)).toBe(hash);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("generates different raw tokens on each call", () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a.raw).not.toBe(b.raw);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npm test -- tokens.test.ts
```

- [ ] **Step 3: Write the implementation**

```ts
// backend/src/lib/tokens.ts
import jwt from "jsonwebtoken";
import { randomBytes, createHash } from "node:crypto";

export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function signAccessToken(userId: string, secret: string): string {
  return jwt.sign({ sub: userId }, secret, { expiresIn: ACCESS_TOKEN_TTL_MS / 1000 });
}

export function verifyAccessToken(token: string, secret: string): string {
  const payload = jwt.verify(token, secret);
  if (typeof payload !== "object" || payload === null || typeof (payload as any).sub !== "string") {
    throw new Error("invalid token payload");
  }
  return (payload as any).sub;
}

export function hashRefreshToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function generateRefreshToken(): { raw: string; hash: string; expiresAt: Date } {
  const raw = randomBytes(32).toString("base64url");
  return {
    raw,
    hash: hashRefreshToken(raw),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npm test -- tokens.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/tokens.ts backend/src/lib/tokens.test.ts
git commit -m "feat: JWT access token + rotating refresh token lib with tests"
```

---

### Task 8: Balances lib — derivation math + DB recompute

**Files:**
- Create: `backend/src/lib/balances.ts`
- Test: `backend/src/lib/balances.test.ts`

**Interfaces:**
- Consumes: `pool` from `backend/src/db/pool.ts` (type only, via `pg.PoolClient`).
- Produces: `computeBalance(inputs: BalanceInputs): bigint` (pure), `recomputeAccountBalance(client: pg.PoolClient, accountId: string): Promise<bigint>` (queries + writes `cached_balance`; exercised indirectly by the transactions route integration test in Task 15, since it needs real transaction rows).

- [ ] **Step 1: Write the failing test (pure function only)**

```ts
// backend/src/lib/balances.test.ts
import { describe, it, expect } from "vitest";
import { computeBalance } from "./balances.js";

describe("computeBalance", () => {
  it("adds opening balance plus income minus expense plus transfers in minus transfers out", () => {
    const result = computeBalance({
      openingBalance: 10000n,
      incomeSum: 5000n,
      expenseSum: 2000n,
      transfersInSum: 1000n,
      transfersOutSum: 500n,
    });
    // 10000 + 5000 - 2000 + 1000 - 500 = 13500
    expect(result).toBe(13500n);
  });

  it("handles an account with no activity", () => {
    const result = computeBalance({
      openingBalance: 10000n,
      incomeSum: 0n,
      expenseSum: 0n,
      transfersInSum: 0n,
      transfersOutSum: 0n,
    });
    expect(result).toBe(10000n);
  });

  it("can go negative (e.g. a liability or overspent credit card)", () => {
    const result = computeBalance({
      openingBalance: 0n,
      incomeSum: 0n,
      expenseSum: 500n,
      transfersInSum: 0n,
      transfersOutSum: 0n,
    });
    expect(result).toBe(-500n);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npm test -- balances.test.ts
```

- [ ] **Step 3: Write the implementation**

```ts
// backend/src/lib/balances.ts
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
```

Note: the `installment_plan_id IS NULL OR installment_seq IS NOT NULL` clause implements §6's "origin excluded from period totals" rule — included now even though installments are deferred, since the column already exists and the exclusion is free to get right from the start.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npm test -- balances.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/balances.ts backend/src/lib/balances.test.ts
git commit -m "feat: balance derivation lib (pure math + DB recompute) with tests"
```

---

### Task 9: FX lib — currency conversion with prior-rate fallback

**Files:**
- Create: `backend/src/lib/fx.ts`
- Test: `backend/src/lib/fx.test.ts`

**Interfaces:**
- Produces: `getRateToUSD(db: Queryable, currency: string, onDate: string): Promise<{ rate: number; approximate: boolean }>`, `convert(db: Queryable, amountMinor: bigint, fromCurrency: string, toCurrency: string, onDate: string, decimalsByCode: Record<string, number>): Promise<{ amountMinor: bigint; approximate: boolean }>`, `Queryable` interface (`{ query: (sql: string, params: unknown[]) => Promise<{ rows: any[] }> }`, satisfied by both `pg.Pool` and a test stub).

- [ ] **Step 1: Write the failing test (using a stub queryable, no real DB needed)**

```ts
// backend/src/lib/fx.test.ts
import { describe, it, expect, vi } from "vitest";
import { getRateToUSD, convert } from "./fx.js";

function stubPool(rows: Record<string, unknown>[]) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

describe("getRateToUSD", () => {
  it("returns rate 1 for USD without querying", async () => {
    const pool = stubPool([]);
    const result = await getRateToUSD(pool, "USD", "2026-08-04");
    expect(result).toEqual({ rate: 1, approximate: false });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("returns the exact rate when one exists for the date", async () => {
    const pool = stubPool([{ rate: "7.15" }]);
    const result = await getRateToUSD(pool, "CNY", "2026-08-04");
    expect(result).toEqual({ rate: 7.15, approximate: false });
  });

  it("falls back to the most recent prior rate and flags it approximate", async () => {
    const pool = { query: vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ rate: "7.10" }] }) };
    const result = await getRateToUSD(pool, "CNY", "2026-08-05");
    expect(result).toEqual({ rate: 7.1, approximate: true });
  });

  it("throws when no rate exists at all", async () => {
    const pool = stubPool([]);
    await expect(getRateToUSD(pool, "CNY", "2020-01-01")).rejects.toThrow();
  });
});

describe("convert", () => {
  const decimalsByCode = { USD: 2, CNY: 2, JPY: 0 };

  it("returns the same amount when currencies match", async () => {
    const pool = stubPool([]);
    const result = await convert(pool, 6800n, "USD", "USD", "2026-08-04", decimalsByCode);
    expect(result).toEqual({ amountMinor: 6800n, approximate: false });
  });

  it("converts between two 2-decimal currencies via USD", async () => {
    // $10.00 -> CNY at 7.15 -> ¥71.50 -> 7150 minor units
    const pool = { query: vi.fn().mockResolvedValueOnce({ rows: [{ rate: "1" }] }).mockResolvedValueOnce({ rows: [{ rate: "7.15" }] }) };
    const result = await convert(pool, 1000n, "USD", "CNY", "2026-08-04", decimalsByCode);
    expect(result.amountMinor).toBe(7150n);
    expect(result.approximate).toBe(false);
  });

  it("converts correctly across differing decimal digits (USD -> JPY)", async () => {
    // $10.00 -> JPY at 149.5 -> ¥1495 -> 1495 minor units (0 decimals)
    const pool = { query: vi.fn().mockResolvedValueOnce({ rows: [{ rate: "1" }] }).mockResolvedValueOnce({ rows: [{ rate: "149.5" }] }) };
    const result = await convert(pool, 1000n, "USD", "JPY", "2026-08-04", decimalsByCode);
    expect(result.amountMinor).toBe(1495n);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npm test -- fx.test.ts
```

- [ ] **Step 3: Write the implementation**

```ts
// backend/src/lib/fx.ts
export interface Queryable {
  query: (sql: string, params: unknown[]) => Promise<{ rows: any[] }>;
}

export async function getRateToUSD(
  db: Queryable,
  currency: string,
  onDate: string
): Promise<{ rate: number; approximate: boolean }> {
  if (currency === "USD") return { rate: 1, approximate: false };

  const exact = await db.query(
    `SELECT rate FROM exchange_rates WHERE base_code = 'USD' AND quote_code = $1 AND rate_date = $2`,
    [currency, onDate]
  );
  if (exact.rows.length > 0) {
    return { rate: Number(exact.rows[0].rate), approximate: false };
  }

  const prior = await db.query(
    `SELECT rate FROM exchange_rates WHERE base_code = 'USD' AND quote_code = $1 AND rate_date <= $2 ORDER BY rate_date DESC LIMIT 1`,
    [currency, onDate]
  );
  if (prior.rows.length > 0) {
    return { rate: Number(prior.rows[0].rate), approximate: true };
  }

  throw new Error(`no exchange rate available for ${currency} on or before ${onDate}`);
}

/**
 * Converts a minor-units amount between currencies via USD as pivot, per §8 FX rules.
 * decimalsByCode must include entries for both fromCurrency and toCurrency.
 */
export async function convert(
  db: Queryable,
  amountMinor: bigint,
  fromCurrency: string,
  toCurrency: string,
  onDate: string,
  decimalsByCode: Record<string, number>
): Promise<{ amountMinor: bigint; approximate: boolean }> {
  if (fromCurrency === toCurrency) return { amountMinor, approximate: false };

  const [fromRate, toRate] = await Promise.all([
    getRateToUSD(db, fromCurrency, onDate),
    getRateToUSD(db, toCurrency, onDate),
  ]);

  const fromMajor = Number(amountMinor) / 10 ** decimalsByCode[fromCurrency];
  const usdMajor = fromMajor / fromRate.rate;
  const toMajor = usdMajor * toRate.rate;
  const toMinor = BigInt(Math.round(toMajor * 10 ** decimalsByCode[toCurrency]));

  return { amountMinor: toMinor, approximate: fromRate.approximate || toRate.approximate };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npm test -- fx.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/fx.ts backend/src/lib/fx.test.ts
git commit -m "feat: FX conversion lib with prior-rate fallback, tests"
```

---

### Task 10: Mailer (SMTP)

**Files:**
- Create: `backend/src/lib/mailer.ts`

**Interfaces:**
- Consumes: `env` from `backend/src/env.ts`.
- Produces: `sendVerificationEmail(to: string, verifyUrl: string): Promise<void>`.

- [ ] **Step 1: Write the implementation (no dedicated automated test — this is a thin I/O wrapper around a real SMTP send; correctness is verified manually below, and failures in the registration flow are logged, not thrown, so a bad SMTP config never blocks registration)**

```ts
// backend/src/lib/mailer.ts
import nodemailer from "nodemailer";
import { env } from "../env.js";

const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
});

export async function sendVerificationEmail(to: string, verifyUrl: string): Promise<void> {
  await transport.sendMail({
    from: env.CONTACT_EMAIL_FROM,
    to,
    subject: "Verify your Genkin-Impact email",
    text: `Welcome to Genkin-Impact. Verify your email: ${verifyUrl}`,
    html: `<p>Welcome to Genkin-Impact.</p><p><a href="${verifyUrl}">Verify your email</a></p>`,
  });
}
```

- [ ] **Step 2: Manually verify SMTP creds work**

```bash
cd backend && node --experimental-strip-types -e "
import('./src/lib/mailer.ts').then(async ({ sendVerificationEmail }) => {
  await sendVerificationEmail('YOUR_OWN_EMAIL@example.com', 'http://localhost:5173/verify-email?token=test');
  console.log('sent');
});
"
```
Expected: `sent` printed, and the email actually arrives. This proves the pasted SMTP credentials work before anything depends on them. (If `--experimental-strip-types` isn't available on your Node version, use `npx tsx -e "..."` with the same import instead.)

- [ ] **Step 3: Commit**

```bash
git add backend/src/lib/mailer.ts
git commit -m "feat: SMTP mailer for verification emails"
```

---

### Task 11: Express skeleton — app, server, error handler, auth middleware, validate helper

**Files:**
- Create: `backend/src/middleware/errorHandler.ts`
- Create: `backend/src/middleware/auth.ts`
- Create: `backend/src/middleware/validate.ts`
- Create: `backend/src/app.ts`
- Create: `backend/src/server.ts`
- Create: `backend/vitest.config.ts`

**Interfaces:**
- Produces: `AppError` class (`new AppError(status: number, code: string, message: string)`) and `errorHandler` Express middleware from `errorHandler.ts`. `requireAuth` Express middleware from `auth.ts` — sets `req.userId: string` on success, calls `next(new AppError(401, ...))` on failure. `validateBody(schema: ZodType)` middleware factory from `validate.ts` — parses `req.body` against `schema`, replaces `req.body` with the parsed/typed result, or calls `next(new AppError(400, "validation_error", ...))`. `app: Express` from `app.ts`.

- [ ] **Step 1: Write `backend/src/middleware/errorHandler.ts`**

```ts
import type { Request, Response, NextFunction } from "express";

export class AppError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: "internal_error", message: "Something went wrong." } });
}
```

- [ ] **Step 2: Write `backend/src/middleware/validate.ts`**

```ts
import type { Request, Response, NextFunction } from "express";
import type { ZodType } from "zod";
import { AppError } from "./errorHandler.js";

export function validateBody(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(new AppError(400, "validation_error", result.error.issues.map((i) => i.message).join("; ")));
      return;
    }
    req.body = result.data;
    next();
  };
}
```

- [ ] **Step 3: Write `backend/src/middleware/auth.ts`**

```ts
import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../lib/tokens.js";
import { env } from "../env.js";
import { AppError } from "./errorHandler.js";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.access_token;
  if (!token) {
    next(new AppError(401, "unauthenticated", "Not signed in."));
    return;
  }
  try {
    req.userId = verifyAccessToken(token, env.JWT_SECRET);
    next();
  } catch {
    next(new AppError(401, "unauthenticated", "Session expired."));
  }
}
```

- [ ] **Step 4: Write `backend/src/app.ts`**

```ts
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { env } from "./env.js";
import { errorHandler } from "./middleware/errorHandler.js";

export const app = express();

app.use(cors({ origin: env.APP_ORIGIN, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/health", (_req, res) => res.json({ ok: true }));

// Route mounts are added in later tasks:
// app.use("/auth", authRouter);
// app.use("/users", usersRouter);
// app.use("/currencies", currenciesRouter);
// app.use("/accounts", accountsRouter);
// app.use("/transactions", transactionsRouter);

app.use(errorHandler);
```

- [ ] **Step 5: Write `backend/src/server.ts`**

```ts
import { app } from "./app.js";
import { env } from "./env.js";

app.listen(env.PORT, () => {
  console.log(`Genkin-Impact API listening on :${env.PORT}`);
});
```

- [ ] **Step 6: Write `backend/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 15000,
  },
});
```

- [ ] **Step 7: Verify the server boots and `/health` responds**

```bash
cd backend && npm run dev &
sleep 2
curl -s http://localhost:4000/health
kill %1
```
Expected: `{"ok":true}`.

- [ ] **Step 8: Commit**

```bash
git add backend/src/middleware backend/src/app.ts backend/src/server.ts backend/vitest.config.ts
git commit -m "feat: express app skeleton, error handler, auth middleware, zod validate helper"
```

---

### Task 12: Auth routes — register, login, refresh, logout, me, verify

**Files:**
- Create: `backend/src/routes/auth.ts`
- Test: `backend/src/routes/auth.test.ts`
- Modify: `backend/src/app.ts` (mount `/auth`)

**Interfaces:**
- Consumes: `hashPassword`/`verifyPassword` (Task 6), `signAccessToken`/`generateRefreshToken`/`hashRefreshToken`/`ACCESS_TOKEN_TTL_MS`/`REFRESH_TOKEN_TTL_MS` (Task 7), `sendVerificationEmail` (Task 10), `newId` (Task 1), `pool` (Task 1), `requireAuth`/`validateBody`/`AppError` (Task 11).
- Produces: Express router mounted at `/auth` with `POST /register`, `POST /login`, `POST /refresh`, `POST /logout`, `GET /me`, `POST /verify`. Sets/clears `access_token` and `refresh_token` httpOnly cookies. Seeds 9 default categories (Delivery🍕/Pet🐸/Gasoline⛽/Fruit🥝/Health🧬/Travel⛱️ as `expense`, Salary/Bonus/Refund as `income`) and one default `member` (name = `display_name`, `is_default = true`) on registration, per §5.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/routes/auth.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../app.js";
import { pool } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";

beforeAll(async () => {
  await runMigrations();
});

beforeEach(async () => {
  await pool.query("DELETE FROM sessions");
  await pool.query("DELETE FROM members");
  await pool.query("DELETE FROM categories");
  await pool.query("DELETE FROM users");
});

afterAll(async () => {
  await pool.end();
});

describe("POST /auth/register", () => {
  it("creates a user, seeds defaults, and sets auth cookies", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ email: "test@example.com", password: "correct horse battery staple", display_name: "Test User" });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe("test@example.com");
    expect(res.body.user.password_hash).toBeUndefined();
    expect(res.headers["set-cookie"].some((c: string) => c.startsWith("access_token="))).toBe(true);
    expect(res.headers["set-cookie"].some((c: string) => c.startsWith("refresh_token="))).toBe(true);

    const categories = await pool.query("SELECT kind, count(*) FROM categories GROUP BY kind ORDER BY kind");
    expect(categories.rows).toEqual([
      { kind: "expense", count: "6" },
      { kind: "income", count: "3" },
    ]);

    const members = await pool.query("SELECT name, is_default FROM members");
    expect(members.rows).toEqual([{ name: "Test User", is_default: true }]);
  });

  it("rejects a duplicate email", async () => {
    await request(app).post("/auth/register").send({ email: "dup@example.com", password: "password12345", display_name: "A" });
    const res = await request(app).post("/auth/register").send({ email: "dup@example.com", password: "password12345", display_name: "B" });
    expect(res.status).toBe(409);
  });
});

describe("POST /auth/login and GET /auth/me", () => {
  it("logs in with correct credentials and /me reflects the session", async () => {
    await request(app).post("/auth/register").send({ email: "login@example.com", password: "password12345", display_name: "Login User" });

    const agent = request.agent(app);
    const loginRes = await agent.post("/auth/login").send({ email: "login@example.com", password: "password12345" });
    expect(loginRes.status).toBe(200);

    const meRes = await agent.get("/auth/me");
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe("login@example.com");
  });

  it("returns a generic error for wrong password", async () => {
    await request(app).post("/auth/register").send({ email: "wrongpw@example.com", password: "password12345", display_name: "U" });
    const res = await request(app).post("/auth/login").send({ email: "wrongpw@example.com", password: "nope-nope-nope" });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("Email or password is incorrect.");
  });

  it("returns the same generic error for a nonexistent email", async () => {
    const res = await request(app).post("/auth/login").send({ email: "nobody@example.com", password: "password12345" });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("Email or password is incorrect.");
  });
});

describe("POST /auth/refresh", () => {
  it("rotates the refresh token and revokes the old session", async () => {
    const agent = request.agent(app);
    await agent.post("/auth/register").send({ email: "refresh@example.com", password: "password12345", display_name: "R" });

    const sessionsBefore = await pool.query("SELECT id, revoked_at FROM sessions");
    expect(sessionsBefore.rows).toHaveLength(1);

    const refreshRes = await agent.post("/auth/refresh");
    expect(refreshRes.status).toBe(200);

    const sessionsAfter = await pool.query("SELECT id, revoked_at FROM sessions ORDER BY created_at");
    expect(sessionsAfter.rows).toHaveLength(2);
    expect(sessionsAfter.rows[0].revoked_at).not.toBeNull();
    expect(sessionsAfter.rows[1].revoked_at).toBeNull();
  });
});

describe("POST /auth/logout", () => {
  it("revokes the session so /me subsequently requires re-login", async () => {
    const agent = request.agent(app);
    await agent.post("/auth/register").send({ email: "logout@example.com", password: "password12345", display_name: "L" });
    const logoutRes = await agent.post("/auth/logout");
    expect(logoutRes.status).toBe(204);

    const session = await pool.query("SELECT revoked_at FROM sessions");
    expect(session.rows[0].revoked_at).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
docker compose up -d postgres
cd backend && npm test -- auth.test.ts
```
Expected: FAIL — route doesn't exist / 404s.

- [ ] **Step 3: Write the implementation**

```ts
// backend/src/routes/auth.ts
import { Router, type Response, type Request } from "express";
import { z } from "zod";
import { randomBytes, createHash } from "node:crypto";
import { pool } from "../db/pool.js";
import { newId } from "../lib/ids.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  ACCESS_TOKEN_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
} from "../lib/tokens.js";
import { sendVerificationEmail } from "../lib/mailer.js";
import { env } from "../env.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { AppError } from "../middleware/errorHandler.js";

export const authRouter = Router();

const DEFAULT_CATEGORIES: Array<{ name: string; emoji: string; kind: "expense" | "income" }> = [
  { name: "Delivery", emoji: "🍕", kind: "expense" },
  { name: "Pet", emoji: "🐸", kind: "expense" },
  { name: "Gasoline", emoji: "⛽", kind: "expense" },
  { name: "Fruit", emoji: "🥝", kind: "expense" },
  { name: "Health", emoji: "🧬", kind: "expense" },
  { name: "Travel", emoji: "⛱️", kind: "expense" },
  { name: "Salary", emoji: "", kind: "income" },
  { name: "Bonus", emoji: "", kind: "income" },
  { name: "Refund", emoji: "", kind: "income" },
];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  const secure = env.NODE_ENV === "production";
  res.cookie("access_token", accessToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_TOKEN_TTL_MS,
  });
  res.cookie("refresh_token", refreshToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: REFRESH_TOKEN_TTL_MS,
  });
}

function toPublicUser(row: any) {
  const { password_hash, email_verification_token_hash, ...rest } = row;
  return rest;
}

async function issueSession(userId: string, req: Request, res: Response) {
  const accessToken = signAccessToken(userId, env.JWT_SECRET);
  const refresh = generateRefreshToken();
  await pool.query(
    `INSERT INTO sessions (id, user_id, refresh_token_hash, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [newId(), userId, refresh.hash, req.headers["user-agent"] ?? null, req.ip ?? null, refresh.expiresAt]
  );
  setAuthCookies(res, accessToken, refresh.raw);
}

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10, "Password must be at least 10 characters."),
  display_name: z.string().min(1).max(80),
});

authRouter.post("/register", validateBody(registerSchema), async (req, res, next) => {
  try {
    const { email, password, display_name } = req.body as z.infer<typeof registerSchema>;

    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      throw new AppError(409, "email_taken", "An account with this email already exists.");
    }

    const passwordHash = await hashPassword(password);
    const userId = newId();
    const rawVerifyToken = randomBytes(24).toString("base64url");
    const verifyTokenHash = createHash("sha256").update(rawVerifyToken).digest("hex");
    const verifyExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const userRes = await client.query(
        `INSERT INTO users (id, email, password_hash, display_name, email_verification_token_hash, email_verification_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [userId, email, passwordHash, display_name, verifyTokenHash, verifyExpiresAt]
      );

      for (const [i, cat] of DEFAULT_CATEGORIES.entries()) {
        await client.query(
          `INSERT INTO categories (id, user_id, name, emoji, kind, sort_order, is_system) VALUES ($1, $2, $3, $4, $5, $6, true)`,
          [newId(), userId, cat.name, cat.emoji, cat.kind, i]
        );
      }

      await client.query(
        `INSERT INTO members (id, user_id, name, initials, is_default) VALUES ($1, $2, $3, $4, true)`,
        [newId(), userId, display_name, initialsOf(display_name)]
      );

      await client.query("COMMIT");

      const user = userRes.rows[0];

      // Best-effort: a broken SMTP config must never block registration.
      const verifyUrl = `${env.APP_ORIGIN}/verify-email?token=${rawVerifyToken}`;
      sendVerificationEmail(email, verifyUrl).catch((err) => console.error("failed to send verification email", err));

      await issueSession(userId, req, res);
      res.status(201).json({ user: toPublicUser(user) });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

authRouter.post("/login", validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body as z.infer<typeof loginSchema>;
    const result = await pool.query("SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL", [email]);
    const user = result.rows[0];

    const genericError = () => new AppError(401, "invalid_credentials", "Email or password is incorrect.");

    if (!user) throw genericError();
    const valid = await verifyPassword(user.password_hash, password);
    if (!valid) throw genericError();

    await issueSession(user.id, req, res);
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/refresh", async (req, res, next) => {
  try {
    const rawToken = req.cookies?.refresh_token;
    if (!rawToken) throw new AppError(401, "unauthenticated", "No refresh token.");

    const hash = hashRefreshToken(rawToken);
    const sessionRes = await pool.query(
      `SELECT * FROM sessions WHERE refresh_token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [hash]
    );
    const session = sessionRes.rows[0];
    if (!session) throw new AppError(401, "unauthenticated", "Session expired or revoked.");

    await pool.query("UPDATE sessions SET revoked_at = now() WHERE id = $1", [session.id]);
    await issueSession(session.user_id, req, res);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", async (req, res, next) => {
  try {
    const rawToken = req.cookies?.refresh_token;
    if (rawToken) {
      const hash = hashRefreshToken(rawToken);
      await pool.query("UPDATE sessions SET revoked_at = now() WHERE refresh_token_hash = $1 AND revoked_at IS NULL", [hash]);
    }
    res.clearCookie("access_token", { path: "/" });
    res.clearCookie("refresh_token", { path: "/" });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL", [req.userId]);
    const user = result.rows[0];
    if (!user) throw new AppError(401, "unauthenticated", "User not found.");
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

const verifySchema = z.object({ token: z.string().min(1) });

authRouter.post("/verify", validateBody(verifySchema), async (req, res, next) => {
  try {
    const { token } = req.body as z.infer<typeof verifySchema>;
    const hash = createHash("sha256").update(token).digest("hex");
    const result = await pool.query(
      `UPDATE users SET email_verified_at = now(), email_verification_token_hash = NULL
       WHERE email_verification_token_hash = $1 AND email_verification_expires_at > now()
       RETURNING id`,
      [hash]
    );
    if (result.rows.length === 0) throw new AppError(400, "invalid_token", "This verification link is invalid or expired.");
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 4: Mount the router in `backend/src/app.ts`**

Replace the comment `// app.use("/auth", authRouter);` with a real import + mount:

```ts
import { authRouter } from "./routes/auth.js";
// ...
app.use("/auth", authRouter);
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd backend && npm test -- auth.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/auth.ts backend/src/routes/auth.test.ts backend/src/app.ts
git commit -m "feat: auth routes - register/login/refresh/logout/me/verify"
```

---

### Task 13: Users route (main currency) + Currencies route

**Files:**
- Create: `backend/src/routes/users.ts`
- Create: `backend/src/routes/currencies.ts`
- Modify: `backend/src/app.ts`

**Interfaces:**
- Consumes: `requireAuth`, `validateBody`, `AppError`, `pool`.
- Produces: `PATCH /users/me` (body `{ main_currency_code: string }`), `GET /currencies`. Both exercised as part of Task 14's onboarding integration test.

- [ ] **Step 1: Write `backend/src/routes/currencies.ts`**

```ts
import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";

export const currenciesRouter = Router();

currenciesRouter.get("/", requireAuth, async (_req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT code, name, symbol, decimal_digits FROM currencies WHERE is_active = true ORDER BY code"
    );
    res.json({ currencies: result.rows });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 2: Write `backend/src/routes/users.ts`**

```ts
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { AppError } from "../middleware/errorHandler.js";

export const usersRouter = Router();

const setCurrencySchema = z.object({ main_currency_code: z.string().length(3) });

usersRouter.patch("/me", requireAuth, validateBody(setCurrencySchema), async (req, res, next) => {
  try {
    const { main_currency_code } = req.body as z.infer<typeof setCurrencySchema>;
    const currency = await pool.query("SELECT code FROM currencies WHERE code = $1 AND is_active = true", [main_currency_code]);
    if (currency.rows.length === 0) throw new AppError(400, "invalid_currency", "Unknown currency code.");

    const result = await pool.query(
      `UPDATE users SET main_currency_code = $1 WHERE id = $2 RETURNING id, main_currency_code`,
      [main_currency_code, req.userId]
    );
    res.json({ user: result.rows[0] });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 3: Mount both routers in `backend/src/app.ts`**

```ts
import { currenciesRouter } from "./routes/currencies.js";
import { usersRouter } from "./routes/users.js";
// ...
app.use("/currencies", currenciesRouter);
app.use("/users", usersRouter);
```

- [ ] **Step 4: Manual smoke test**

```bash
cd backend && npm run dev &
sleep 2
curl -s http://localhost:4000/currencies -b "access_token=invalid"
kill %1
```
Expected: `{"error":{"code":"unauthenticated","message":"Session expired."}}` — proves the route is mounted and auth-gated. Full happy-path coverage happens via Task 14's integration test, which exercises `PATCH /users/me` as part of onboarding.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/users.ts backend/src/routes/currencies.ts backend/src/app.ts
git commit -m "feat: currencies list route, users/me main-currency route"
```

---

### Task 14: Accounts routes — list + create (doubles as onboarding completion)

**Files:**
- Create: `backend/src/routes/accounts.ts`
- Test: `backend/src/routes/accounts.test.ts`
- Modify: `backend/src/app.ts`

**Interfaces:**
- Consumes: `requireAuth`, `validateBody`, `AppError`, `pool`, `newId`, `parseToMinor`, `formatMinor` (Task 5).
- Produces: `GET /accounts` (list non-archived, non-deleted accounts for the current user, joined with currency info, includes `cached_balance` and a formatted `balance_display`), `POST /accounts` (body `{ name, type, currency_code, opening_balance: string }` — creates the account with `opening_balance = cached_balance = parseToMinor(...)`; if the user's `onboarded_at` is null, sets it to `now()` in the same transaction — this is the "reuses steps 2–3 as a modal, same handler" note from §5).

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/routes/accounts.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../app.js";
import { pool } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";

beforeAll(async () => {
  await runMigrations();
});

beforeEach(async () => {
  await pool.query("DELETE FROM transactions");
  await pool.query("DELETE FROM accounts");
  await pool.query("DELETE FROM sessions");
  await pool.query("DELETE FROM members");
  await pool.query("DELETE FROM categories");
  await pool.query("DELETE FROM users");
});

afterAll(async () => {
  await pool.end();
});

async function registerAndLogin() {
  const agent = request.agent(app);
  await agent.post("/auth/register").send({ email: "acct@example.com", password: "password12345", display_name: "Acct User" });
  return agent;
}

describe("onboarding via PATCH /users/me + POST /accounts", () => {
  it("sets main currency, creates the first account, and marks onboarded_at", async () => {
    const agent = await registerAndLogin();

    const meBefore = await agent.get("/auth/me");
    expect(meBefore.body.user.onboarded_at).toBeNull();

    const currencyRes = await agent.patch("/users/me").send({ main_currency_code: "USD" });
    expect(currencyRes.status).toBe(200);
    expect(currencyRes.body.user.main_currency_code).toBe("USD");

    const accountRes = await agent.post("/accounts").send({
      name: "Checking",
      type: "bank",
      currency_code: "USD",
      opening_balance: "1500.00",
    });
    expect(accountRes.status).toBe(201);
    expect(accountRes.body.account.cached_balance).toBe("150000");
    expect(accountRes.body.account.balance_display).toBe("$1,500.00");

    const meAfter = await agent.get("/auth/me");
    expect(meAfter.body.user.onboarded_at).not.toBeNull();
  });

  it("does not re-touch onboarded_at when a second account is added later", async () => {
    const agent = await registerAndLogin();
    await agent.patch("/users/me").send({ main_currency_code: "USD" });
    await agent.post("/accounts").send({ name: "Checking", type: "bank", currency_code: "USD", opening_balance: "1500.00" });
    const meAfterFirst = await agent.get("/auth/me");
    const onboardedAt = meAfterFirst.body.user.onboarded_at;

    await agent.post("/accounts").send({ name: "Savings", type: "bank", currency_code: "USD", opening_balance: "200.00" });
    const meAfterSecond = await agent.get("/auth/me");
    expect(meAfterSecond.body.user.onboarded_at).toBe(onboardedAt);
  });
});

describe("GET /accounts", () => {
  it("lists only the current user's accounts", async () => {
    const agent = await registerAndLogin();
    await agent.post("/accounts").send({ name: "Checking", type: "bank", currency_code: "USD", opening_balance: "100.00" });

    const otherAgent = request.agent(app);
    await otherAgent.post("/auth/register").send({ email: "other@example.com", password: "password12345", display_name: "Other" });
    await otherAgent.post("/accounts").send({ name: "Other Checking", type: "bank", currency_code: "USD", opening_balance: "50.00" });

    const res = await agent.get("/accounts");
    expect(res.status).toBe(200);
    expect(res.body.accounts).toHaveLength(1);
    expect(res.body.accounts[0].name).toBe("Checking");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npm test -- accounts.test.ts
```

- [ ] **Step 3: Write the implementation**

```ts
// backend/src/routes/accounts.ts
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { newId } from "../lib/ids.js";
import { parseToMinor, formatMinor } from "../lib/money.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { AppError } from "../middleware/errorHandler.js";

export const accountsRouter = Router();

const ACCOUNT_TYPES = ["cash", "bank", "credit_card", "e_wallet", "investment", "liability"] as const;

const createAccountSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(ACCOUNT_TYPES),
  currency_code: z.string().length(3),
  opening_balance: z.string().regex(/^\d+(\.\d+)?$/, "opening_balance must be a plain decimal string"),
});

function withDisplay(account: any, symbol: string) {
  return { ...account, balance_display: formatMinor(BigInt(account.cached_balance), account.decimal_digits, symbol) };
}

accountsRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT a.*, c.symbol, c.decimal_digits
       FROM accounts a
       JOIN currencies c ON c.code = a.currency_code
       WHERE a.user_id = $1 AND a.deleted_at IS NULL AND a.is_archived = false
       ORDER BY a.sort_order, a.created_at`,
      [req.userId]
    );
    res.json({ accounts: result.rows.map((row) => withDisplay(row, row.symbol)) });
  } catch (err) {
    next(err);
  }
});

accountsRouter.post("/", requireAuth, validateBody(createAccountSchema), async (req, res, next) => {
  try {
    const { name, type, currency_code, opening_balance } = req.body as z.infer<typeof createAccountSchema>;

    const currencyRes = await pool.query("SELECT decimal_digits, symbol FROM currencies WHERE code = $1 AND is_active = true", [currency_code]);
    if (currencyRes.rows.length === 0) throw new AppError(400, "invalid_currency", "Unknown currency code.");
    const { decimal_digits, symbol } = currencyRes.rows[0];

    const openingMinor = parseToMinor(opening_balance, decimal_digits);
    const accountId = newId();

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const accountRes = await client.query(
        `INSERT INTO accounts (id, user_id, name, type, currency_code, opening_balance, cached_balance)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         RETURNING *`,
        [accountId, req.userId, name, type, currency_code, openingMinor]
      );

      const userRes = await client.query("SELECT onboarded_at FROM users WHERE id = $1", [req.userId]);
      if (userRes.rows[0].onboarded_at === null) {
        await client.query("UPDATE users SET onboarded_at = now() WHERE id = $1", [req.userId]);
      }

      await client.query("COMMIT");

      res.status(201).json({ account: withDisplay({ ...accountRes.rows[0], decimal_digits }, symbol) });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});
```

Note: `cached_balance` in the JSON response is `bigint`-sourced; `pg` returns `BIGINT` columns as strings by default (safe — avoids silent precision loss), which is why the test asserts `"150000"` as a string, not a number.

- [ ] **Step 4: Mount the router in `backend/src/app.ts`**

```ts
import { accountsRouter } from "./routes/accounts.js";
// ...
app.use("/accounts", accountsRouter);
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd backend && npm test -- accounts.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/accounts.ts backend/src/routes/accounts.test.ts backend/src/app.ts
git commit -m "feat: accounts routes - list, create (doubles as onboarding completion)"
```

---

### Task 15: Transactions routes — create, list, summary

**Files:**
- Create: `backend/src/routes/transactions.ts`
- Test: `backend/src/routes/transactions.test.ts`
- Modify: `backend/src/app.ts`

**Interfaces:**
- Consumes: `requireAuth`, `validateBody`, `AppError`, `pool`, `newId`, `parseToMinor`, `recomputeAccountBalance` (Task 8), `convert` (Task 9).
- Produces: `POST /transactions` (discriminated-union body on `type`), `GET /transactions?type=&from=&to=&limit=&offset=`, `GET /transactions/summary?from=&to=&type=`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/routes/transactions.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../app.js";
import { pool } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";

beforeAll(async () => {
  await runMigrations();
});

beforeEach(async () => {
  await pool.query("DELETE FROM transactions");
  await pool.query("DELETE FROM accounts");
  await pool.query("DELETE FROM sessions");
  await pool.query("DELETE FROM members");
  await pool.query("DELETE FROM categories");
  await pool.query("DELETE FROM users");
});

afterAll(async () => {
  await pool.end();
});

async function setUp() {
  const agent = request.agent(app);
  await agent.post("/auth/register").send({ email: "txn@example.com", password: "password12345", display_name: "Txn User" });
  await agent.patch("/users/me").send({ main_currency_code: "USD" });
  const accountRes = await agent.post("/accounts").send({ name: "Checking", type: "bank", currency_code: "USD", opening_balance: "1000.00" });
  const catRow = await pool.query("SELECT id FROM categories WHERE kind = 'expense' AND name = 'Delivery' LIMIT 1");
  return { agent, accountId: accountRes.body.account.id, categoryId: catRow.rows[0].id };
}

describe("POST /transactions", () => {
  it("creates an expense and recomputes the account balance", async () => {
    const { agent, accountId, categoryId } = await setUp();

    const res = await agent.post("/transactions").send({
      type: "expense",
      account_id: accountId,
      category_id: categoryId,
      amount: "68.00",
      occurred_at: "2026-08-04T09:41:00.000Z",
      note: "Lunch",
    });
    expect(res.status).toBe(201);
    expect(res.body.transaction.amount).toBe("6800");

    const accountRes = await agent.get("/accounts");
    expect(accountRes.body.accounts[0].cached_balance).toBe("93200"); // 1000.00 - 68.00 = 932.00
  });

  it("rejects a category whose kind doesn't match the transaction type", async () => {
    const { agent, accountId } = await setUp();
    const incomeCat = await pool.query("SELECT id FROM categories WHERE kind = 'income' LIMIT 1");

    const res = await agent.post("/transactions").send({
      type: "expense",
      account_id: accountId,
      category_id: incomeCat.rows[0].id,
      amount: "10.00",
      occurred_at: "2026-08-04T09:41:00.000Z",
    });
    expect(res.status).toBe(400);
  });

  it("creates a same-currency transfer and moves the balance on both accounts", async () => {
    const { agent, accountId } = await setUp();
    const secondAccountRes = await agent.post("/accounts").send({ name: "Savings", type: "bank", currency_code: "USD", opening_balance: "0.00" });
    const toAccountId = secondAccountRes.body.account.id;

    const res = await agent.post("/transactions").send({
      type: "transfer",
      account_id: accountId,
      to_account_id: toAccountId,
      amount: "100.00",
      occurred_at: "2026-08-04T09:41:00.000Z",
    });
    expect(res.status).toBe(201);
    expect(res.body.transaction.to_amount).toBe("10000");

    const accountsRes = await agent.get("/accounts");
    const byName: Record<string, string> = {};
    for (const a of accountsRes.body.accounts) byName[a.name] = a.cached_balance;
    expect(byName["Checking"]).toBe("90000"); // 1000 - 100
    expect(byName["Savings"]).toBe("10000"); // 0 + 100
  });

  it("rejects a non-positive amount", async () => {
    const { agent, accountId, categoryId } = await setUp();
    const res = await agent.post("/transactions").send({
      type: "expense",
      account_id: accountId,
      category_id: categoryId,
      amount: "0.00",
      occurred_at: "2026-08-04T09:41:00.000Z",
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /transactions", () => {
  it("filters by type and date range, ordered newest first", async () => {
    const { agent, accountId, categoryId } = await setUp();
    await agent.post("/transactions").send({ type: "expense", account_id: accountId, category_id: categoryId, amount: "10.00", occurred_at: "2026-08-01T00:00:00.000Z" });
    await agent.post("/transactions").send({ type: "expense", account_id: accountId, category_id: categoryId, amount: "20.00", occurred_at: "2026-08-03T00:00:00.000Z" });
    const incomeCat = await pool.query("SELECT id FROM categories WHERE kind = 'income' LIMIT 1");
    await agent.post("/transactions").send({ type: "income", account_id: accountId, category_id: incomeCat.rows[0].id, amount: "500.00", occurred_at: "2026-08-02T00:00:00.000Z" });

    const res = await agent.get("/transactions").query({ type: "expense", from: "2026-08-02", to: "2026-08-04" });
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].amount).toBe("2000");
  });
});

describe("GET /transactions/summary", () => {
  it("returns income, expenditure, balance, and count converted to main currency", async () => {
    const { agent, accountId, categoryId } = await setUp();
    const incomeCat = await pool.query("SELECT id FROM categories WHERE kind = 'income' LIMIT 1");
    await agent.post("/transactions").send({ type: "expense", account_id: accountId, category_id: categoryId, amount: "68.00", occurred_at: new Date().toISOString() });
    await agent.post("/transactions").send({ type: "income", account_id: accountId, category_id: incomeCat.rows[0].id, amount: "500.00", occurred_at: new Date().toISOString() });

    const res = await agent.get("/transactions/summary");
    expect(res.status).toBe(200);
    expect(res.body.summary.income_minor).toBe("50000");
    expect(res.body.summary.expenditure_minor).toBe("6800");
    expect(res.body.summary.count).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npm test -- transactions.test.ts
```

- [ ] **Step 3: Write the implementation**

```ts
// backend/src/routes/transactions.ts
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { newId } from "../lib/ids.js";
import { parseToMinor } from "../lib/money.js";
import { recomputeAccountBalance } from "../lib/balances.js";
import { convert } from "../lib/fx.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { AppError } from "../middleware/errorHandler.js";

export const transactionsRouter = Router();

const baseFields = {
  amount: z.string().regex(/^\d+(\.\d+)?$/, "amount must be a plain decimal string"),
  occurred_at: z.string().datetime(),
  note: z.string().max(500).optional(),
};

const expenseOrIncomeSchema = z.object({
  type: z.enum(["expense", "income"]),
  account_id: z.string().uuid(),
  category_id: z.string().uuid(),
  ...baseFields,
});

const transferSchema = z.object({
  type: z.literal("transfer"),
  account_id: z.string().uuid(),
  to_account_id: z.string().uuid(),
  to_amount: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  ...baseFields,
});

const createTransactionSchema = z.union([expenseOrIncomeSchema, transferSchema]);

async function loadOwnedAccount(userId: string, accountId: string) {
  const res = await pool.query(
    `SELECT a.*, c.decimal_digits FROM accounts a JOIN currencies c ON c.code = a.currency_code
     WHERE a.id = $1 AND a.user_id = $2 AND a.deleted_at IS NULL AND a.is_archived = false`,
    [accountId, userId]
  );
  if (res.rows.length === 0) throw new AppError(400, "invalid_account", "Account not found.");
  return res.rows[0];
}

transactionsRouter.post("/", requireAuth, validateBody(createTransactionSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof createTransactionSchema>;
    const account = await loadOwnedAccount(req.userId!, body.account_id);
    const amountMinor = parseToMinor(body.amount, account.decimal_digits);
    if (amountMinor <= 0n) throw new AppError(400, "invalid_amount", "Amount must be positive.");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const id = newId();

      if (body.type === "transfer") {
        if (body.to_account_id === body.account_id) throw new AppError(400, "invalid_transfer", "Source and destination accounts must differ.");
        const toAccount = await loadOwnedAccount(req.userId!, body.to_account_id);

        let toAmountMinor: bigint;
        if (toAccount.currency_code === account.currency_code) {
          toAmountMinor = amountMinor;
        } else {
          if (!body.to_amount) throw new AppError(400, "to_amount_required", "to_amount is required for cross-currency transfers.");
          toAmountMinor = parseToMinor(body.to_amount, toAccount.decimal_digits);
        }

        await client.query(
          `INSERT INTO transactions (id, user_id, type, account_id, to_account_id, amount, currency_code, to_amount, occurred_at, note)
           VALUES ($1, $2, 'transfer', $3, $4, $5, $6, $7, $8, $9)`,
          [id, req.userId, body.account_id, body.to_account_id, amountMinor, account.currency_code, toAmountMinor, body.occurred_at, body.note ?? null]
        );

        await recomputeAccountBalance(client, body.account_id);
        await recomputeAccountBalance(client, body.to_account_id);
      } else {
        const category = await client.query(
          "SELECT kind FROM categories WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
          [body.category_id, req.userId]
        );
        if (category.rows.length === 0) throw new AppError(400, "invalid_category", "Category not found.");
        if (category.rows[0].kind !== body.type) {
          throw new AppError(400, "category_kind_mismatch", "Category kind must match transaction type.");
        }

        await client.query(
          `INSERT INTO transactions (id, user_id, type, account_id, category_id, amount, currency_code, occurred_at, note)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [id, req.userId, body.type, body.account_id, body.category_id, amountMinor, account.currency_code, body.occurred_at, body.note ?? null]
        );

        await recomputeAccountBalance(client, body.account_id);
      }

      const created = await client.query("SELECT * FROM transactions WHERE id = $1", [id]);
      await client.query("COMMIT");
      res.status(201).json({ transaction: created.rows[0] });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

const listQuerySchema = z.object({
  type: z.enum(["expense", "income", "transfer"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

transactionsRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const query = listQuerySchema.parse(req.query);
    const conditions = ["t.user_id = $1", "t.deleted_at IS NULL"];
    const params: unknown[] = [req.userId];

    if (query.type) {
      params.push(query.type);
      conditions.push(`t.type = $${params.length}`);
    }
    if (query.from) {
      params.push(query.from);
      conditions.push(`t.occurred_at >= $${params.length}`);
    }
    if (query.to) {
      params.push(query.to);
      conditions.push(`t.occurred_at <= $${params.length}`);
    }

    params.push(query.limit, query.offset);
    const result = await pool.query(
      `SELECT t.*, c.name AS category_name, c.emoji AS category_emoji, a.name AS account_name
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       JOIN accounts a ON a.id = t.account_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY t.occurred_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ items: result.rows });
  } catch (err) {
    next(err);
  }
});

const summaryQuerySchema = z.object({
  type: z.enum(["expense", "income", "transfer"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

transactionsRouter.get("/summary", requireAuth, async (req, res, next) => {
  try {
    const query = summaryQuerySchema.parse(req.query);
    const conditions = ["user_id = $1", "deleted_at IS NULL"];
    const params: unknown[] = [req.userId];

    if (query.type) {
      params.push(query.type);
      conditions.push(`type = $${params.length}`);
    }
    if (query.from) {
      params.push(query.from);
      conditions.push(`occurred_at >= $${params.length}`);
    }
    if (query.to) {
      params.push(query.to);
      conditions.push(`occurred_at <= $${params.length}`);
    }

    const grouped = await pool.query(
      `SELECT currency_code, type, SUM(amount) AS total, COUNT(*) AS count
       FROM transactions
       WHERE ${conditions.join(" AND ")} AND type IN ('income', 'expense')
       GROUP BY currency_code, type`,
      params
    );

    const userRes = await pool.query("SELECT main_currency_code FROM users WHERE id = $1", [req.userId]);
    const mainCurrency = userRes.rows[0].main_currency_code as string | null;
    if (!mainCurrency) throw new AppError(400, "no_main_currency", "User has not set a main currency yet.");

    const currenciesRes = await pool.query("SELECT code, decimal_digits FROM currencies");
    const decimalsByCode: Record<string, number> = {};
    for (const row of currenciesRes.rows) decimalsByCode[row.code] = row.decimal_digits;

    const onDate = (query.to ?? new Date().toISOString().slice(0, 10)).slice(0, 10);

    let incomeMinor = 0n;
    let expenditureMinor = 0n;
    let count = 0;

    for (const row of grouped.rows) {
      const converted = await convert(pool, BigInt(row.total), row.currency_code, mainCurrency, onDate, decimalsByCode);
      if (row.type === "income") incomeMinor += converted.amountMinor;
      else expenditureMinor += converted.amountMinor;
      count += Number(row.count);
    }

    res.json({
      summary: {
        income_minor: incomeMinor.toString(),
        expenditure_minor: expenditureMinor.toString(),
        balance_minor: (incomeMinor - expenditureMinor).toString(),
        count,
        main_currency_code: mainCurrency,
      },
    });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 4: Mount the router in `backend/src/app.ts`**

```ts
import { transactionsRouter } from "./routes/transactions.js";
// ...
app.use("/transactions", transactionsRouter);
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd backend && npm test -- transactions.test.ts
```

- [ ] **Step 6: Run the full backend test suite**

```bash
cd backend && npm test
```
Expected: all suites pass (money, password, tokens, balances, fx, migrate, auth, accounts, transactions).

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/transactions.ts backend/src/routes/transactions.test.ts backend/src/app.ts
git commit -m "feat: transactions routes - create (expense/income/transfer), list, summary"
```

---

### Task 16: Categories route — list

**Files:**
- Create: `backend/src/routes/categories.ts`
- Test: `backend/src/routes/categories.test.ts`
- Modify: `backend/src/app.ts`

**Interfaces:**
- Consumes: `requireAuth`, `pool`.
- Produces: `GET /categories?kind=expense|income` (optional filter) — returns the current user's non-deleted categories, needed by the frontend's add-transaction form to let users pick a category (expense/income transactions require a valid `category_id`, and the 9 defaults are seeded on registration by Task 12).

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/routes/categories.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../app.js";
import { pool } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";

beforeAll(async () => {
  await runMigrations();
});

beforeEach(async () => {
  await pool.query("DELETE FROM sessions");
  await pool.query("DELETE FROM members");
  await pool.query("DELETE FROM categories");
  await pool.query("DELETE FROM users");
});

afterAll(async () => {
  await pool.end();
});

describe("GET /categories", () => {
  it("returns the current user's seeded categories, optionally filtered by kind", async () => {
    const agent = request.agent(app);
    await agent.post("/auth/register").send({ email: "cats@example.com", password: "password12345", display_name: "Cats" });

    const all = await agent.get("/categories");
    expect(all.status).toBe(200);
    expect(all.body.categories).toHaveLength(9);

    const income = await agent.get("/categories").query({ kind: "income" });
    expect(income.body.categories).toHaveLength(3);
    expect(income.body.categories.every((c: { kind: string }) => c.kind === "income")).toBe(true);
  });

  it("does not return another user's categories", async () => {
    const agentA = request.agent(app);
    await agentA.post("/auth/register").send({ email: "a@example.com", password: "password12345", display_name: "A" });
    const agentB = request.agent(app);
    await agentB.post("/auth/register").send({ email: "b@example.com", password: "password12345", display_name: "B" });

    const res = await agentA.get("/categories");
    expect(res.body.categories).toHaveLength(9); // only their own 9, not 18
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npm test -- categories.test.ts
```

- [ ] **Step 3: Write the implementation**

```ts
// backend/src/routes/categories.ts
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";

export const categoriesRouter = Router();

const listQuerySchema = z.object({ kind: z.enum(["expense", "income"]).optional() });

categoriesRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const query = listQuerySchema.parse(req.query);
    const conditions = ["user_id = $1", "deleted_at IS NULL"];
    const params: unknown[] = [req.userId];

    if (query.kind) {
      params.push(query.kind);
      conditions.push(`kind = $${params.length}`);
    }

    const result = await pool.query(
      `SELECT id, name, emoji, kind, sort_order FROM categories WHERE ${conditions.join(" AND ")} ORDER BY sort_order`,
      params
    );
    res.json({ categories: result.rows });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 4: Mount the router in `backend/src/app.ts`**

```ts
import { categoriesRouter } from "./routes/categories.js";
// ...
app.use("/categories", categoriesRouter);
```

- [ ] **Step 5: Run test to verify it passes, then run the full suite**

```bash
cd backend && npm test -- categories.test.ts
cd backend && npm test
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/categories.ts backend/src/routes/categories.test.ts backend/src/app.ts
git commit -m "feat: categories list route, needed by the add-transaction form"
```

---

## Self-Review Notes

- **Spec coverage:** §5 registration/onboarding (Tasks 12, 14), §6 transaction lifecycle for expense/income/transfer (Task 15 — refund/installments explicitly deferred per scope), §7 IA (currencies + accounts + categories + transactions routes back the Assets/Transactions screens; Analytics/Plans deferred), §8 derived values (balances Task 8, FX Task 9, summary Task 15), conventions in §2 (UUID v7 via `newId()`, minor-units `bigint` throughout, positive-amount invariant enforced, soft-delete filtering on every query, `user_id` scoping on every query). §9 (recurring) and §11 (deferred items) are out of scope by design. Task 16 (categories list) was added after drafting the frontend plan revealed the add-transaction form has no way to pick a `category_id` without it.
- **Placeholder scan:** every step has real, runnable code; no TBD/TODO markers.
- **Type consistency:** `recomputeAccountBalance(client, accountId)` signature matches its Task 8 definition and its Task 15 call sites. `convert(db, amountMinor, from, to, onDate, decimalsByCode)` signature matches between Task 9 and its Task 15 call site. `formatMinor`/`parseToMinor` signatures match between Task 5 and their Task 14/15 call sites.
