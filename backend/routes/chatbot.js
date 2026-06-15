// backend/routes/chatbot.js — Intelligent ACH Chatbot: Natural LLM + Approve/Reject + CRUD
const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, insert, update, remove } = require('../database/db');
const { getLearningStats }   = require('../services/learningPipeline');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { scoreTransaction }   = require('../services/riskEngine');
const { generateComplianceNotes, generateReviewBrief } = require('../services/aiTriage');
const { recordDecision } = require('../services/learningPipeline');

// ── Gemini LLM (same model as aiTriage.js) ────────────────────────────────────
let geminiModel = null;
function initLLM() {
  const key = process.env.GEMINI_API_KEY;
  if (key && key !== 'YOUR_GEMINI_API_KEY') {
    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(key);
      geminiModel = genAI.getGenerativeModel({
        model: 'gemini-3.1-flash-lite',
        generationConfig: { temperature: 0.75, topP: 0.9, maxOutputTokens: 2048 }
      });
      console.log('[Chatbot] Gemini initialized');
    } catch (e) {
      console.warn('[Chatbot] Gemini init failed:', e.message);
    }
  }
}
initLLM();

async function callGemini(prompt) {
  if (!geminiModel) initLLM();
  if (geminiModel) {
    try {
      const result = await geminiModel.generateContent(prompt);
      return result.response.text();
    } catch (e) {
      console.warn('[Chatbot] Gemini error:', e.message);
    }
  }
  return contextualFallback(prompt);
}

// ── Contextual fallback (extracts real numbers from injected context) ─────────
function contextualFallback(prompt) {
  const p = prompt;
  const get = (rx) => { const m = p.match(rx); return m ? m[1] : '?'; };
  const total    = get(/Total Transactions:\s*(\d+)/);
  const pending  = get(/Under Review.*?:\s*(\d+)/);
  const volume   = get(/Total Volume:\s*\$([^\n]+)/);
  const autoRate = get(/(\d+)% auto-resolution/);
  const l3       = get(/L3\(High\)=(\d+)/);
  const avgRisk  = get(/Average Risk Score:\s*([\d.]+)/);

  const q = prompt.toLowerCase();
  if (q.includes('txn-') && p.includes('FULL DETAILS FOR')) {
    const id = p.match(/FULL DETAILS FOR (TXN-[A-Z0-9]+)/);
    return 'Here are the complete details for **' + (id ? id[1] : 'that transaction') + '** pulled directly from the live database.';
  }
  if (q.includes('approve') || q.includes('reject') || q.includes('decline')) {
    return 'To approve or reject a transaction through chat, just say:\n- **"approve TXN-XXXXXXXX"** or **"reject TXN-XXXXXXXX"**\n\nI\'ll handle the rest and update the system in real time.';
  }
  if (q.includes('total') || q.includes('how many') || q.includes('count')) {
    return 'There are currently **' + total + '** transactions in the system — **' + pending + '** are under review and the auto-resolution rate is **' + autoRate + '%**.';
  }
  if (q.includes('volume') || q.includes('dollar')) {
    return 'The total transaction volume processed is **$' + volume.trim() + '** across **' + total + '** transactions.';
  }
  if (q.includes('risk') || q.includes('level 3') || q.includes('high')) {
    return 'There are **' + l3 + '** high-risk (Level 3) transactions requiring immediate attention. Average risk score is **' + avgRisk + '/100**.';
  }
  if (q.includes('nacha')) {
    return 'NACHA (National Automated Clearing House Association) is the governing body for ACH electronic fund transfers in the US. This system enforces NACHA rules including SEC code validation, Mod-10 ABA routing checks, 5-day advance dating windows, and proper return code handling.';
  }
  if (q.includes('sec code')) {
    return 'SEC Codes classify ACH transaction types:\n- **PPD** — Prearranged Payment & Deposit (consumer)\n- **CCD** — Corporate Credit or Debit\n- **WEB** — Internet-initiated\n- **IAT** — International ACH\n- **TEL** — Telephone-initiated\n\nAll are validated on every incoming transaction.';
  }
  return 'I\'m your ACH AI assistant with live system access. You can ask about transactions, risk levels, approve/reject transactions, or anything about NACHA compliance. How can I help?';
}

