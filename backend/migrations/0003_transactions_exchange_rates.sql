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
