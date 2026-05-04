-- Token usage logs table (run this in Supabase SQL Editor)
CREATE TABLE IF NOT EXISTS token_logs (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID REFERENCES profiles(id) ON DELETE CASCADE,
  model         TEXT NOT NULL,
  input_tokens  INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost_usd      NUMERIC(10,6) DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast admin queries
CREATE INDEX IF NOT EXISTS token_logs_user_id_idx ON token_logs(user_id);
CREATE INDEX IF NOT EXISTS token_logs_created_at_idx ON token_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS token_logs_model_idx ON token_logs(model);

-- RLS: only backend (service_role) can insert/read
ALTER TABLE token_logs ENABLE ROW LEVEL SECURITY;

-- Admins (service role bypasses RLS automatically)
-- Users cannot read their own token logs (privacy)