// ── Extract TXN IDs from message ─────────────────────────────────────────────
function extractTxnIds(text) {
  const matches = text.toUpperCase().match(/TXN-[A-Z0-9]{6,12}/g);
  return matches ? [...new Set(matches)] : [];
}

// ── Detect approve/reject/decision intent ─────────────────────────────────────
function detectDecisionIntent(message) {
  const m = message.toLowerCase();
  const txnIds = extractTxnIds(message);

  const approveMatch = /\b(approve|accept|okay|ok|confirm|process)\b/i.test(m);
  const rejectMatch  = /\b(reject|decline|deny|refuse|cancel|block)\b/i.test(m);

  if (txnIds.length > 0) {
    if (approveMatch) return { action: 'approve', txnIds };
    if (rejectMatch)  return { action: 'decline', txnIds };
  }

  if (approveMatch && (m.includes('transaction') || m.includes('it') || m.includes('this') || m.includes('that'))) {
    return { action: 'approve', txnIds: [] };
  }
  if (rejectMatch && (m.includes('transaction') || m.includes('it') || m.includes('this') || m.includes('that'))) {
    return { action: 'decline', txnIds: [] };
  }

  return null;
}

// ── Detect user creation intent ──────────────────────────────────────────────
function detectUserCreationIntent(message) {
  const m = message.toLowerCase();
  const createMatch = /\b(create|add|new|make)\s+(a\s+)?(user|account)\b/i.test(m);
  if (!createMatch) return null;

  const emailMatch = m.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/);
  if (!emailMatch) return null;

  let role = 'reviewer';
  if (m.includes('admin')) role = 'admin';
  else if (m.includes('supervisor')) role = 'supervisor';
  else if (m.includes('analyst')) role = 'analyst';

  const email = emailMatch[1];
  const username = email.split('@')[0];
  return { email, role, username, full_name: username };
}

// ── Format transaction detail string for LLM context (ASYNC) ─────────────────
async function txnDetailForContext(t) {
  if (!t) return null;
  const auditLogs = await queryAll('audit_logs', l => l.transaction_id === t.transaction_id,
    { orderBy: 'created_at', desc: true, limit: 5 });
  const flags = (t.risk_flags || []).map(f =>
    '    [' + (f.severity || 'INFO').toUpperCase() + '] ' + f.rule_name + ': ' + f.description
  ).join('\n') || '    None';
  const audit = (Array.isArray(auditLogs) ? auditLogs : [])
    .map(l => '    ' + l.actor + ': ' + l.event_summary).join('\n') || '    None';
  return [
    'Transaction ID   : ' + t.transaction_id,
    'Company          : ' + (t.company_name || 'N/A'),
    'Amount           : $' + Number(t.amount).toLocaleString(undefined, { minimumFractionDigits: 2 }),
    'Type / SEC Code  : ' + (t.transaction_type || 'N/A') + ' / ' + (t.sec_code || 'N/A'),
    'Status           : ' + t.status,
    'Risk Level       : Level ' + t.risk_level + ' (Score: ' + (t.risk_score ?? 'N/A') + '/100)',
    'Routing Number   : ' + (t.routing_number || t.rdfi_routing || 'N/A'),
    'Account Number   : ' + (t.account_number || 'N/A'),
    'Effective Date   : ' + (t.effective_date || 'N/A'),
    'OFAC Screened    : ' + (t.ofac_screened ? 'Yes' : 'No'),
    'AML Flag         : ' + (t.aml_flag ? 'YES - FLAGGED' : 'No'),
    'Created          : ' + (t.created_at ? new Date(t.created_at).toLocaleString() : 'N/A'),
    'Risk Flags:',
    flags,
    'Audit Trail:',
    audit,
    t.ai_brief ? ('AI Review Brief: ' + t.ai_brief.slice(0, 300) + '...') : ''
  ].filter(Boolean).join('\n');
}

