// backend/routes/analytics.js (Firestore async)
const express = require('express');
const router  = express.Router();
const { queryAll, queryOne } = require('../database/db');
const { getLearningStats } = require('../services/learningPipeline');

router.get('/dashboard', async (req, res) => {
  try {
    const allTxns = await queryAll('transactions');
    const total       = allTxns.length;
    const autoApproved= allTxns.filter(t => t.status === 'auto_approved').length;
    const approved    = allTxns.filter(t => t.status === 'approved').length;
    const declined    = allTxns.filter(t => t.status === 'declined').length;
    const pending     = allTxns.filter(t => t.status === 'under_review').length;
    const l1 = allTxns.filter(t => t.risk_level === 1).length;
    const l2 = allTxns.filter(t => t.risk_level === 2).length;
    const l3 = allTxns.filter(t => t.risk_level === 3).length;
    const totalValue    = allTxns.reduce((a, t) => a + (parseFloat(t.amount) || 0), 0);
    const autoApprValue = allTxns.filter(t => t.status === 'auto_approved').reduce((a, t) => a + (parseFloat(t.amount) || 0), 0);
    const avgRisk = total > 0 ? allTxns.reduce((a, t) => a + (parseFloat(t.risk_score) || 0), 0) / total : 0;

    const todayStr  = new Date().toISOString().split('T')[0];
    const todayTxns = allTxns.filter(t => t.created_at?.startsWith(todayStr));
    const todayAutoApprv = todayTxns.filter(t => t.status === 'auto_approved').length;

    const learning   = await getLearningStats();
    const allLogs    = await queryAll('audit_logs', null, { orderBy: 'created_at', desc: true, limit: 10 });
    const recentLogs = await Promise.all(allLogs.map(async l => {
      const txn = l.transaction_id ? await queryOne('transactions', t => t.transaction_id === l.transaction_id) : null;
      return { ...l, company_name: txn?.company_name, amount: txn?.amount, risk_level: txn?.risk_level };
    }));

    res.json({ success: true, data: {
      totals: { total, autoApproved, approved, declined, pending },
      values: { totalValue: Math.round(totalValue * 100) / 100, autoApprovedValue: Math.round(autoApprValue * 100) / 100 },
      riskDistribution: { level1: l1, level2: l2, level3: l3 },
      rates: { autoResolutionRate: total > 0 ? Math.round((autoApproved/total)*100) : 0, humanReviewRequired: l2+l3, avgRiskScore: Math.round(avgRisk * 10) / 10 },
      today: { total: todayTxns.length, autoApproved: todayAutoApprv },
      learning,
      recentActivity: recentLogs
    }});
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/trends', async (req, res) => {
  try {
    const allTxns = await queryAll('transactions');
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
    const all   = await queryAll('audit_logs', null, { orderBy: 'created_at', desc: true });
    const total = all.length;
    const page  = all.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
    const enriched = await Promise.all(page.map(async l => {
      const txn = l.transaction_id ? await queryOne('transactions', t => t.transaction_id === l.transaction_id) : null;
      return { ...l, company_name: txn?.company_name, amount: txn?.amount, sec_code: txn?.sec_code, risk_level: txn?.risk_level };
    }));
    res.json({ success: true, data: enriched, total });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
