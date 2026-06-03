// backend/routes/exceptions.js
// Exception Dashboard — items requiring pay/return decision before cutoff deadline
const express = require('express');
const router  = express.Router();
const { queryAll, queryOne, insert, update } = require('../database/db');

// ── Build exceptions from under_review transactions ──────────────────────────
function buildExceptions(accountId) {
  const accounts   = queryAll('accounts');
  const allTxns    = queryAll('transactions', t => t.status === 'under_review', { orderBy:'created_at', desc:true });
  const exceptions = [];

  for (const txn of allTxns) {
    // Determine which account this belongs to
    const acct = accountId
      ? queryOne('accounts', a => a.account_id === accountId)
      : accounts[0]; // default to first account for demo

    if (!acct) continue;

    // Build exception record
    const createdAt  = new Date(txn.created_at);
    const [hh, mm]   = (acct.cutoff_time || '14:00').split(':').map(Number);
    const cutoff     = new Date(createdAt);
    cutoff.setHours(hh, mm, 0, 0);
    // If created after cutoff, deadline is next day
    if (createdAt > cutoff) cutoff.setDate(cutoff.getDate() + 1);

    const now       = new Date();
    const msLeft    = cutoff - now;
    const isPastDue = msLeft < 0;

    exceptions.push({
      exception_id:     `EXC-${txn.transaction_id}`,
      transaction_id:   txn.transaction_id,
      account_id:       acct.account_id,
      account_name:     acct.account_name,
      sec_code:         txn.sec_code,
      company_name:     txn.company_name,
      company_id:       txn.company_id,
      amount:           txn.amount,
      transaction_type: txn.transaction_type,
      risk_level:       txn.risk_level,
      risk_score:       txn.risk_score,
      risk_flags:       txn.risk_flags,
      created_at:       txn.created_at,
      cutoff_time:      acct.cutoff_time,
      cutoff_datetime:  cutoff.toISOString(),
      ms_remaining:     Math.max(0, msLeft),
      is_past_due:      isPastDue,
      default_action:   acct.default_action,
      filter_mode:      acct.filter_mode,
      ai_recommendation:txn.ai_recommendation,
      ai_brief:         txn.ai_brief,
    });
  }
  return exceptions;
}

// GET /api/exceptions — all pending exceptions with countdown
router.get('/', (req, res) => {
  try {
    const { account_id } = req.query;
    const exceptions = buildExceptions(account_id || null);
    const pastDue    = exceptions.filter(e => e.is_past_due).length;
    const urgent     = exceptions.filter(e => !e.is_past_due && e.ms_remaining < 3600000).length; // < 1 hour

    res.json({
      success: true,
      data:    exceptions,
      summary: {
        total:    exceptions.length,
        past_due: pastDue,
        urgent:   urgent,       // < 1 hour remaining
        safe:     exceptions.length - pastDue - urgent,
      }
    });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// POST /api/exceptions/:txn_id/decide — pay or return with deadline check
router.post('/:txn_id/decide', (req, res) => {
  try {
    const { decision, reason } = req.body;
    if (!['pay','return'].includes(decision)) return res.status(400).json({ success:false, error:'decision must be pay or return' });

    const txn = queryOne('transactions', t => t.transaction_id === req.params.txn_id);
    if (!txn) return res.status(404).json({ success:false, error:'Transaction not found' });

    const newStatus = decision === 'pay' ? 'approved' : 'declined';
    update('transactions', t => t.transaction_id === req.params.txn_id, () => ({
      status: newStatus, reviewer_decision: decision === 'pay' ? 'approve' : 'decline',
      reviewer_notes: reason || `Exception ${decision} decision`, decision_at: new Date().toISOString()
    }));

    insert('audit_logs', {
      transaction_id: req.params.txn_id,
      event_type:    'human_reviewed',
      event_summary: `Exception ${decision.toUpperCase()} decision made${reason ? ': ' + reason : ''}`,
      event_data:    { decision, source:'exception_dashboard' },
      actor:   'HUMAN', severity: decision === 'return' ? 'warning' : 'info'
    });

    res.json({ success:true, message:`Exception ${decision.toUpperCase()}`, status:newStatus });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// POST /api/exceptions/apply-defaults — trigger default action for all past-due items
router.post('/apply-defaults', (req, res) => {
  try {
    const exceptions = buildExceptions(null).filter(e => e.is_past_due);
    let applied = 0;
    for (const exc of exceptions) {
      const txn = queryOne('transactions', t => t.transaction_id === exc.transaction_id);
      if (!txn || txn.status !== 'under_review') continue;
      const defaultAction = exc.default_action === 'pay' ? 'approved' : 'declined';
      update('transactions', t => t.transaction_id === exc.transaction_id, () => ({
        status: defaultAction, reviewer_decision: exc.default_action === 'pay' ? 'approve' : 'decline',
        reviewer_notes: `DEFAULT ACTION: ${exc.default_action.toUpperCase()} — past cutoff ${exc.cutoff_time}`, decision_at: new Date().toISOString()
      }));
      insert('audit_logs', {
        transaction_id: exc.transaction_id,
        event_type:    'human_reviewed',
        event_summary: `⏰ DEFAULT ACTION: ${exc.default_action.toUpperCase()} — review window expired at ${exc.cutoff_time}`,
        event_data:    { default_action: exc.default_action, cutoff_time: exc.cutoff_time, account_id: exc.account_id },
        actor: 'SYSTEM', severity: 'warning'
      });
      applied++;
    }
    res.json({ success:true, message:`Applied default actions to ${applied} past-due exceptions`, applied });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

module.exports = router;