// ── Build comprehensive live system context (ASYNC) ───────────────────────────
async function buildLiveContext() {
  const allTxns      = await queryAll('transactions');
  const total        = allTxns.length;
  const autoApproved = allTxns.filter(t => t.status === 'auto_approved').length;
  const approved     = allTxns.filter(t => t.status === 'approved').length;
  const declined     = allTxns.filter(t => t.status === 'declined').length;
  const pending      = allTxns.filter(t => t.status === 'under_review').length;
  const l1 = allTxns.filter(t => t.risk_level === 1).length;
  const l2 = allTxns.filter(t => t.risk_level === 2).length;
  const l3 = allTxns.filter(t => t.risk_level === 3).length;
  const totalValue = allTxns.reduce((a, t) => a + (parseFloat(t.amount) || 0), 0);
  const avgRisk    = total > 0 ? allTxns.reduce((a, t) => a + (parseFloat(t.risk_score) || 0), 0) / total : 0;
  const todayStr   = new Date().toISOString().split('T')[0];
  const todayCount = allTxns.filter(t => t.created_at?.startsWith(todayStr)).length;
  const autoRate   = total > 0 ? Math.round((autoApproved / total) * 100) : 0;

  const [learning, accounts, auditLogs] = await Promise.all([
    getLearningStats(),
    queryAll('accounts'),
    queryAll('audit_logs', null, { orderBy: 'created_at', desc: true, limit: 10 }),
  ]);

  const recentTxns  = allTxns.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10);
  const l3Txns      = allTxns.filter(t => t.risk_level === 3);
  const pendingTxns = allTxns.filter(t => t.status === 'under_review');

  const txnIndex = allTxns.map(t =>
    t.transaction_id + ' | ' + t.company_name + ' | $' + t.amount
    + ' | ' + t.status + ' | L' + t.risk_level + ' | Score:' + t.risk_score
    + ' | ' + t.sec_code + ' | ' + t.effective_date
  ).join('\n');

  return [
    '=== LIVE ACH SYSTEM DATA (' + new Date().toLocaleString() + ') ===',
    '',
    '## STATISTICS',
    'Total Transactions: ' + total,
    "Today's Transactions: " + todayCount,
    'Auto-Approved: ' + autoApproved + ' (' + autoRate + '% auto-resolution rate)',
    'Under Review (Pending): ' + pending,
    'Approved: ' + approved + ' | Declined: ' + declined,
    'Total Volume: $' + Number(totalValue.toFixed(2)).toLocaleString(),
    'Average Risk Score: ' + (Math.round(avgRisk * 10) / 10) + '/100',
    'Risk Distribution: L1(Low)=' + l1 + ' | L2(Medium)=' + l2 + ' | L3(High)=' + l3,
    '',
    '## AI LEARNING ENGINE',
    'Patterns Learned: ' + learning.totalPatterns + ' (Promoted: ' + learning.promotedPatterns + ')',
    'Human Decisions: ' + learning.totalHumanDecisions + ' | Promotion Rate: ' + learning.promotionRate + '%',
    'Top Fraud Indicators: ' + ((learning.topFraudIndicators || []).map(f => f.indicator + '(' + f.count + 'x)').join(', ') || 'None'),
    '',
    '## ACCOUNTS',
    (Array.isArray(accounts) ? accounts : []).map(a => a.account_name + ': Filter=' + a.filter_mode + ', Default=' + a.default_action).join('\n') || 'None',
    '',
    '## ALL TRANSACTION INDEX (ID | Company | Amount | Status | Risk | Score | SEC | Date)',
    txnIndex || '(No transactions)',
    '',
    '## 10 MOST RECENT TRANSACTIONS',
    recentTxns.map(t => t.transaction_id + ': ' + t.company_name + ' | $' + t.amount + ' | ' + t.status + ' | L' + t.risk_level).join('\n'),
    '',
    '## TRANSACTIONS PENDING REVIEW',
    pendingTxns.slice(0, 10).map(t => t.transaction_id + ': ' + t.company_name + ' | $' + t.amount + ' | L' + t.risk_level + ' (Score: ' + t.risk_score + ')').join('\n') || 'None',
    '',
    '## HIGH-RISK (LEVEL 3) TRANSACTIONS',
    l3Txns.slice(0, 10).map(t => t.transaction_id + ': ' + t.company_name + ' | $' + t.amount + ' | ' + t.status).join('\n') || 'None',
    '',
    '## RECENT AUDIT EVENTS',
    (Array.isArray(auditLogs) ? auditLogs : []).map(l => '[' + l.actor + '] ' + l.event_summary).join('\n'),
  ].join('\n');
}

