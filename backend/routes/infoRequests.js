'use strict';
const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, insert, update } = require('../database/db');
const { authenticate } = require('../middleware/auth');
const { recordMirDecision, recordLifecycleResponse, evaluateOriginatorResponse } = require('../services/learningPipeline');
const { regenerateBriefForOperation } = require('../services/aiTriage');

const TOKEN_EXPIRY_HOURS = parseInt(process.env.MIR_TOKEN_EXPIRY_HOURS || '72');
const MIR_SLA_HOURS      = parseInt(process.env.MIR_SLA_HOURS || '48');
const MAX_MIR_ROUNDS     = parseInt(process.env.MIR_MAX_ROUNDS || '5');
const PORTAL_BASE_URL    = process.env.PORTAL_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:5173';

const MIR_CATEGORIES = [
  'IDENTITY_VERIFICATION','AUTHORIZATION_PROOF','BUSINESS_PURPOSE_CLARIFICATION',
  'AMOUNT_DISCREPANCY','ACCOUNT_OWNERSHIP','SANCTIONS_REVIEW','DUPLICATE_EXPLANATION','CUSTOM',
];

function safeTxnSummary(txn) {
  const acct = String(txn.account_number || '');
  const rout = String(txn.routing_number || txn.rdfi_routing || '');
  return {
    transaction_id: txn.transaction_id, company_name: txn.company_name,
    amount: txn.amount, transaction_type: txn.transaction_type,
    sec_code: txn.sec_code, effective_date: txn.effective_date,
    account_number_masked: acct.length >= 4 ? '•••• ' + acct.slice(-4) : '••••',
    routing_number_masked: rout.length >= 4 ? '••••• ' + rout.slice(-4) : '•••••',
  };
}

async function sendPortalEmail({ to, company_name, amount, request_message, category, portal_url, expires_at }) {
  const catLabel   = category.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  const expiresStr = new Date(expires_at).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });
  const body = `Hello,\n\nYour ACH transaction requires additional information.\n\nTransaction: ${company_name} — $${Number(amount).toLocaleString('en-US',{minimumFractionDigits:2})}\nCategory: ${catLabel}\n\nWhat we need:\n  ${request_message}\n\nPlease respond at: ${portal_url}\n\nThis link expires on ${expiresStr}.\n\nIMPORTANT: Do not share this link. If you did not initiate this transaction, contact your bank immediately.`;
  const key = process.env.RESEND_API_KEY;
  if (key) {
    try {
      const { Resend } = require('resend');
      const { data, error } = await new Resend(key).emails.send({ from: process.env.RESEND_FROM || 'onboarding@resend.dev', to, subject: 'Action Required: Additional Information Needed for ACH Transaction', text: body });
      if (error) throw new Error(error.message);
      return { sent: true, id: data?.id };
    } catch (e) { return { sent: false, error: e.message }; }
  }
  console.log(`\n╔══ MIR PORTAL LINK ══╗\n  To  : ${to||'(no email)'}\n  Link: ${portal_url}\n  Exp : ${expiresStr}\n╚═════════════════════╝\n`);
  return { sent: false, reason: 'RESEND_API_KEY not configured — link logged above' };
}

async function _createInfoRequest({ txn, roundNumber, category, message, actorType, actorName, originatorEmail, patternHash }) {
  const portalToken    = crypto.randomBytes(32).toString('hex');
  const requestId      = `MIR-${uuidv4().slice(0,8).toUpperCase()}`;
  const now            = new Date();
  const tokenExpiresAt = new Date(now.getTime() + TOKEN_EXPIRY_HOURS * 3600000).toISOString();
  const slaDeadlineAt  = new Date(now.getTime() + MIR_SLA_HOURS      * 3600000).toISOString();

  await insert('info_requests', {
    request_id: requestId, transaction_id: txn.transaction_id,
    round_number: roundNumber, requested_by: actorName, actor_type: actorType,
    category, message, requested_fields: [], portal_token: portalToken,
    token_expires_at: tokenExpiresAt, sla_deadline_at: slaDeadlineAt,
    status: 'pending', response_message: null, response_attachments: [],
    responded_at: null, link_opened_at: null,
    originator_email: originatorEmail || txn.originator_email || null,
    pattern_hash: patternHash || null,
  });

  await update('transactions', t => t.transaction_id === txn.transaction_id, () => ({
    status: 'more_info_required', last_info_request_id: requestId,
    info_request_rounds: roundNumber, resubmission_count: txn.resubmission_count || 0,
  }), { transaction_id: txn.transaction_id });

  const portalUrl   = `${PORTAL_BASE_URL}/portal/${portalToken}`;
  const emailTo     = originatorEmail || txn.originator_email;
  const emailResult = emailTo
    ? await sendPortalEmail({ to: emailTo, company_name: txn.company_name, amount: txn.amount, request_message: message, category, portal_url: portalUrl, expires_at: tokenExpiresAt })
    : { sent: false, reason: 'No originator email on file' };

  return { requestId, portalUrl, portalToken, tokenExpiresAt, slaDeadlineAt, emailResult };
}

