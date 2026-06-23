-- ============================================================
-- ACH Triage AI System — Supabase Database Setup
-- VERSION: 4.0 (MIR + Autonomous Workflow)
--
-- HOW TO RUN:
--   Supabase Console → SQL Editor → New Query → Paste → Run
--
-- SAFE TO RE-RUN:
--   Every statement uses IF NOT EXISTS / CREATE OR REPLACE
--   so running this on an existing database will not destroy data.
--
-- TABLES (14 total):
--   Original (12): transactions, risk_rules, return_codes, users,
--                  audit_logs, human_decisions, review_decisions,
--                  learning_patterns, batch_jobs, accounts,
--                  acl_filter_rules, check_register
--   Added (2):     info_requests, transaction_lifecycles
-- ============================================================

-- ── Core trigger function: auto-update updated_at ─────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- ORIGINAL TABLES
-- ============================================================

-- ── Transactions ─────────────────────────────────────────────
-- Stores every ACH transaction with full NACHA fields.
-- Key status values:
--   pending | under_review | more_info_required | ai_workflow |
--   auto_approved | approved | declined
-- MIR fields (added v4.0):
--   resubmission_count, info_request_rounds, last_info_request_id,
--   previous_status, ai_workflow_pattern, ai_human_override,
--   ai_workflow_started, ai_escalation_reason, originator_email
CREATE TABLE IF NOT EXISTS transactions (
  _id         BIGSERIAL PRIMARY KEY,
  _doc_key    TEXT UNIQUE,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transactions_doc_key    ON transactions(_doc_key);
CREATE INDEX IF NOT EXISTS idx_transactions_status     ON transactions((data->>'status'));
CREATE INDEX IF NOT EXISTS idx_transactions_created    ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_company    ON transactions((data->>'company_id'));
CREATE INDEX IF NOT EXISTS idx_transactions_sec_code   ON transactions((data->>'sec_code'));

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_transactions_updated_at') THEN
    CREATE TRIGGER trg_transactions_updated_at
      BEFORE UPDATE ON transactions
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;


-- ── Risk Rules ───────────────────────────────────────────────
-- NACHA risk rules evaluated against every transaction.
CREATE TABLE IF NOT EXISTS risk_rules (
  _id         BIGSERIAL PRIMARY KEY,
  _doc_key    TEXT UNIQUE,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_risk_rules_doc_key ON risk_rules(_doc_key);
ALTER TABLE risk_rules DISABLE ROW LEVEL SECURITY;


-- ── Return Codes ─────────────────────────────────────────────
-- NACHA ACH return reason codes (R01–R85).
CREATE TABLE IF NOT EXISTS return_codes (
  _id         BIGSERIAL PRIMARY KEY,
  _doc_key    TEXT UNIQUE,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_return_codes_doc_key ON return_codes(_doc_key);
ALTER TABLE return_codes DISABLE ROW LEVEL SECURITY;


-- ── Users ────────────────────────────────────────────────────
-- Internal admin users only. Originators never get a user record —
-- they access the system only via time-limited portal tokens.
CREATE TABLE IF NOT EXISTS users (
  _id         BIGSERIAL PRIMARY KEY,
  _doc_key    TEXT UNIQUE,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_doc_key  ON users(_doc_key);
CREATE INDEX IF NOT EXISTS idx_users_username ON users((data->>'username'));
ALTER TABLE users DISABLE ROW LEVEL SECURITY;


-- ── Audit Logs ───────────────────────────────────────────────
-- Every state transition is written here.
-- actor values:
--   'SYSTEM'        — automated system events
--   'AI'            — AI brief generation and pattern promotion
--   'AI_AUTOMATION' — autonomous workflow decisions (v4.0)
--   'HUMAN'         — reviewer decisions
--   'ORIGINATOR'    — originator portal responses (v4.0)
CREATE TABLE IF NOT EXISTS audit_logs (
  _id         BIGSERIAL PRIMARY KEY,
  _doc_key    TEXT UNIQUE,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_doc_key  ON audit_logs(_doc_key);
CREATE INDEX IF NOT EXISTS idx_audit_logs_txn      ON audit_logs((data->>'transaction_id'));
CREATE INDEX IF NOT EXISTS idx_audit_logs_created  ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor    ON audit_logs((data->>'actor'));
CREATE INDEX IF NOT EXISTS idx_audit_logs_event    ON audit_logs((data->>'event_type'));
ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY;


-- ── Human Decisions ──────────────────────────────────────────
-- Lightweight record of every human approve/decline (legacy table).
-- review_decisions holds the richer version.
CREATE TABLE IF NOT EXISTS human_decisions (
  _id         BIGSERIAL PRIMARY KEY,
  _doc_key    TEXT UNIQUE,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_human_decisions_doc_key ON human_decisions(_doc_key);
CREATE INDEX IF NOT EXISTS idx_human_decisions_txn     ON human_decisions((data->>'transaction_id'));
ALTER TABLE human_decisions DISABLE ROW LEVEL SECURITY;


-- ── Review Decisions ─────────────────────────────────────────
-- Rich decision record: identity verification, fraud indicators,
-- business purpose, return code, reviewer confidence, time-to-decide.
-- Also used by AI_AUTOMATION for autonomous approve/decline (v4.0).
-- Field: ai_automation BOOLEAN — true when written by AI_AUTOMATION.
CREATE TABLE IF NOT EXISTS review_decisions (
  _id         BIGSERIAL PRIMARY KEY,
  _doc_key    TEXT UNIQUE,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_review_decisions_doc_key ON review_decisions(_doc_key);
CREATE INDEX IF NOT EXISTS idx_review_decisions_txn     ON review_decisions((data->>'transaction_id'));
CREATE INDEX IF NOT EXISTS idx_review_decisions_decision ON review_decisions((data->>'decision'));
ALTER TABLE review_decisions DISABLE ROW LEVEL SECURITY;


-- ── Learning Patterns ────────────────────────────────────────
-- One record per unique transaction fingerprint (pattern_hash).
-- The AI learns from every human decision on a pattern.
-- Promotion criteria: ≥5 unique transactions, ≥85% confidence.
--
-- Key fields (v4.0 additions):
--   mir_count              — how many transactions needed MIR
--   mir_category_counts    — JSONB frequency map of MIR categories
--   avg_rounds_to_resolve  — average MIR rounds before terminal decision
--   learned_qa_pairs       — JSONB array of request/response training examples
--   workflow_playbook      — JSONB distilled workflow for autonomous execution
--   ai_automation          — true once promoted with a workflow_playbook
CREATE TABLE IF NOT EXISTS learning_patterns (
  _id         BIGSERIAL PRIMARY KEY,
  _doc_key    TEXT UNIQUE,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_learning_patterns_doc_key   ON learning_patterns(_doc_key);
CREATE INDEX IF NOT EXISTS idx_learning_patterns_hash      ON learning_patterns((data->>'pattern_hash'));
CREATE INDEX IF NOT EXISTS idx_learning_patterns_promoted  ON learning_patterns((data->>'promoted_to_level1'));
ALTER TABLE learning_patterns DISABLE ROW LEVEL SECURITY;


-- ── Batch Jobs ───────────────────────────────────────────────
-- Tracks bulk NACHA file upload processing jobs.
CREATE TABLE IF NOT EXISTS batch_jobs (
  _id         BIGSERIAL PRIMARY KEY,
  _doc_key    TEXT UNIQUE,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_doc_key ON batch_jobs(_doc_key);
ALTER TABLE batch_jobs DISABLE ROW LEVEL SECURITY;


-- ── Accounts ─────────────────────────────────────────────────
-- Bank account records with Positive Pay filters and ACH rules.
CREATE TABLE IF NOT EXISTS accounts (
  _id         BIGSERIAL PRIMARY KEY,
  _doc_key    TEXT UNIQUE,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_accounts_doc_key ON accounts(_doc_key);
ALTER TABLE accounts DISABLE ROW LEVEL SECURITY;


-- ── ACL Filter Rules ─────────────────────────────────────────
-- Per-account ACH filter rules (whitelist/blacklist/block/allow).
CREATE TABLE IF NOT EXISTS acl_filter_rules (
  _id         BIGSERIAL PRIMARY KEY,
  _doc_key    TEXT UNIQUE,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_acl_filter_rules_doc_key ON acl_filter_rules(_doc_key);
ALTER TABLE acl_filter_rules DISABLE ROW LEVEL SECURITY;


-- ── Check Register ───────────────────────────────────────────
-- Issued check register for Positive Pay matching.
CREATE TABLE IF NOT EXISTS check_register (
  _id         BIGSERIAL PRIMARY KEY,
  _doc_key    TEXT UNIQUE,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_check_register_doc_key ON check_register(_doc_key);
ALTER TABLE check_register DISABLE ROW LEVEL SECURITY;


-- ============================================================
-- NEW TABLES — v4.0 MIR + AUTONOMOUS WORKFLOW
-- ============================================================

-- ── Info Requests ────────────────────────────────────────────
-- One record per MIR round, whether initiated by a human reviewer
-- or by AI_AUTOMATION.
--
-- Key fields:
--   request_id       — MIR-XXXXXXXX identifier
--   transaction_id   — parent transaction
--   round_number     — 1, 2, 3… (no hard cap, configurable escalation)
--   actor_type       — 'HUMAN' | 'AI_AUTOMATION'
--   category         — one of 8 MIR categories
--   message          — what was asked (shown to originator in portal)
--   portal_token     — 64-char hex token (single-use, time-limited)
--   token_expires_at — configurable (default 72 hours)
--   sla_deadline_at  — configurable (default 48 hours)
--   status           — pending | responded | expired | cancelled
--   response_message — originator's submitted response
--   link_opened_at   — when originator first opened the portal link
--   pattern_hash     — which pattern triggered this (AI_AUTOMATION only)
--
-- SECURITY: portal_token is never returned to the admin UI —
-- only to the email sender and the public portal endpoint.
CREATE TABLE IF NOT EXISTS info_requests (
  _id         BIGSERIAL PRIMARY KEY,
  _doc_key    TEXT UNIQUE,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_info_requests_doc_key   ON info_requests(_doc_key);
CREATE INDEX IF NOT EXISTS idx_info_requests_txn       ON info_requests((data->>'transaction_id'));
CREATE INDEX IF NOT EXISTS idx_info_requests_token     ON info_requests((data->>'portal_token'));
CREATE INDEX IF NOT EXISTS idx_info_requests_status    ON info_requests((data->>'status'));
CREATE INDEX IF NOT EXISTS idx_info_requests_actor     ON info_requests((data->>'actor_type'));

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_info_requests_updated_at') THEN
    CREATE TRIGGER trg_info_requests_updated_at
      BEFORE UPDATE ON info_requests
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

ALTER TABLE info_requests DISABLE ROW LEVEL SECURITY;


-- ── Transaction Lifecycles ───────────────────────────────────
-- The AI training corpus. One record per transaction that goes
-- through a human or AI-autonomous MIR workflow.
--
-- Built in real time as the workflow progresses:
--   startLifecycle()         — creates the record on transaction intake
--   recordLifecycleRequest() — appends each info request step
--   recordLifecycleResponse()— appends each originator response step
--   finaliseLifecycle()      — seals the record and triggers learning
--
-- Key fields:
--   lifecycle_id          — LC-{transaction_id}
--   transaction_id        — parent transaction
--   pattern_hash          — which pattern this lifecycle belongs to
--   lifecycle_status      — in_progress | complete
--   actor_type            — 'HUMAN' | 'AI_AUTOMATION'
--   transaction_snapshot  — JSONB snapshot of key transaction fields at intake
--   steps                 — JSONB array of all actions in order:
--                           { step, actor, action, round, category,
--                             message, response_message, decision, timestamp }
--   final_decision        — approve | decline
--   final_actor           — HUMAN | AI_AUTOMATION
--   total_rounds          — number of MIR rounds completed
--   completed_at          — when the terminal decision was made
--
-- The 'steps' array is what the AI reads when evaluating a new
-- originator response — it contains all past examples of what
-- was asked, what was answered, and what decision followed.
CREATE TABLE IF NOT EXISTS transaction_lifecycles (
  _id         BIGSERIAL PRIMARY KEY,
  _doc_key    TEXT UNIQUE,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lifecycles_doc_key   ON transaction_lifecycles(_doc_key);
CREATE INDEX IF NOT EXISTS idx_lifecycles_txn       ON transaction_lifecycles((data->>'transaction_id'));
CREATE INDEX IF NOT EXISTS idx_lifecycles_pattern   ON transaction_lifecycles((data->>'pattern_hash'));
CREATE INDEX IF NOT EXISTS idx_lifecycles_status    ON transaction_lifecycles((data->>'lifecycle_status'));
CREATE INDEX IF NOT EXISTS idx_lifecycles_actor     ON transaction_lifecycles((data->>'actor_type'));

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lifecycles_updated_at') THEN
    CREATE TRIGGER trg_lifecycles_updated_at
      BEFORE UPDATE ON transaction_lifecycles
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

ALTER TABLE transaction_lifecycles DISABLE ROW LEVEL SECURITY;


-- ── Chat Sessions ─────────────────────────────────────────
-- Each row is one saved conversation per user.
-- Key fields: session_id, user_id, title, message_count, last_message_at
CREATE TABLE IF NOT EXISTS chat_sessions (
  _id         BIGSERIAL PRIMARY KEY,
  _doc_key    TEXT UNIQUE,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_doc_key ON chat_sessions(_doc_key);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user    ON chat_sessions((data->>'user_id'));
CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at DESC);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_chat_sessions_updated_at') THEN
    CREATE TRIGGER trg_chat_sessions_updated_at
      BEFORE UPDATE ON chat_sessions
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

ALTER TABLE chat_sessions DISABLE ROW LEVEL SECURITY;

-- ── Chat Messages ─────────────────────────────────────────
-- Each row is one message (user or bot) within a session.
-- Key fields: session_id, user_id, role, content, source, timestamp
CREATE TABLE IF NOT EXISTS chat_messages (
  _id         BIGSERIAL PRIMARY KEY,
  _doc_key    TEXT UNIQUE,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_doc_key ON chat_messages(_doc_key);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages((data->>'session_id'));
CREATE INDEX IF NOT EXISTS idx_chat_messages_ts      ON chat_messages((data->>'timestamp'));

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_chat_messages_updated_at') THEN
    CREATE TRIGGER trg_chat_messages_updated_at
      BEFORE UPDATE ON chat_messages
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

ALTER TABLE chat_messages DISABLE ROW LEVEL SECURITY;


-- ============================================================
-- COMPLETION
-- ============================================================
SELECT
  '✅ ACH Triage AI v4.0 — Database setup complete' AS status,
  16 AS total_tables,
  'transactions, risk_rules, return_codes, users, audit_logs, human_decisions, review_decisions, learning_patterns, batch_jobs, accounts, acl_filter_rules, check_register, info_requests, transaction_lifecycles, chat_sessions, chat_messages' AS tables;