-- ============================================================
-- ACH Triage AI System — Supabase Database Setup
-- Run this entire script in Supabase SQL Editor ONCE
-- Supabase Console → SQL Editor → New Query → Paste → Run
-- ============================================================

-- Each table stores documents as JSONB in a 'data' column.
-- This gives us the same flexible schema as the original JSON file.
-- _doc_key is the natural key (transaction_id, user_id, etc.)

-- ── Core function: auto-update updated_at timestamp ─────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Transactions ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  _id         BIGSERIAL PRIMARY KEY,
  _doc_key    TEXT UNIQUE,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transactions_doc_key ON transactions(_doc_key);
CREATE INDEX IF NOT EXISTS idx_transactions_status  ON transactions((data->>'status'));
CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at DESC);

-- ── Risk Rules ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS risk_rules (
  _id         BIGSERIAL PRIMARY KEY,
  _doc_key    TEXT UNIQUE,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_risk_rules_doc_key ON risk_rules(_doc_key);

-- ── Return Codes ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS return_codes (
  _id         BIGSERIAL PRIMARY KEY,
  _doc_key    TEXT UNIQUE,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_return_codes_doc_key ON return_codes(_doc_key);

-- ── Users ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  _id         BIGSERIAL PRIMARY KEY,
  _doc_key    TEXT UNIQUE,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_doc_key  ON users(_doc_key);
CREATE INDEX IF NOT EXISTS idx_users_username ON users((data->>'username'));

-- ── Audit Logs ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  _id         BIGSERIAL PRIMARY KEY,
  _doc_key    TEXT UNIQUE,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_doc_key ON audit_logs(_doc_key);
CREATE INDEX IF NOT EXISTS idx_audit_logs_txn     ON audit_logs((data->>'transaction_id'));
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

-- ── Human Decisions ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS human_decisions (
  _id         BIGSERIAL PRIMARY KEY,
  _doc_key    TEXT UNIQUE,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_human_decisions_doc_key ON human_decisions(_doc_key);

-- ── Review Decisions ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS review_decisions (
  _id         BIGSERIAL PRIMARY KEY,
  _doc_key    TEXT UNIQUE,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_review_decisions_doc_key ON review_decisions(_doc_key);

-- ── Learning Patterns ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS learning_patterns (
  _id         BIGSERIAL PRIMARY KEY,
  _doc_key    TEXT UNIQUE,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_learning_patterns_doc_key ON learning_patterns(_doc_key);

-- ── Batch Jobs ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS batch_jobs (
  _id         BIGSERIAL PRIMARY KEY,
  _doc_key    TEXT UNIQUE,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_doc_key ON batch_jobs(_doc_key);

-- ── Accounts ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
  _id         BIGSERIAL PRIMARY KEY,
  _doc_key    TEXT UNIQUE,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_accounts_doc_key ON accounts(_doc_key);

-- ── ACL Filter Rules ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS acl_filter_rules (
  _id         BIGSERIAL PRIMARY KEY,
  _doc_key    TEXT UNIQUE,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_acl_filter_rules_doc_key ON acl_filter_rules(_doc_key);

-- ── Check Register ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS check_register (
  _id         BIGSERIAL PRIMARY KEY,
  _doc_key    TEXT UNIQUE,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_check_register_doc_key ON check_register(_doc_key);

-- ── Disable RLS on all tables (backend-only access via service key) ──
ALTER TABLE transactions     DISABLE ROW LEVEL SECURITY;
ALTER TABLE risk_rules       DISABLE ROW LEVEL SECURITY;
ALTER TABLE return_codes     DISABLE ROW LEVEL SECURITY;
ALTER TABLE users            DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs       DISABLE ROW LEVEL SECURITY;
ALTER TABLE human_decisions  DISABLE ROW LEVEL SECURITY;
ALTER TABLE review_decisions DISABLE ROW LEVEL SECURITY;
ALTER TABLE learning_patterns DISABLE ROW LEVEL SECURITY;
ALTER TABLE batch_jobs       DISABLE ROW LEVEL SECURITY;
ALTER TABLE accounts         DISABLE ROW LEVEL SECURITY;
ALTER TABLE acl_filter_rules DISABLE ROW LEVEL SECURITY;
ALTER TABLE check_register   DISABLE ROW LEVEL SECURITY;

-- ✅ Setup complete! All 12 tables created.
SELECT 'ACH Triage AI — Supabase setup complete ✅' AS status;