// POST /api/transactions/:id/request-info (human, admin-auth)
router.post('/transactions/:id/request-info', authenticate, async (req, res) => {
  try {
    const txn = await queryOne('transactions', t => t.transaction_id === req.params.id, { transaction_id: req.params.id });
    if (!txn) return res.status(404).json({ success: false, error: 'Transaction not found' });
    if (!['under_review','more_info_required'].includes(txn.status))
      return res.status(409).json({ success: false, error: `Cannot request info on status: ${txn.status}` });

    const { category, message, originator_email } = req.body;
    if (!category || !MIR_CATEGORIES.includes(category))
      return res.status(400).json({ success: false, error: `category must be one of: ${MIR_CATEGORIES.join(', ')}` });
    if (!message || message.trim().length < 10)
      return res.status(400).json({ success: false, error: 'message required (min 10 chars)' });

    const existing    = await queryAll('info_requests', r => r.transaction_id === req.params.id, { where: { transaction_id: req.params.id } });
    const roundNumber = existing.length + 1;
    const reviewer    = req.user;

    if (roundNumber > MAX_MIR_ROUNDS) {
      await insert('audit_logs', { transaction_id: txn.transaction_id, event_type: 'mir_escalation_required', event_summary: `⚠️ MIR round ${roundNumber} exceeds maximum (${MAX_MIR_ROUNDS})`, event_data: { round: roundNumber }, actor: reviewer.full_name, severity: 'critical' });
    }

    const result = await _createInfoRequest({ txn, roundNumber, category, message: message.trim(), actorType: 'HUMAN', actorName: reviewer.full_name, originatorEmail: originator_email, patternHash: null });

    await insert('audit_logs', { transaction_id: txn.transaction_id, event_type: 'info_requested', event_summary: `🔄 Info requested by ${reviewer.full_name} [Round ${roundNumber}] — ${category.replace(/_/g,' ')}`, event_data: { request_id: result.requestId, round: roundNumber, category, portal_url: result.portalUrl, email_sent: result.emailResult.sent }, actor: reviewer.full_name, severity: 'info' });

    const riskResult = { riskLevel: txn.risk_level, riskScore: txn.risk_score, riskFlags: txn.risk_flags || [] };
    recordMirDecision(txn, category, 'HUMAN', riskResult).catch(console.error);

    // Regenerate AI brief in background with full company context
    ;(async () => {
      try {
        const [companyTransactions, allInfoRequests] = await Promise.all([
          queryAll('transactions', t => t.company_id === txn.company_id, { where: { company_id: txn.company_id } }),
          queryAll('info_requests', r => r.transaction_id === txn.transaction_id, { where: { transaction_id: txn.transaction_id }, orderBy: 'created_at', desc: false }),
        ]);
        const newBrief = await regenerateBriefForOperation(txn, riskResult, 'more_info_requested', {
          companyTransactions,
          infoRequests: allInfoRequests,
          operationDetails: {
            round_number: roundNumber,
            requested_by: reviewer.full_name,
            category,
            message: message.trim(),
          },
        });
        await update('transactions', t => t.transaction_id === txn.transaction_id, () => ({ ai_brief: newBrief }));
      } catch (e) {
        console.error('[AI_BRIEF] Brief regeneration failed after MIR request:', e.message);
      }
    })();

    res.status(201).json({ success: true, message: `Info request created [Round ${roundNumber}].`, request_id: result.requestId, round: roundNumber, portal_url: result.portalUrl, token_expires_at: result.tokenExpiresAt, sla_deadline_at: result.slaDeadlineAt, email_status: result.emailResult, requires_escalation: roundNumber > MAX_MIR_ROUNDS });
  } catch (e) { console.error('[POST /request-info]', e); res.status(500).json({ success: false, error: e.message }); }
});

