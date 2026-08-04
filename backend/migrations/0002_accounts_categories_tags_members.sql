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
