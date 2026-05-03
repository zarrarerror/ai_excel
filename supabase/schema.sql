-- ============================================================
-- Shayntech Excel AI Pro — Supabase Database Schema
-- Safe to run multiple times (idempotent)
-- ============================================================

-- Profiles table (one row per user)
CREATE TABLE IF NOT EXISTS profiles (
  id                     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
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

-- ── FIX 1: search_path set explicitly to prevent Supabase security warning ──
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ── FIX 2: DROP TRIGGER IF EXISTS before CREATE to avoid "already exists" warning ──
DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- ── FIX 3: DROP POLICY IF EXISTS before CREATE to avoid duplicate policy warning ──
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- ── FIX 4: security_invoker = true so view respects RLS (Supaba