CREATE TABLE installment_plans (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  origin_transaction_id UUID NOT NULL REFERENCES transactions(id),
  total_amount BIGINT NOT NULL CHECK (total_amount > 0),
  installment_count INT NOT NULL CHECK (installment_count >= 2),
  interval_unit TEXT NOT NULL CHECK (interval_unit IN ('month', 'week')),
  fee_amount BIGINT NOT NULL DEFAULT 0,
  first_due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'canceled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX installment_plans_user_idx ON installment_plans (user_id);

ALTER TABLE transactions
  ADD CONSTRAINT transactions_installment_plan_id_fkey
  FOREIGN KEY (installment_plan_id) REFERENCES installment_plans(id);
