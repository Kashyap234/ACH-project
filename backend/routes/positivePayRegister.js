// backend/routes/positivePayRegister.js
// Issued Check Register — upload, manage, match incoming checks
const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, insert, update } = require('../database/db');

// ── Match result enum ────────────────────────────────────────────────────────
// FULL_MATCH / AMOUNT_MISMATCH / PAYEE_MISMATCH / SERIAL_NOT_FOUND / STALE_DATED

function matchCheck(presented, issued) {
  if (!issued) return { result:'SERIAL_NOT_FOUND', details:'Check serial number not in issued register' };
  const issues = [];
  // Amount check
  if (Math.abs(presented.amount - issued.issued_amount) > 0.01) issues.push(`AMOUNT_MISMATCH: presented $${presented.amount} vs issued $${issued.issued_amount}`);
  // Payee check (fuzzy — normalize case/whitespace)
  if (issued.payee_name && presented.payee_name) {
    const norm = s => s.toLowerCase().replace(/\s+/g,' ').trim();
    if (norm(presented.payee_name) !== norm(issued.payee_name)) issues.push(`PAYEE_MISMATCH: "${presented.payee_name}" vs issued "${issued.payee_name}"`);
  }
  // Stale-dated check (>90 days)
  if (issued.issue_date) {
    const days = (Date.now() - new Date(issued.issue_date).getTime()) / (1000 * 60 * 60 * 24);
    if (days > 90) issues.push(`STALE_DATED: issued ${Math.round(days)} days ago`);
  }
  if (issues.length === 0) return { result:'FULL_MATCH', details:'All fields match issued register' };
  const primaryReason = issues[0].split(':')[0];
  return { result: primaryReason, details: issues.join(' | ') };
}

// GET /api/check-register/:account_id — list issued checks
router.get('/:account_id', (req, res) => {
  try {
    const { status, limit=50, offset=0 } = req.query;
    let rows = queryAll('check_register', r => r.account_id === req.params.account_id, { orderBy:'issue_date', desc:true });
    if (status) rows = rows.filter(r => r.status === status);
    res.json({ success:true, data:rows.slice(+offset, +offset + +limit), total:rows.length });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// POST /api/check-register/:account_id — add single issued check
router.post('/:account_id', (req, res) => {
  try {
    const { check_serial_number, issued_amount, payee_name, issue_date, memo, void_reason } = req.body;
    if (!check_serial_number || !issued_amount) return res.status(400).json({ success:false, error:'check_serial_number and issued_amount required' });
    const existing = queryOne('check_register', r => r.account_id === req.params.account_id && r.check_serial_number === check_serial_number);
    if (existing) return res.status(409).json({ success:false, error:'Check serial already in register' });
    const row = insert('check_register', {
      account_id:          req.params.account_id,
      check_serial_number,
      issued_amount:       parseFloat(issued_amount),
      payee_name:          payee_name||null,
      issue_date:          issue_date || new Date().toISOString().split('T')[0],
      memo:                memo||null,
      status:              void_reason ? 'voided' : 'issued',
      void_reason:         void_reason||null,
      match_result:        null,
      matched_at:          null,
      presented_amount:    null,
      presented_payee:     null,
    });
    res.status(201).json({ success:true, data:row });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// POST /api/check-register/:account_id/bulk — bulk upload issued checks (CSV text)
router.post('/:account_id/bulk', (req, res) => {
  try {
    const { csv_text } = req.body;
    if (!csv_text) return res.status(400).json({ success:false, error:'csv_text required' });
    const lines   = csv_text.trim().split('\n').filter(l=>l.trim());
    const headers = lines[0].toLowerCase().replace(/\r/g,'').split(',').map(h=>h.trim().replace(/\s+/g,'_'));
    let added = 0; const errors = [];
    for (let i=1; i<lines.length; i++) {
      try {
        const vals = lines[i].replace(/\r/g,'').split(',');
        const row  = {};
        headers.forEach((h,idx) => { row[h] = (vals[idx]||'').trim(); });
        const sn = row.check_serial_number || row.check_number || row.serial_number || row.check_no;
        const am = parseFloat(row.issued_amount || row.amount || '0');
        if (!sn || !am) { errors.push(`Line ${i+1}: missing serial or amount`); continue; }
        const existing = queryOne('check_register', r => r.account_id === req.params.account_id && r.check_serial_number === sn);
        if (!existing) {
          insert('check_register', {
            account_id: req.params.account_id, check_serial_number:sn, issued_amount:am,
            payee_name: row.payee_name||row.payee||null,
            issue_date: row.issue_date||row.date||new Date().toISOString().split('T')[0],
            memo:row.memo||row.description||null, status:'issued', match_result:null, matched_at:null,
          });
          added++;
        }
      } catch(e) { errors.push(`Line ${i+1}: ${e.message}`); }
    }
    res.json({ success:true, message:`Added ${added} checks to register`, added, errors });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// POST /api/check-register/:account_id/match — match a presented check against register
router.post('/:account_id/match', (req, res) => {
  try {
    const { check_serial_number, amount, payee_name } = req.body;
    const issued = queryOne('check_register', r => r.account_id === req.params.account_id && r.check_serial_number === check_serial_number);
    const matchResult = matchCheck({ amount:parseFloat(amount), payee_name }, issued);
    // Update register entry
    if (issued) {
      update('check_register', r => r.id === issued.id, () => ({
        match_result:    matchResult.result,
        matched_at:      new Date().toISOString(),
        presented_amount:parseFloat(amount),
        presented_payee: payee_name||null,
        status:          matchResult.result === 'FULL_MATCH' ? 'matched' : 'exception',
      }));
    }
    insert('audit_logs', { transaction_id:null, event_type:'risk_flagged', event_summary:`Check ${check_serial_number} match: ${matchResult.result} — ${matchResult.details}`, event_data:{ check_serial_number, amount, payee_name, matchResult }, actor:'AI', severity: matchResult.result==='FULL_MATCH'?'info':'warning' });
    res.json({ success:true, match_result:matchResult.result, details:matchResult.details, issued_check:issued });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// PUT /api/check-register/:account_id/:check_id/void
router.put('/:account_id/:check_id/void', (req, res) => {
  try {
    const { reason } = req.body;
    update('check_register', r => r.id === parseInt(req.params.check_id) && r.account_id === req.params.account_id, () => ({ status:'voided', void_reason:reason||'Voided by user' }));
    res.json({ success:true, message:'Check voided' });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

module.exports = router;