// GET /api/transactions/:id/info-requests (admin-auth)
router.get('/transactions/:id/info-requests', authenticate, async (req, res) => {
  try {
    const rounds = await queryAll('info_requests', r => r.transaction_id === req.params.id, { where: { transaction_id: req.params.id }, orderBy: 'created_at', desc: false });
    console.log(`[MIR] GET info-requests for ${req.params.id}: found ${rounds.length} round(s)`);
    res.json({ success: true, data: rounds.map(r => ({ ...r, portal_token: r.portal_token ? '••••••••' : null })), total: rounds.length });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// POST /api/transactions/:id/override-ai (admin-auth) — human takes over
router.post('/transactions/:id/override-ai', authenticate, async (req, res) => {
  try {
    const txn = await queryOne('transactions', t => t.transaction_id === req.params.id, { transaction_id: req.params.id });
    if (!txn) return res.status(404).json({ success: false, error: 'Not found' });
    await update('transactions', t => t.transaction_id === req.params.id, () => ({ ai_human_override: true, ai_escalation_reason: `Human override by ${req.user.full_name}`, status: txn.status === 'ai_workflow' ? 'under_review' : txn.status }), { transaction_id: req.params.id });
    await insert('audit_logs', { transaction_id: txn.transaction_id, event_type: 'human_override', event_summary: `👤 Human override: ${req.user.full_name} took control from AI_AUTOMATION`, event_data: { reviewer: req.user.username }, actor: req.user.full_name, severity: 'warning' });
    res.json({ success: true, message: 'Human override activated. Transaction is now in your review queue.' });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// GET /api/portal/:token (PUBLIC)
router.get('/portal/:token', async (req, res) => {
  try {
    const infoReq = await queryOne('info_requests', r => r.portal_token === req.params.token, { portal_token: req.params.token });
    if (!infoReq) return res.status(404).json({ success: false, error: 'Invalid or expired portal link.' });
    if (new Date(infoReq.token_expires_at) < new Date()) {
      await update('info_requests', r => r.portal_token === req.params.token, () => ({ status: 'expired' }), { portal_token: req.params.token });
      return res.status(410).json({ success: false, error: 'This portal link has expired. Please contact your bank for a new link.' });
    }
    if (infoReq.status === 'responded')
      return res.status(409).json({ success: false, error: 'This request has already been responded to.' });
    if (!infoReq.link_opened_at) {
      await update('info_requests', r => r.portal_token === req.params.token, () => ({ link_opened_at: new Date().toISOString() }), { portal_token: req.params.token });
      await insert('audit_logs', { transaction_id: infoReq.transaction_id, event_type: 'portal_link_opened', event_summary: `🔗 Portal link opened — ${infoReq.request_id} [Round ${infoReq.round_number}]`, event_data: { request_id: infoReq.request_id, actor_type: infoReq.actor_type }, actor: 'ORIGINATOR', severity: 'info' });
    }
    const txn = await queryOne('transactions', t => t.transaction_id === infoReq.transaction_id, { transaction_id: infoReq.transaction_id });
    if (!txn) return res.status(404).json({ success: false, error: 'Transaction not found.' });
    res.json({ success: true, data: { request_id: infoReq.request_id, round_number: infoReq.round_number, category: infoReq.category, message: infoReq.message, requested_fields: infoReq.requested_fields || [], token_expires_at: infoReq.token_expires_at, sla_deadline_at: infoReq.sla_deadline_at, actor_type: infoReq.actor_type, transaction: safeTxnSummary(txn) } });
  } catch (e) { console.error('[GET /portal/:token]', e); res.status(500).json({ success: false, error: 'An error occurred. Please try again.' }); }
});

// POST /api/portal/:token/respond (PUBLIC)
router.post('/portal/:token/respond', async (req, res) => {
  try {
    const infoReq = await queryOne('info_requests', r => r.portal_token === req.params.token, { portal_token: req.params.token });
    if (!infoReq) return res.status(404).json({ success: false, error: 'Invalid or expired portal link.' });
    if (new Date(infoReq.token_expires_at) < new Date()) {
      await update('info_requests', r => r.portal_token === req.params.token, () => ({ status: 'expired' }), { portal_token: req.params.token });
      return res.status(410).json({ success: false, error: 'This portal link has expired.' });
    }
    if (infoReq.status !== 'pending')
      return res.status(409).json({ success: false, error: 'This request has already been responded to.' });

    const { response_message } = req.body;
    if (!response_message || response_message.trim().length < 5)
      return res.status(400).json({ success: false, error: 'A response message is required (min 5 characters).' });

    const respondedAt = new Date().toISOString();
    await update('info_requests', r => r.portal_token === req.params.token, () => ({ status: 'responded', response_message: response_message.trim(), responded_at: respondedAt }), { portal_token: req.params.token });

    const txn = await queryOne('transactions', t => t.transaction_id === infoReq.transaction_id, { transaction_id: infoReq.transaction_id });
    if (!txn) return res.status(404).json({ success: false, error: 'Transaction not found.' });

    const newResubCount = (txn.resubmission_count || 0) + 1;
    await insert('audit_logs', { transaction_id: infoReq.transaction_id, event_type: 'originator_response_submitted', event_summary: `📨 Originator responded to ${infoReq.request_id} [Round ${infoReq.round_number}] (${infoReq.actor_type})`, event_data: { request_id: infoReq.request_id, round: infoReq.round_number, actor_type: infoReq.actor_type, response_length: response_message.trim().length }, actor: 'ORIGINATOR', severity: 'info' });

    // Regenerate AI brief in background after originator responds (shared by both paths)
    const _riskResult = { riskLevel: txn.risk_level, riskScore: txn.risk_score, riskFlags: txn.risk_flags || [] };
    ;(async () => {
      try {
        const [companyTransactions, allInfoRequests] = await Promise.all([
          queryAll('transactions', t => t.company_id === txn.company_id, { where: { company_id: txn.company_id } }),
          queryAll('info_requests', r => r.transaction_id === txn.transaction_id, { where: { transaction_id: txn.transaction_id }, orderBy: 'created_at', desc: false }),
        ]);
        const newBrief = await regenerateBriefForOperation(txn, _riskResult, 'info_responded', {
          companyTransactions,
          infoRequests: allInfoRequests,
          operationDetails: {
            round_number: infoReq.round_number,
            response_message: response_message.trim(),
          },
        });
        await update('transactions', t => t.transaction_id === txn.transaction_id, () => ({ ai_brief: newBrief }));
      } catch (e) {
        console.error('[AI_BRIEF] Brief regeneration failed after originator response:', e.message);
      }
    })();

    if (infoReq.actor_type === 'AI_AUTOMATION') {
      // AI-initiated — evaluate response in background, respond to originator immediately
      const pattern = txn.ai_workflow_pattern
        ? await queryOne('learning_patterns', p => p.pattern_hash === txn.ai_workflow_pattern)
        : null;
      if (pattern) {
        evaluateOriginatorResponse(txn, infoReq, response_message.trim(), pattern).catch(e => {
          console.error('[AI_AUTOMATION] evaluateOriginatorResponse error:', e.message);
        });
        res.json({ success: true, message: 'Your response has been received and is being reviewed. You will be notified of the outcome.', resubmission_count: newResubCount });
      } else {
        // Pattern gone (demoted?) — fall back to human
        await update('transactions', t => t.transaction_id === infoReq.transaction_id, () => ({ status: 'under_review', resubmission_count: newResubCount, last_resubmitted_at: respondedAt, previous_status: 'more_info_required' }), { transaction_id: infoReq.transaction_id });
        res.json({ success: true, message: 'Your response has been submitted. A reviewer will be in touch.', resubmission_count: newResubCount });
      }
    } else {
      // Human-initiated — flip back to under_review
      await update('transactions', t => t.transaction_id === infoReq.transaction_id, () => ({ status: 'under_review', resubmission_count: newResubCount, last_resubmitted_at: respondedAt, previous_status: 'more_info_required' }), { transaction_id: infoReq.transaction_id });
      await insert('audit_logs', { transaction_id: infoReq.transaction_id, event_type: 'transaction_resubmitted', event_summary: `🔄 Back under review after originator response (resubmission #${newResubCount})`, event_data: { resubmission_count: newResubCount }, actor: 'ORIGINATOR', severity: 'info' });
      res.json({ success: true, message: 'Your response has been submitted. The bank will review it and contact you if further information is needed. Thank you.', resubmission_count: newResubCount });
    }
  } catch (e) { console.error('[POST /portal/:token/respond]', e); res.status(500).json({ success: false, error: 'An error occurred submitting your response. Please try again.' }); }
});

// Called by learningPipeline.js autonomous workflow
async function recordAutoMirRequest(txn, category, message, patternHash, roundNumber) {
  const round  = roundNumber || ((await queryAll('info_requests', r => r.transaction_id === txn.transaction_id, { where: { transaction_id: txn.transaction_id } })).length + 1);
  const result = await _createInfoRequest({ txn, roundNumber: round, category, message, actorType: 'AI_AUTOMATION', actorName: 'AI Automation', patternHash });
  await insert('audit_logs', { transaction_id: txn.transaction_id, event_type: 'ai_info_requested', event_summary: `🤖 AI_AUTOMATION: Info requested [Round ${round}] — ${category.replace(/_/g,' ')} (Pattern: ${patternHash})`, event_data: { request_id: result.requestId, round, category, portal_url: result.portalUrl, pattern_hash: patternHash }, actor: 'AI_AUTOMATION', severity: 'info' });
  return result;
}

module.exports = router;
module.exports.recordAutoMirRequest = recordAutoMirRequest;
module.exports.MIR_CATEGORIES       = MIR_CATEGORIES;
module.exports.MIR_SLA_HOURS        = MIR_SLA_HOURS;