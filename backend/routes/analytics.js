// backend/routes/analytics.js
const express = require('express');
const router  = express.Router();
const { queryAll } = require('../database/db');
const { getSupabase } = require('../database/supabase');
const { getLearningStats } = require('../services/learningPipeline');

router.get('/dashboard', async (req, res) => {
  try {
    const sb = getSupabase();

    // Only transfer the 5 fields needed for stats (~95% less bandwidth than select('*'))
    const { data: txnRows, error: txnErr } = await sb
      .from('transactions')
      .select('data->status, data->risk_level, data->amount, data->risk_score, data->created_at');
    if (txnErr) throw new Error(txnErr.message);

    const txns = txnRows || [];
    const total         = txns.length;
    const autoApproved  = txns.filter(t => t.status === 'auto_approved').length;
    const approved      = txns.filter(t => t.status === 'approved').length;
    const declined      = txns.filter(t => t.status === 'declined').length;
    const pending       = txns.filter(t => t.status === 'under_review').length;
    const l1 = txns.filter(t => t.risk_level === 1).length;
    const l2 = txns.filter(t => t.risk_level === 2).length;
    const l3 = txns.filter(t => t.risk_level === 3).length;
    const totalValue    = txns.reduce((a, t) => a + (parseFloat(t.amount) || 0), 0);
    const autoApprValue = txns.filter(t => t.status === 'auto_approved').reduce((a, t) => a + (parseFloat(t.amount) || 0), 0);
    const avgRisk = total > 0 ? txns.reduce((a, t) => a + (parseFloat(t.risk_score) || 0), 0) / total : 0;

    const todayStr       = new Date().toISOString().split('T')[0];
    const todayTxns      = txns.filter(t => t.created_at?.startsWith(todayStr));
    const todayAutoApprv = todayTxns.filter(t => t.status === 'auto_approved').length;

    const learning = await getLearningStats();

    // Fetch recent audit logs — server-side ordered + limited, minimal columns
    const { data: logRows, error: logErr } = await sb
      .from('audit_logs')
      .select('data->transaction_id, data->action, data->actor, data->created_at')
      .order('created_at', { ascending: false })
      .limit(10);
    if (logErr) throw new Error(logErr.message);

    // Batch-fetch the transactions referenced by those logs (eliminates N+1)
    const txnIds = [...new Set((logRows || []).map(l => l.transaction_id).filter(Boolean))];
    const txnDetailMap = {};
    if (txnIds.length > 0) {
      const { data: details } = await sb
        .from('transactions')
        .select('data->transaction_id, data->company_name, data->amount, data->risk_level')
        .in('data->>transaction_id', txnIds);
      (details || []).forEach(t => { txnDetailMap[t.transaction_id] = t; });
    }

    const recentActivity = (logRows || []).map(l => {
      const t = txnDetailMap[l.transaction_id];
      return { ...l, company_name: t?.company_name, amount: t?.amount, risk_level: t?.risk_level };
    });

    res.json({ success: true, data: {
      totals: { total, autoApproved, approved, declined, pending },
      values: { totalValue: Math.round(totalValue * 100) / 100, autoApprovedValue: Math.round(autoApprValue * 100) / 100 },
      riskDistribution: { level1: l1, level2: l2, level3: l3 },
      rates: { autoResolutionRate: total > 0 ? Math.round((autoApproved / total) * 100) : 0, humanReviewRequired: l2 + l3, avgRiskScore: Math.round(avgRisk * 10) / 10 },
      today: { total: todayTxns.length, autoApproved: todayAutoApprv },
      learning,
      recentActivity,
    }});
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/trends', async (req, res) => {
  try {
    const sb = getSupabase();
    const { data: txnRows, error } = await sb
      .from('transactions')
      .select('data->status, data->risk_level, data->risk_score, data->created_at');
    if (error) throw new Error(error.message);
    const allTxns = txnRows || [];
    const byDay = {};
    allTxns.forEach(t => {
      const day = (t.created_at || '').slice(0, 10);
      if (!day) return;
      if (!byDay[day]) byDay[day] = { day, total:0, auto_approved:0, human_reviewed:0, level1:0, level2:0, level3:0, risk_total:0 };
      byDay[day].total++;
      if (t.status === 'auto_approved') byDay[day].auto_approved++;
      if (['approved','declined'].includes(t.status)) byDay[day].human_reviewed++;
      if (t.risk_level === 1) byDay[day].level1++;
      if (t.risk_level === 2) byDay[day].level2++;
      if (t.risk_level === 3) byDay[day].level3++;
      byDay[day].risk_total += t.risk_score || 0;
    });
    const trends = Object.values(byDay)
      .map(d => ({ ...d, avg_risk_score: d.total > 0 ? Math.round(d.risk_total/d.total) : 0 }))
      .sort((a, b) => a.day.localeCompare(b.day));
    res.json({ success: true, data: trends });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/rules', async (req, res) => {
  try {
    const rules = await queryAll('risk_rules', null, { orderBy: 'trigger_count', desc: true });
    res.json({ success: true, data: rules });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/patterns', async (req, res) => {
  try {
    const patterns = await queryAll('learning_patterns', null, { orderBy: 'total_decisions', desc: true, limit: 20 });
    res.json({ success: true, data: patterns });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/audit', async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const lim = parseInt(limit), off = parseInt(offset);
    const sb  = getSupabase();

    // Get total count without transferring any rows
    const { count: total, error: cntErr } = await sb
      .from('audit_logs').select('*', { count: 'exact', head: true });
    if (cntErr) throw new Error(cntErr.message);

    // Fetch only the page needed, with minimal columns, server-side ordered
    const { data: logRows, error: logErr } = await sb
      .from('audit_logs')
      .select('data->transaction_id, data->action, data->actor, data->created_at, data->details, _doc_key')
      .order('created_at', { ascending: false })
      .range(off, off + lim - 1);
    if (logErr) throw new Error(logErr.message);

    // Batch-fetch referenced transactions (eliminates N+1)
    const txnIds = [...new Set((logRows || []).map(l => l.transaction_id).filter(Boolean))];
    const txnMap = {};
    if (txnIds.length > 0) {
      const { data: details } = await sb
        .from('transactions')
        .select('data->transaction_id, data->company_name, data->amount, data->sec_code, data->risk_level')
        .in('data->>transaction_id', txnIds);
      (details || []).forEach(t => { txnMap[t.transaction_id] = t; });
    }

    const enriched = (logRows || []).map(l => {
      const t = txnMap[l.transaction_id];
      return { ...l, company_name: t?.company_name, amount: t?.amount, sec_code: t?.sec_code, risk_level: t?.risk_level };
    });
    res.json({ success: true, data: enriched, total: total || 0 });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
