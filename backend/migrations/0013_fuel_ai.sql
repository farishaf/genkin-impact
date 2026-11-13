-- Fuel AI inputs: every model call is logged here (cost, latency, outcome) and its result is cached by key,
-- so the same image or text is never sent twice and the monthly spend cap is a plain SUM.
-- No images and no prompts are stored: only the validated result the user then confirms or edits.
CREATE TABLE ai_calls (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  task TEXT NOT NULL CHECK (task IN ('scale', 'label', 'meal', 'text')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens_in INT NOT NULL DEFAULT 0,
  tokens_out INT NOT NULL DEFAULT 0,
  cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  latency_ms INT NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'invalid', 'error')),
  -- sha256 of the image bytes, or of the normalised text.
  cache_key TEXT NOT NULL,
  result JSONB
);

CREATE INDEX ai_calls_user_ts_idx ON ai_calls (user_id, ts);
CREATE INDEX ai_calls_cache_idx ON ai_calls (user_id, task, cache_key) WHERE outcome = 'ok';
