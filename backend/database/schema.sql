-- ACH Payment & Positive Pay AI Triage System
-- Database Schema

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- ============================================================
-- TRANSACTIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id TEXT UNIQUE NOT NULL,
  sec_code TEXT NOT NULL DEFAULT 'PPD', -- PPD, CCD, WEB, TEL, IAT, etc.
  company_name TEXT NOT NULL,
  company_id TEXT NOT NULL,
  amount REAL NOT NULL,
  transaction_type TEXT NOT NULL DEFAULT 'debit', -- credit | debit
  account_number TEXT NOT NULL,
  routing_number TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  entry_description TEXT,
  individual_name TEXT,
  trace_number TEXT,
  originator TEXT NOT NULL DEFAULT 'SYSTEM',
  
  -- Risk assessment
  risk_level INTEGER NOT NULL DEFAULT 1, -- 1, 2, or 3
  risk_score REAL NOT NULL DEFAULT 0.0, -- 0-100
  risk_flags TEXT NOT NULL DEFAULT '[]', -- JSON array of flag objects
  
  -- AI processing
  ai_brief TEXT, -- AI-generated summary for Level 2/3
  compliance_notes TEXT, -- AI-generated compliance notes for Level 1
  ai_recommendation TEXT, -- approve | decline | review
  ai_confidence REAL DEFAULT 0.0, -- 0-100
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending', -- pending | auto_approved | approved | declined | under_review
  reviewer_id TEXT,
  reviewer_decision TEXT,
  reviewer_notes TEXT,
  decision_at TEXT,
  
  -- Positive Pay specific
  is_positive_pay BOOLEAN DEFAULT 0,
  check_number TEXT,
  payee_name TEXT,
  
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- RISK RULES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS risk_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_code TEXT UNIQUE NOT NULL,
  rule_name TEXT NOT NULL,
  rule_category TEXT NOT NULL, -- amount, velocity, account, counterparty, compliance, pattern
  description TEXT,
  condition_logic TEXT NOT NULL, -- JSON describing condition
  flag_level INTEGER NOT NULL DEFAULT 2, -- 1, 2, or 3
  weight REAL NOT NULL DEFAULT 1.0,
  is_active BOOLEAN DEFAULT 1,
  trigger_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- HUMAN DECISIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS human_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id TEXT NOT NULL,
  reviewer_id TEXT NOT NULL DEFAULT 'reviewer_01',
  reviewer_name TEXT NOT NULL DEFAULT 'Risk Analyst',
  decision TEXT NOT NULL, -- approve | decline
  decision_reason TEXT,
  risk_level_at_decision INTEGER NOT NULL,
  risk_score_at_decision REAL NOT NULL,
  risk_flags_at_decision TEXT NOT NULL DEFAULT '[]',
  ai_recommendation_at_decision TEXT,
  ai_confidence_at_decision REAL,
  time_to_decide_seconds REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (transaction_id) REFERENCES transactions(transaction_id)
);

-- ============================================================
-- LEARNING PATTERNS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS learning_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern_hash TEXT UNIQUE NOT NULL,
  pattern_description TEXT NOT NULL,
  feature_vector TEXT NOT NULL, -- JSON: key features that define this pattern
  sec_codes TEXT DEFAULT '[]', -- JSON array of applicable SEC codes
  amount_range_min REAL,
  amount_range_max REAL,
  
  -- Decision tracking
  total_decisions INTEGER DEFAULT 0,
  approve_count INTEGER DEFAULT 0,
  decline_count INTEGER DEFAULT 0,
  confidence_score REAL DEFAULT 0.0, -- approve_count / total_decisions
  
  -- Promotion status
  promoted_to_level1 BOOLEAN DEFAULT 0,
  promotion_date TEXT,
  promotion_reason TEXT,
  min_decisions_required INTEGER DEFAULT 10,
  confidence_threshold REAL DEFAULT 0.85,
  
  -- Safety
  is_frozen BOOLEAN DEFAULT 0, -- admin override to prevent auto-promotion
  demotion_count INTEGER DEFAULT 0, -- times this pattern was demoted
  
  last_updated TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- AUDIT LOGS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id TEXT,
  event_type TEXT NOT NULL, -- transaction_created | risk_flagged | ai_processed | auto_approved | human_reviewed | pattern_promoted | rule_updated
  event_summary TEXT NOT NULL,
  event_data TEXT NOT NULL DEFAULT '{}', -- JSON
  actor TEXT NOT NULL DEFAULT 'AI', -- AI | HUMAN | SYSTEM
  actor_id TEXT,
  severity TEXT DEFAULT 'info', -- info | warning | critical
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- SYSTEM METRICS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS system_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  metric_date TEXT NOT NULL,
  total_transactions INTEGER DEFAULT 0,
  auto_approved INTEGER DEFAULT 0,
  human_reviewed INTEGER DEFAULT 0,
  declined INTEGER DEFAULT 0,
  level1_count INTEGER DEFAULT 0,
  level2_count INTEGER DEFAULT 0,
  level3_count INTEGER DEFAULT 0,
  avg_review_time_seconds REAL DEFAULT 0,
  ai_accuracy_rate REAL DEFAULT 0,
  patterns_promoted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_risk_level ON transactions(risk_level);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_transaction ON audit_logs(transaction_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_human_decisions_transaction ON human_decisions(transaction_id);
