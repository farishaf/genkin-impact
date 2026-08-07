CREATE TABLE attachments (
  id UUID PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  storage_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX attachments_transaction_idx ON attachments (transaction_id);
