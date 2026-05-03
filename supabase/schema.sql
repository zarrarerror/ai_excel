-- ============================================================
-- Shayntech Excel AI Pro — Supabase Database Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Profiles table (one row per user)
CREATE TABLE IF NOT EXISTS profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                  TEXT,
  lifetime_usage         INTEGER DEFAULT 0,
  is_pro                 BOOLEAN DEFAULT FALSE,
  lemon_subscription_id  TEXT,
  lemon_customer_email   TEXT,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);

-- Pending activations (when someone pays before creating an account)
CREATE TABLE IF NOT EXISTS pending_activations (
  id              SERIAL PRIMARY KEY,
  email           TEXT UNIQUE,
  subscription_id TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-update updated_at on profiles
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Row Level Security: users can only read their own profile
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Service role (backend) bypasses RLS automatically
-- These policies are for the anon/authenticated roles if you use them
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- ============================================================
-- Optional: view for easy monitoring in Supabase dashboard
-- ============================================================
CREATE OR REPLACE VIEW user_stats AS
SELECT
  p.email,
  p.lifetime_usage,
  p.is_pro,
  p.lemon_subscription_id,
  p.created_at
FROM profiles p
ORDER BY p.created_at DESC;
