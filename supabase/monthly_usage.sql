-- Add monthly usage tracking to profiles
-- Run this in Supabase SQL Editor

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS monthly_usage     INTEGER   DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monthly_reset_at  TIMESTAMPTZ DEFAULT NOW();

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS profiles_monthly_reset_idx ON profiles(monthly_reset_at);