// ── Execute approve/reject decision (ASYNC) ───────────────────────────────────
async function executeDecision(txnId, action, reviewer, notes) {
  const txn = await queryOne('transactions', t => t.transaction_id === txnId);
  if (!txn) return { success: false, error: 'Transaction ' + txnId + ' not found.' };
  if (txn.status !== 'under_review') {
    return { success: false, error: 'Transaction ' + txnId + ' is not under review (current status: ' + txn.status + '). Only pending transactions can be approved or declined.' };
  }

  const newStatus = action === 'approve' ? 'approved' : 'declined';
  await update('transactions', t => t.transaction_id === txnId, () => ({
    status:            newStatus,
    reviewer_decision: action,
    reviewer_notes:    notes || 'Decision made via AI Chatbot',
    decision_at:       new Date().toISOString(),
    reviewer_id:       reviewer.user_id,
    reviewer_name:     reviewer.full_name,
    reviewer_username: reviewer.username,
    reviewer_role:     reviewer.role,
  }));

  const riskResult = { riskLevel: txn.risk_level, riskScore: txn.risk_score, riskFlags: txn.risk_flags || [] };
  recordDecision(txn, action, { additional_notes: notes || 'Via chatbot' }, riskResult).catch(() => {});

  await insert('audit_logs', {
    transaction_id: txnId,
    event_type:     action === 'approve' ? 'human_approved' : 'human_declined',
    event_summary:  (action === 'approve' ? 'Approved' : 'Declined')
      + ' via chatbot by ' + reviewer.full_name + ' (' + reviewer.username + ')'
      + ' — ' + txn.company_name + ' $' + txn.amount,
    event_data:     { decision: action, via: 'chatbot', reviewer: reviewer.username },
    actor:          reviewer.full_name,
    severity:       action === 'approve' ? 'info' : 'warning'
  });

  return {
    success:    true,
    txnId,
    action,
    company:    txn.company_name,
    amount:     txn.amount,
    newStatus,
    riskLevel:  txn.risk_level,
    riskScore:  txn.risk_score,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/chatbot/message — Main natural language endpoint
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/message', optionalAuth, async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message?.trim()) return res.status(400).json({ success: false, error: 'message is required' });

    const user = req.user; // may be null if not authenticated

    // ── Step 1: Detect approve/reject intent (requires authentication) ─────
    const decisionIntent = detectDecisionIntent(message);
    if (decisionIntent) {
      if (!user) {
        return res.json({
          success: true,
          reply: '🔒 **Authentication required** to approve or reject transactions. Please log in first.',
          source: 'system'
        });
      }

      const { action, txnIds } = decisionIntent;

      if (txnIds.length > 0) {
        const results = await Promise.all(txnIds.map(id => executeDecision(id, action, user, null)));
        const successful = results.filter(r => r.success);
        const failed     = results.filter(r => !r.success);

        let reply = '';
        if (successful.length > 0) {
          reply += successful.map(r =>
            (r.action === 'approve' ? '✅' : '❌') + ' **' + r.txnId + '** — '
            + r.company + ' ($' + Number(r.amount).toLocaleString() + ') has been **' + r.newStatus + '** by ' + user.full_name + '.'
          ).join('\n');
        }
        if (failed.length > 0) {
          reply += (reply ? '\n\n' : '') + failed.map(r => '⚠️ ' + r.error).join('\n');
        }

        return res.json({ success: true, reply: reply.trim(), source: 'decision' });
      }

      // No specific ID — ask the user which one
      const pendingTxns = await queryAll('transactions', t => t.status === 'under_review');
      const pendingSlice = pendingTxns.slice(0, 5);
      if (pendingSlice.length === 0) {
        return res.json({
          success: true,
          reply: 'There are no transactions currently pending review to ' + action + '.',
          source: 'system'
        });
      }
      const list = pendingSlice.map(t =>
        '• **' + t.transaction_id + '** — ' + t.company_name + ' | $' + Number(t.amount).toLocaleString() + ' | Risk L' + t.risk_level
      ).join('\n');
      return res.json({
        success: true,
        reply: 'Which transaction would you like to **' + action + '**? Here are the ones currently under review:\n\n' + list + '\n\nJust reply with the transaction ID, e.g. *"' + action + ' ' + pendingSlice[0].transaction_id + '"*',
        source: 'system'
      });
    }

    // ── Step 1.5: Detect user creation intent (requires admin) ────────────
    const userIntent = detectUserCreationIntent(message);
    if (userIntent) {
      if (!user) {
        return res.json({ success: true, reply: '🔒 **Authentication required** to create users. Please log in first.', source: 'system' });
      }
      if (user.role !== 'admin') {
        return res.json({ success: true, reply: '🔒 **Admin access required** to create users. Your role is: ' + user.role + '.', source: 'system' });
      }

      const { email, role, username, full_name } = userIntent;
      const existing = await queryOne('users', u => u.email.toLowerCase() === email.toLowerCase() || u.username.toLowerCase() === username.toLowerCase());
      
      if (existing) {
        return res.json({ success: true, reply: `A user with the email or username **${email}** already exists.`, source: 'system' });
      }

      const bcrypt = require('bcryptjs');
      const plainPassword = Math.random().toString(36).slice(-8) + 'A1!';
      const password_hash = await bcrypt.hash(plainPassword, 12);
      const user_id = 'USR-' + uuidv4().slice(0, 8).toUpperCase();

      await insert('users', {
        user_id, username, full_name, email, password_hash, role,
        is_active: true, last_login: null, created_by: user.username,
      });

      await insert('audit_logs', {
        transaction_id: null, event_type: 'user_created',
        event_summary: `[CHATBOT] User created by ${user.username}: ${full_name} (${username}) — Role: ${role}`,
        event_data: { user_id, role, created_by: user.username },
        actor: user.username, severity: 'info'
      });

      return res.json({
        success: true,
        reply: `✅ I've successfully created the new user account for you.\n\n**User Details:**\n* **Username:** ${username}\n* **Email:** ${email}\n* **Role:** ${role}\n* **Temporary Password:** \`${plainPassword}\`\n\nPlease share these credentials securely.`,
        source: 'system'
      });
    }

    // ── Step 2: Fetch full details for any specific TXN IDs mentioned ─────
    const mentionedIds = extractTxnIds(message);
    let specificContext = '';
    if (mentionedIds.length > 0) {
      const details = await Promise.all(mentionedIds.map(async id => {
        const t = await queryOne('transactions', tx => tx.transaction_id === id);
        if (t) {
          const detail = await txnDetailForContext(t);
          return '\n=== FULL DETAILS FOR ' + id + ' ===\n' + detail;
        }
        return '\n=== NOTE: ' + id + ' does NOT exist in the database. ===';
      }));
      specificContext = details.join('\n');
    }

    // ── Step 3: Build full live context + conversation history ─────────────
    const liveContext  = await buildLiveContext();
    const historyStr   = history.slice(-12)
      .map(h => (h.role === 'user' ? 'User' : 'Assistant') + ': ' + h.content)
      .join('\n');

    // ── Step 4: Craft a natural system prompt ─────────────────────────────
    const systemPrompt = [
      'You are an intelligent, conversational AI assistant embedded in the ACH Payment & Positive Pay AI Triage System v3.0.',
      'You have full access to LIVE system data injected below. Today: ' + new Date().toLocaleString(),
      '',
      'BEHAVIOR RULES:',
      '1. Understand the INTENT and CONTEXT of the question — not just keywords.',
      '2. Respond naturally and conversationally, like a knowledgeable banking expert.',
      '3. Adjust your format to the question: prose for explanations, tables for comparisons, brief lists for enumerations.',
      '4. For transaction ID lookups: present all details clearly from the FULL DETAILS section.',
      '5. For approve/reject requests: guide the user if they have not specified a TXN ID.',
      '6. For analytical questions: reason through the live data, give insights — do not just dump raw numbers.',
      '7. For ACH/NACHA/compliance questions: explain clearly and relate to this system where relevant.',
      '8. ACCURACY: Every fact must come from the live data. Never invent numbers or transactions.',
      '9. If the user asks what you can do: mention Q&A, transaction lookups, approve/reject (for authorized users), CRUD (admin), and compliance explanation.',
      '10. Keep responses appropriately concise — expand only when detail is genuinely requested.',
      '',
      'USER INFO: ' + (user ? 'Logged in as ' + user.full_name + ' (Role: ' + user.role + ')' : 'Not authenticated'),
      '',
      liveContext,
      specificContext ? ('\n' + specificContext) : '',
    ].join('\n');

    const fullPrompt = systemPrompt
      + '\n\n## CONVERSATION HISTORY:\n' + historyStr
      + '\n\nUser: ' + message
      + '\nAssistant:';

    const reply = await callGemini(fullPrompt);
    res.json({ success: true, reply: reply.trim(), source: 'ai' });

  } catch (e) {
    console.error('[Chatbot /message]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/chatbot/decision — Direct approve/reject endpoint (used by CRUD UI)
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/decision', authenticate, async (req, res) => {
  try {
    const { transaction_id, action, notes } = req.body;
    if (!transaction_id) return res.status(400).json({ success: false, error: 'transaction_id is required' });
    if (!['approve', 'decline'].includes(action)) return res.status(400).json({ success: false, error: 'action must be approve or decline' });

    const result = await executeDecision(transaction_id, action, req.user, notes);
    if (!result.success) return res.status(400).json(result);

    const icon = action === 'approve' ? '✅' : '❌';
    res.json({
      ...result,
      message: icon + ' Transaction **' + transaction_id + '** — ' + result.company + ' ($' + Number(result.amount).toLocaleString() + ') has been **' + result.newStatus + '**.'
    });
  } catch (e) {
    console.error('[Chatbot /decision]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/chatbot/crud — Admin-only CRUD operations
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/crud', authenticate, async (req, res) => {
  try {
    const { operation, transaction_id, data = {} } = req.body;
    const user = req.user;

    if (!['create', 'read', 'update', 'delete'].includes(operation)) {
      return res.status(400).json({ success: false, error: 'Invalid operation. Use: create, read, update, delete' });
    }
    if (['create', 'update', 'delete'].includes(operation) && user.role !== 'admin') {
      return res.status(403).json({
        success: false, error: 'Access Denied',
        message: 'Only Admin users can ' + operation + ' transactions. Your role: ' + user.role + '.',
        role: user.role
      });
    }

    // READ
    if (operation === 'read') {
      if (!transaction_id) return res.status(400).json({ success: false, error: 'transaction_id required' });
      const txn = await queryOne('transactions', t => t.transaction_id === transaction_id);
      if (!txn) return res.status(404).json({ success: false, error: 'Not found: ' + transaction_id });
      const auditLogs = await queryAll('audit_logs', l => l.transaction_id === transaction_id, { orderBy: 'created_at', desc: true, limit: 5 });
      return res.json({ success: true, operation: 'read', data: { ...txn, audit_logs: auditLogs } });
    }

    // CREATE
    if (operation === 'create') {
      const required = ['company_name', 'amount', 'account_number', 'routing_number'];
      const missing  = required.filter(f => !data[f]);
      if (missing.length) return res.status(400).json({ success: false, error: 'Missing: ' + missing.join(', ') });

      const txnId = 'TXN-' + uuidv4().slice(0, 8).toUpperCase();
      const txn = {
        transaction_id:   txnId,
        company_name:     data.company_name,
        company_id:       data.company_id || 'ADMIN000',
        sec_code:         (data.sec_code || 'PPD').toUpperCase(),
        transaction_type: (data.transaction_type || 'debit').toLowerCase(),
        account_type:     data.account_type || 'checking',
        amount:           parseFloat(data.amount),
        account_number:   data.account_number,
        routing_number:   data.routing_number,
        rdfi_routing:     data.routing_number,
        effective_date:   data.effective_date || new Date().toISOString().split('T')[0],
        entry_description:(data.entry_description || '').slice(0, 10),
        individual_name:  data.individual_name || '',
        trace_number:     data.trace_number || '',
        ofac_screened: false, ofac_result: 'pending', aml_flag: false, prenote: false,
        originator: 'CHATBOT_ADMIN:' + user.username,
      };

      const riskResult = await scoreTransaction(txn);
      let status = 'pending', complianceNotes = null, aiBrief = null, aiRec = null, aiConf = null;
      if (riskResult.riskLevel === 1) {
        complianceNotes = await generateComplianceNotes(txn, riskResult);
        aiBrief = complianceNotes;
        status = 'auto_approved';
      } else {
        const brief = await generateReviewBrief(txn, riskResult);
        aiBrief = brief.brief; aiRec = brief.recommendation; aiConf = brief.confidence;
        status = 'under_review';
      }

      const saved = await insert('transactions', {
        ...txn, risk_level: riskResult.riskLevel, risk_score: riskResult.riskScore,
        risk_flags: riskResult.riskFlags, ai_brief: aiBrief,
        compliance_notes: complianceNotes, ai_recommendation: aiRec, ai_confidence: aiConf, status
      });
      await insert('audit_logs', {
        transaction_id: txnId, event_type: 'transaction_created',
        event_summary: '[CHATBOT] Created by ' + user.username + ': ' + txn.company_name + ' $' + txn.amount,
        event_data: { risk_level: riskResult.riskLevel, source: 'chatbot_crud' },
        actor: user.full_name, severity: 'info'
      });

      return res.status(201).json({
        success: true, operation: 'create',
        message: 'Transaction **' + txnId + '** created. Status: ' + status + ' | Risk Level: ' + riskResult.riskLevel,
        data: saved
      });
    }

    // UPDATE
    if (operation === 'update') {
      if (!transaction_id) return res.status(400).json({ success: false, error: 'transaction_id required' });
      const existing = await queryOne('transactions', t => t.transaction_id === transaction_id);
      if (!existing) return res.status(404).json({ success: false, error: 'Not found: ' + transaction_id });

      const protectedFields = ['transaction_id', 'id', 'created_at', 'risk_flags', 'ai_brief', 'compliance_notes'];
      const allowed = Object.fromEntries(Object.entries(data).filter(([k]) => !protectedFields.includes(k)));
      if (!Object.keys(allowed).length) return res.status(400).json({ success: false, error: 'No valid fields to update.' });

      await update('transactions', t => t.transaction_id === transaction_id, () => allowed);
      await insert('audit_logs', {
        transaction_id, event_type: 'transaction_updated',
        event_summary: '[CHATBOT] Updated by ' + user.username + ': ' + Object.keys(allowed).join(', '),
        event_data: { updated_fields: allowed }, actor: user.full_name, severity: 'warning'
      });

      const updated = await queryOne('transactions', t => t.transaction_id === transaction_id);
      return res.json({
        success: true, operation: 'update',
        message: 'Transaction **' + transaction_id + '** updated. Changed: ' + Object.keys(allowed).join(', '),
        data: updated
      });
    }

    // DELETE
    if (operation === 'delete') {
      if (!transaction_id) return res.status(400).json({ success: false, error: 'transaction_id required' });
      const existing = await queryOne('transactions', t => t.transaction_id === transaction_id);
      if (!existing) return res.status(404).json({ success: false, error: 'Not found: ' + transaction_id });
      if (['approved', 'auto_approved'].includes(existing.status)) {
        return res.status(403).json({ success: false, error: 'Cannot delete an already-' + existing.status + ' transaction.' });
      }

      await remove('transactions', t => t.transaction_id === transaction_id);
      await insert('audit_logs', {
        transaction_id, event_type: 'transaction_deleted',
        event_summary: '[CHATBOT] DELETED by ' + user.username + ': ' + existing.company_name + ' $' + existing.amount,
        event_data: { company_name: existing.company_name, amount: existing.amount },
        actor: user.full_name, severity: 'critical'
      });

      return res.json({
        success: true, operation: 'delete',
        message: 'Transaction **' + transaction_id + '** (' + existing.company_name + ' — $' + existing.amount + ') permanently deleted.',
      });
    }

  } catch (e) {
    console.error('[Chatbot /crud]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/chatbot/context ──────────────────────────────────────────────────
router.get('/context', async (req, res) => {
  try {
    const ctx = await buildLiveContext();
    res.json({ success: true, data: ctx });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
