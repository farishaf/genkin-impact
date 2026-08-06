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
