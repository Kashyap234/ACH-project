// backend/routes/transactions.js — Full NACHA field support + rich decision
const express = require('express');
const router  = express.Router();
const { v4: uuidv4 }  = require('uuid');
const { queryAll, queryOne, insert, update } = require('../database/db');
const { scoreTransaction }    = require('../services/riskEngine');
const { generateComplianceNotes, generateReviewBrief } = require('../services/aiTriage');
const { recordDecision, checkPatternMatch } = require('../services/learningPipeline');
const { authenticate } = require('../middleware/auth');

// ── GET /api/transactions ────────────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const { status, risk_level, sec_code, limit = 50, offset = 0 } = req.query;
    let rows = queryAll('transactions', null, { orderBy: 'created_at', desc: true });
    if (status)     rows = rows.filter(t => t.status === status);
    if (risk_level) rows = rows.filter(t => t.risk_level === parseInt(risk_level));
    if (sec_code)   rows = rows.filter(t => t.sec_code === sec_code.toUpperCase());
    const total = rows.length;
    rows = rows.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
    res.json({ success: true, data: rows, total });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── GET /api/transactions/:id ────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  try {
    const txn = queryOne('transactions', t => t.transaction_id === req.params.id);
    if (!txn) return res.status(404).json({ success: false, error: 'Not found' });
    const auditLogs    = queryAll('audit_logs',      l => l.transaction_id === req.params.id, { orderBy: 'created_at', desc: false });
    const richDecisions= queryAll('review_decisions', d => d.transaction_id === req.params.id, { orderBy: 'created_at', desc: true });
    const returnCode   = txn.return_reason_code
      ? queryOne('return_codes', r => r.code === txn.return_reason_code) : null;
    res.json({ success: true, data: { ...txn, audit_logs: auditLogs, review_decisions: richDecisions, return_code_info: returnCode } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/transactions — Full NACHA field ingestion ─────────────────────
router.post('/', async (req, res) => {
  try {
    const body = req.body;

    // Required fields
    const required = ['company_name', 'company_id', 'amount', 'account_number', 'routing_number'];
    const missing  = required.filter(f => !body[f]);
    if (missing.length) return res.status(400).json({ success: false, error: `Missing required fields: ${missing.join(', ')}` });

    const transaction_id = body.transaction_id || `TXN-${uuidv4().slice(0, 8).toUpperCase()}`;
    const effective_date = body.effective_date || body.effective_entry_date || new Date().toISOString().split('T')[0];

    // Build full NACHA transaction object
    const txn = {
      transaction_id,

      // ── Batch-level (NACHA Record Type 5) ────────────────────────────
      service_class_code:         body.service_class_code || '200',
      company_name:               body.company_name,
      company_discretionary_data: body.company_discretionary_data || '',
      company_id:                 body.company_id,
      sec_code:                   (body.sec_code || 'PPD').toUpperCase(),
      company_entry_description:  (body.company_entry_description || body.entry_description || '').slice(0, 10),
      company_descriptive_date:   body.company_descriptive_date || '',
      effective_date,
      originator_status_code:     body.originator_status_code || '1',
      odfi_routing:               body.odfi_routing || '',
      batch_number:               body.batch_number || '1',

      // ── File-level (NACHA Record Type 1) ─────────────────────────────
      immediate_origin:           body.immediate_origin || '',
      immediate_destination:      body.immediate_destination || '',
      file_id_modifier:           body.file_id_modifier || 'A',

      // ── Entry Detail (NACHA Record Type 6) ───────────────────────────
      transaction_code:           body.transaction_code || '',
      account_type:               body.account_type || 'checking',
      transaction_type:           (body.transaction_type || 'debit').toLowerCase(),
      rdfi_routing:               body.rdfi_routing || body.routing_number,
      routing_number:             body.routing_number,
      check_digit:                body.check_digit || (body.routing_number || '').slice(-1),
      dfi_account_number:         body.dfi_account_number || body.account_number,
      account_number:             body.account_number,
      amount:                     parseFloat(body.amount),
      individual_id_number:       body.individual_id_number || '',
      individual_name:            body.individual_name || '',
      discretionary_data:         body.discretionary_data || '',
      addenda_record_indicator:   body.addenda_record_indicator || '0',
      trace_number:               body.trace_number || '',
      entry_description:          (body.entry_description || body.company_entry_description || '').slice(0, 10),

      // ── Addenda (NACHA Record Type 7) ────────────────────────────────
      addenda_type_code:          body.addenda_type_code || null,
      payment_related_info:       body.payment_related_info || null,
      addenda_sequence_number:    body.addenda_sequence_number || null,

      // ── IAT-Specific Fields ───────────────────────────────────────────
      transaction_type_code:          body.transaction_type_code || null,
      foreign_exchange_indicator:     body.foreign_exchange_indicator || null,
      foreign_exchange_reference_indicator: body.foreign_exchange_reference_indicator || null,
      foreign_exchange_reference:     body.foreign_exchange_reference || null,
      iso_destination_country_code:   body.iso_destination_country_code || null,
      originator_street:              body.originator_street || null,
      originator_city:                body.originator_city || null,
      originator_state:               body.originator_state || null,
      originator_postal:              body.originator_postal || null,
      originator_country:             body.originator_country || null,
      receiver_street:                body.receiver_street || null,
      receiver_city:                  body.receiver_city || null,
      receiver_state:                 body.receiver_state || null,
      receiver_postal:                body.receiver_postal || null,
      receiver_country:               body.receiver_country || null,
      odfi_name:                      body.odfi_name || null,
      odfi_id_number:                 body.odfi_id_number || null,
      odfi_branch_country:            body.odfi_branch_country || null,
      rdfi_name:                      body.rdfi_name || null,
      rdfi_id_number:                 body.rdfi_id_number || null,
      rdfi_branch_country:            body.rdfi_branch_country || null,
      gateway_ofac_screening_indicator:  body.gateway_ofac_screening_indicator || '0',
      secondary_ofac_screening_indicator: body.secondary_ofac_screening_indicator || '0',

      // ── Compliance & Risk ─────────────────────────────────────────────
      authorization_type:         body.authorization_type || null,
      ofac_screened:              body.ofac_screened === true || body.ofac_screened === 'true' || false,
      ofac_result:                body.ofac_result || 'pending',
      aml_flag:                   body.aml_flag === true || body.aml_flag === 'true' || false,
      sanctions_check_status:     body.sanctions_check_status || 'pending',
      prenote:                    body.prenote === true || body.prenote === 'true' || false,
      return_reason_code:         null,
      return_date:                null,
      original_trace_number:      body.original_trace_number || null,

      // ── Positive Pay ──────────────────────────────────────────────────
      is_positive_pay:            body.is_positive_pay === true || body.is_positive_pay === 'true' || false,
      check_serial_number:        body.check_serial_number || body.check_number || null,
      issued_check_amount:        body.issued_check_amount ? parseFloat(body.issued_check_amount) : null,
      issued_check_date:          body.issued_check_date || null,
      payee_name:                 body.payee_name || null,
      ach_filter_type:            body.ach_filter_type || null,
      authorized_company_ids:     body.authorized_company_ids || [],

      originator: 'API',
    };

    // ── Score ────────────────────────────────────────────────────────────
    const riskResult = await scoreTransaction(txn);

    // ── Check learned pattern ─────────────────────────────────────────────
    const match = checkPatternMatch(txn, riskResult.riskFlags);
    let effectiveLevel = riskResult.riskLevel;
    let patternNote    = null;
    if (match && riskResult.riskLevel > 1) {
      effectiveLevel = 1;
      patternNote = `🧠 Promoted by AI learning (Pattern ${match.pattern_hash}: ${Math.round(match.confidence_score * 100)}% confidence, ${match.total_decisions} decisions)`;
    }

    // ── AI Processing ─────────────────────────────────────────────────────
    let complianceNotes = null, aiBrief = null, aiRecommendation = null, aiConfidence = null;
    let status = 'pending';

    if (effectiveLevel === 1) {
      complianceNotes = await generateComplianceNotes(txn, riskResult);
      if (patternNote) complianceNotes = `### ${patternNote}\n\n---\n\n${complianceNotes}`;
      status = 'auto_approved';
    } else {
      const brief = await generateReviewBrief(txn, riskResult);
      aiBrief = brief.brief; aiRecommendation = brief.recommendation; aiConfidence = brief.confidence;
      status = 'under_review';
    }

    // ── Save ──────────────────────────────────────────────────────────────
    const saved = insert('transactions', {
      ...txn, risk_level: effectiveLevel, risk_score: riskResult.riskScore,
      risk_flags: riskResult.riskFlags, ai_brief: aiBrief,
      compliance_notes: complianceNotes, ai_recommendation: aiRecommendation,
      ai_confidence: aiConfidence, status
    });

    insert('audit_logs', { transaction_id, event_type: 'transaction_created', event_summary: `Ingested: ${txn.sec_code} $${parseFloat(body.amount).toLocaleString()} from ${txn.company_name}`, event_data: { risk_level: effectiveLevel, risk_score: riskResult.riskScore, flags: riskResult.riskFlags.length, sec_code: txn.sec_code }, actor: 'SYSTEM', severity: 'info' });
    insert('audit_logs', { transaction_id, event_type: effectiveLevel === 1 ? 'auto_approved' : 'ai_processed', event_summary: effectiveLevel === 1 ? `Auto-approved (Score: ${riskResult.riskScore}/100)` : `AI brief ready — Level ${effectiveLevel} human review required`, event_data: { ai_recommendation: aiRecommendation, ai_confidence: aiConfidence }, actor: 'AI', severity: 'info' });

    res.status(201).json({
      success: true,
      message: effectiveLevel === 1 ? '✅ Auto-approved by AI (Level 1 — Zero Touch)' : `⚠️ Level ${effectiveLevel} — AI brief ready for review`,
      data:    saved
    });
  } catch (e) {
    console.error('[POST /transactions]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/transactions/:id/decision — Rich human decision ────────────────
router.post('/:id/decision', authenticate, async (req, res) => {
  try {
    const { decision, ...reviewData } = req.body;
    if (!['approve', 'decline'].includes(decision)) return res.status(400).json({ success: false, error: 'decision must be approve or decline' });

    const txn = queryOne('transactions', t => t.transaction_id === req.params.id);
    if (!txn) return res.status(404).json({ success: false, error: 'Not found' });
    if (txn.status !== 'under_review') return res.status(409).json({ success: false, error: `Already in status: ${txn.status}` });

    const reviewer = req.user;
    const newStatus = decision === 'approve' ? 'approved' : 'declined';

    update('transactions', t => t.transaction_id === req.params.id, () => ({
      status:             newStatus,
      reviewer_decision:  decision,
      reviewer_notes:     reviewData.additional_notes || reviewData.decision_reason || null,
      return_reason_code: decision === 'decline' ? (reviewData.recommended_return_code || null) : null,
      decision_at:        new Date().toISOString(),
      // Reviewer identity
      reviewer_id:        reviewer.user_id,
      reviewer_name:      reviewer.full_name,
      reviewer_username:  reviewer.username,
      reviewer_role:      reviewer.role,
    }));

    const riskResult = { riskLevel: txn.risk_level, riskScore: txn.risk_score, riskFlags: txn.risk_flags || [] };
    recordDecision(txn, decision, reviewData, riskResult).catch(console.error);

    insert('audit_logs', {
      transaction_id: txn.transaction_id,
      event_type:    decision === 'approve' ? 'human_approved' : 'human_declined',
      event_summary: `${decision === 'approve' ? '✅ Approved' : '❌ Declined'} by ${reviewer.full_name} (${reviewer.username}) — ${txn.company_name} $${txn.amount}`,
      event_data:    {
        decision, reviewer_id: reviewer.user_id, reviewer_name: reviewer.full_name,
        reviewer_role: reviewer.role, return_code: reviewData.recommended_return_code || null,
        notes: reviewData.additional_notes || null
      },
      actor:    reviewer.full_name,
      severity: decision === 'approve' ? 'info' : 'warning'
    });

    res.json({ success: true, message: `Transaction ${decision.toUpperCase()}D`, data: { transaction_id: txn.transaction_id, status: newStatus, decision, reviewer_name: reviewer.full_name, return_code: reviewData.recommended_return_code || null } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/transactions/meta/return-codes ──────────────────────────────────
router.get('/meta/return-codes', (req, res) => {
  try {
    const codes = queryAll('return_codes', null, { orderBy: 'code', desc: false });
    res.json({ success: true, data: codes });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
