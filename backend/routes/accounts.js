// backend/routes/accounts.js
// Account-level ACH filter configuration + whitelist + dual control
const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, insert, update, getTable } = require('../database/db');

// ── Seed default accounts on first call ─────────────────────────────────────
function ensureAccounts() {
  const accts = getTable('accounts');
  if (accts.length === 0) {
    const defaults = [
      { account_id:'ACC-001', account_name:'Operating Checking Account', account_number:'****1234', filter_mode:'positive_pay',    debit_block:false, reverse_positive_pay:false, cutoff_time:'14:00', default_action:'return', max_daily_debit:100000, authorized_company_ids:[], is_active:true },
      { account_id:'ACC-002', account_name:'Payroll Account',            account_number:'****5678', filter_mode:'allow_list',       debit_block:false, reverse_positive_pay:false, cutoff_time:'14:00', default_action:'return', max_daily_debit:500000, authorized_company_ids:['ACMECORP01','PAYROLL0001'], is_active:true },
      { account_id:'ACC-003', account_name:'Tax Reserve Account',        account_number:'****9012', filter_mode:'block_all',        debit_block:true,  reverse_positive_pay:false, cutoff_time:'12:00', default_action:'return', max_daily_debit:0,      authorized_company_ids:[], is_active:true },
      { account_id:'ACC-004', account_name:'Vendor Payments Account',    account_number:'****3456', filter_mode:'reverse_positive_pay', debit_block:false, reverse_positive_pay:true, cutoff_time:'13:00', default_action:'pay',  max_daily_debit:250000, authorized_company_ids:[], is_active:true },
    ];
    defaults.forEach(a => insert('accounts', a));
  }
}

// GET /api/accounts
router.get('/', (req, res) => {
  try {
    ensureAccounts();
    const accounts = queryAll('accounts', null, { orderBy: 'account_name', desc: false });
    res.json({ success: true, data: accounts });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// GET /api/accounts/:id
router.get('/:id', (req, res) => {
  try {
    ensureAccounts();
    const acct = queryOne('accounts', a => a.account_id === req.params.id);
    if (!acct) return res.status(404).json({ success:false, error:'Account not found' });
    const rules    = queryAll('acl_filter_rules', r => r.account_id === req.params.id);
    const register = queryAll('check_register',   r => r.account_id === req.params.id, { orderBy:'created_at', desc:true, limit:50 });
    res.json({ success:true, data:{ ...acct, filter_rules:rules, check_register:register } });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// PUT /api/accounts/:id — update filter mode, cutoff, etc.
router.put('/:id', (req, res) => {
  try {
    const { filter_mode, debit_block, reverse_positive_pay, cutoff_time, default_action, max_daily_debit, authorized_company_ids, account_name } = req.body;
    update('accounts', a => a.account_id === req.params.id, () => ({
      ...(filter_mode              !== undefined && { filter_mode }),
      ...(debit_block              !== undefined && { debit_block }),
      ...(reverse_positive_pay     !== undefined && { reverse_positive_pay }),
      ...(cutoff_time              !== undefined && { cutoff_time }),
      ...(default_action           !== undefined && { default_action }),
      ...(max_daily_debit          !== undefined && { max_daily_debit }),
      ...(authorized_company_ids   !== undefined && { authorized_company_ids }),
      ...(account_name             !== undefined && { account_name }),
    }));
    insert('audit_logs', { transaction_id:null, event_type:'rule_updated', event_summary:`Account ${req.params.id} filter config updated: mode=${filter_mode||'unchanged'}`, event_data:req.body, actor:'HUMAN', severity:'info' });
    res.json({ success:true, message:'Account updated' });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// POST /api/accounts/:id/whitelist — add company to allow list
router.post('/:id/whitelist', (req, res) => {
  try {
    const { company_id, company_name, max_amount, frequency_limit, notes } = req.body;
    if (!company_id) return res.status(400).json({ success:false, error:'company_id required' });
    const acct = queryOne('accounts', a => a.account_id === req.params.id);
    if (!acct) return res.status(404).json({ success:false, error:'Not found' });
    // Add to authorized list
    const existing = acct.authorized_company_ids || [];
    if (!existing.includes(company_id)) {
      update('accounts', a => a.account_id === req.params.id, a => ({ authorized_company_ids: [...(a.authorized_company_ids||[]), company_id] }));
    }
    // Also insert into detailed filter rules
    insert('acl_filter_rules', { account_id:req.params.id, company_id, company_name:company_name||company_id, max_amount:parseFloat(max_amount)||null, frequency_limit:frequency_limit||null, notes:notes||null, is_active:true });
    insert('audit_logs', { transaction_id:null, event_type:'rule_updated', event_summary:`Company ${company_id} added to ACH allow list for account ${req.params.id}`, event_data:{ company_id, max_amount, frequency_limit }, actor:'HUMAN', severity:'info' });
    res.json({ success:true, message:`${company_id} added to allow list` });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// DELETE /api/accounts/:id/whitelist/:company_id
router.delete('/:id/whitelist/:company_id', (req, res) => {
  try {
    update('accounts', a => a.account_id === req.params.id, a => ({
      authorized_company_ids: (a.authorized_company_ids||[]).filter(c => c !== req.params.company_id)
    }));
    update('acl_filter_rules', r => r.account_id === req.params.id && r.company_id === req.params.company_id, () => ({ is_active:false }));
    res.json({ success:true, message:`${req.params.company_id} removed` });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

module.exports = router;
