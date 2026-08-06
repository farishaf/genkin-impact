CREATE TABLE budgets (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  category_id UUID REFERENCES categories(id),
  name TEXT NOT NULL,
  limit_amount BIGINT NOT NULL CHECK (limit_amount > 0),
  currency_code CHAR(3) NOT NULL REFERENCES currencies(code),
  period TEXT NOT NULL CHECK (period IN ('weekly', 'monthly', 'quarterly', 'yearly')),
  start_date DATE NOT NULL,
  rollover_unused BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX budgets_user_active_idx ON budgets (user_id, is_active);

CREATE TABLE savings_goals (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  account_id UUID REFERENCES accounts(id),
  name TEXT NOT NULL,
  emoji TEXT,
  target_amount BIGINT NOT NULL CHECK (target_amount > 0),
  contributed_amount BIGINT NOT NULL DEFAULT 0,
  currency_code CHAR(3) NOT NULL REFERENCES currencies(code),
  target_date DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'achieved', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX savings_goals_user_status_idx ON savings_goals (user_id, status);

CREATE TABLE recurring_rules (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  txn_type TEXT NOT NULL CHECK (txn_type IN ('expense', 'income', 'transfer')),
  account_id UUID NOT NULL REFERENCES accounts(id),
  to_account_id UUID REFERENCES accounts(id),
  category_id UUID REFERENCES categories(id),
  member_id UUID REFERENCES members(id),
  amount BIGINT NOT NULL CHECK (amount > 0),
  currency_code CHAR(3) NOT NULL REFERENCES currencies(code),
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
  interval_count INT NOT NULL DEFAULT 1 CHECK (interval_count > 0),
  day_of_month SMALLINT,
  day_of_week SMALLINT,
  starts_on DATE NOT NULL,
  ends_on DATE,
  next_run_at TIMESTAMPTZ NOT NULL,
  last_run_at TIMESTAMPTZ,
  auto_post BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX recurring_rules_active_next_run_idx ON recurring_rules (is_active, next_run_at);
CREATE INDEX recurring_rules_user_idx ON recurring_rules (user_id);
