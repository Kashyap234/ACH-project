// backend/services/calibrationService.js
//
// Weekly calibration pipeline — runs on a schedule set by server.js.
// Each function can also be called independently for testing.
//
//  adaptRuleWeights()        — 3.1 Update rule.learned_weight using decline-correlation
//  computeRuleCorrelations() — 3.2 Build co-occurrence multiplier matrix
//  updateOriginatorTrustScores() — 3.3 Compute 0-100 trust per company_id
//  calibrateThresholds()     — 2.1 Adjust L1/L2/L3 thresholds based on approval rates
//  checkDistributionDrift()  — 2.3 Alert when level distribution drifts from baseline
//  runWeeklyCalibration()    — Orchestrates all of the above

'use strict';

const { queryAll, queryOne, insert, update } = require('../database/db');

// ── Constants ─────────────────────────────────────────────────────────────────
const WEIGHT_MIN_FACTOR   = 0.3;  // learned_weight >= base_weight × 0.3
const WEIGHT_MAX_FACTOR   = 2.5;  // learned_weight <= base_weight × 2.5
const MIN_SAMPLE_SIZE     = 20;   // minimum decisions needed to adapt a rule's weight
const CORR_THRESHOLD      = 0.15; // fire together >15% more than baseline → store multiplier
const CORR_MAX_MULT       = 2.0;  // co-occurrence multiplier capped at 2.0
const DRIFT_ALERT_L1_PP   = 15;   // alert if L1% drifts >15pp from baseline
const DRIFT_ALERT_L3_MIN  = 3;    // alert if L3% drops below 3%
const DRIFT_ALERT_AUTO_MAX = 60;  // alert if autonomy rate exceeds 60%
const THRESHOLD_L1L2_STEP  = 2;   // calibrate threshold by at most ±2 pts per run
const L2_TARGET_APPROVAL   = 0.70; // target 70% approval at L2 (less → lower threshold)

// ──────────────────────────────────────────────────────────────────────────────
// 3.1 ADAPT RULE WEIGHTS
// For each active rule, compute decline-correlation over the last 90 days.
// Rules that fire more on declined transactions get higher learned_weight.
// Rules that fire mostly on approved transactions may be relaxed.
// ──────────────────────────────────────────────────────────────────────────────
async function adaptRuleWeights() {
  console.log('[Calibration] adaptRuleWeights() — starting');

  const cutoff  = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const [rules, decisions] = await Promise.all([
    queryAll('risk_rules', r => r.is_active),
    queryAll('review_decisions', d => d.created_at >= cutoff),
  ]);

  if (decisions.length < MIN_SAMPLE_SIZE) {
    console.log(`[Calibration] Skipping weight adapt — only ${decisions.length} decisions (need ${MIN_SAMPLE_SIZE})`);
    return { skipped: true, reason: 'insufficient_data', decisions: decisions.length };
  }

  const totalDecisions = decisions.length;
  const declineDecisions = decisions.filter(d => d.decision === 'decline');
  const approveDecisions = decisions.filter(d => d.decision === 'approve');
  const baseDeclineRate  = declineDecisions.length / totalDecisions;

  const updates = [];

  for (const rule of rules) {
    // Count how often this rule fired in approved vs declined transactions
    const rulesInApprove = approveDecisions.filter(d =>
      (d.risk_flags_at_decision || []).some(f => f.rule_code === rule.rule_code)
    ).length;
    const rulesInDecline = declineDecisions.filter(d =>
      (d.risk_flags_at_decision || []).some(f => f.rule_code === rule.rule_code)
    ).length;

    const ruleTotalFires = rulesInApprove + rulesInDecline;
    if (ruleTotalFires < 5) continue; // skip rules that barely fire

    const ruleDeclineRate = rulesInDecline / ruleTotalFires;

    // Correlation ratio: how much more likely is a decline when this rule fires vs baseline?
    // Ratio > 1 → this rule is a strong decline predictor → increase weight
    // Ratio < 1 → this rule fires on approved txns too → might reduce weight
    const correlationRatio = baseDeclineRate > 0
      ? ruleDeclineRate / baseDeclineRate
      : 1.0;

    const baseWeight    = parseFloat(rule.weight || 1.0);
    const currentLearned = parseFloat(rule.learned_weight ?? baseWeight);

    // Smoothly nudge toward the implied weight (exponential smoothing, α=0.2)
    const impliedWeight = baseWeight * Math.min(WEIGHT_MAX_FACTOR, Math.max(WEIGHT_MIN_FACTOR, correlationRatio));
    const newLearned    = currentLearned * 0.8 + impliedWeight * 0.2;

    // Hard clamp to [min, max] bounds
    const clampedWeight = Math.max(baseWeight * WEIGHT_MIN_FACTOR, Math.min(baseWeight * WEIGHT_MAX_FACTOR, newLearned));
    const roundedWeight = Math.round(clampedWeight * 1000) / 1000;

    if (Math.abs(roundedWeight - currentLearned) > 0.001) {
      await update('risk_rules', r => r.rule_code === rule.rule_code, () => ({
        learned_weight:           roundedWeight,
        weight_calibrated_at:     new Date().toISOString(),
        weight_calibration_sample: ruleTotalFires,
        weight_correlation_ratio:  Math.round(correlationRatio * 1000) / 1000,
      }));
      updates.push({
        rule_code:         rule.rule_code,
        old_weight:        currentLearned,
        new_weight:        roundedWeight,
        correlation_ratio: Math.round(correlationRatio * 1000) / 1000,
        sample_size:       ruleTotalFires,
      });
    }
  }

  console.log(`[Calibration] adaptRuleWeights() — ${updates.length} rule weights updated`);
  return { updated: updates.length, updates, total_decisions: totalDecisions };
}

// ──────────────────────────────────────────────────────────────────────────────
// 3.2 COMPUTE RULE CORRELATIONS
// Build a pairwise co-occurrence matrix. When two rules fire together significantly
// more than their independent rates predict, store a multiplier > 1.
// ──────────────────────────────────────────────────────────────────────────────
async function computeRuleCorrelations() {
  console.log('[Calibration] computeRuleCorrelations() — starting');

  const cutoff  = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const decisions = await queryAll('review_decisions', d => d.created_at >= cutoff);

  if (decisions.length < MIN_SAMPLE_SIZE) {
    console.log(`[Calibration] Skipping correlations — only ${decisions.length} decisions`);
    return { skipped: true };
  }

  const N = decisions.length;

  // Collect all rule codes that appear in any decision's risk_flags
  const ruleCodeSet = new Set();
  decisions.forEach(d => (d.risk_flags_at_decision || []).forEach(f => ruleCodeSet.add(f.rule_code)));
  const ruleCodes = [...ruleCodeSet];

  // Count individual fire rates
  const fireCount = {};
  ruleCodes.forEach(code => {
    fireCount[code] = decisions.filter(d =>
      (d.risk_flags_at_decision || []).some(f => f.rule_code === code)
    ).length;
  });

  const storedPairs = [];

  for (let i = 0; i < ruleCodes.length; i++) {
    for (let j = i + 1; j < ruleCodes.length; j++) {
      const codeA = ruleCodes[i];
      const codeB = ruleCodes[j];

      const countA = fireCount[codeA] || 0;
      const countB = fireCount[codeB] || 0;
      if (countA < 3 || countB < 3) continue; // skip rare rules

      const countBoth = decisions.filter(d => {
        const codes = (d.risk_flags_at_decision || []).map(f => f.rule_code);
        return codes.includes(codeA) && codes.includes(codeB);
      }).length;

      if (countBoth < 3) continue; // skip very rare co-occurrences

      // Expected joint frequency under independence assumption
      const expectedBoth = (countA / N) * (countB / N) * N;
      if (expectedBoth < 0.5) continue;

      const liftRatio = countBoth / expectedBoth;

      if (liftRatio > 1 + CORR_THRESHOLD) {
        const multiplier = Math.min(CORR_MAX_MULT, Math.round(liftRatio * 100) / 100);

        // Upsert into rule_correlations table
        const pairKey = [codeA, codeB].sort().join('__');
        const existing = await queryOne('rule_correlations', r => r.pair_key === pairKey)
          .catch(() => null);

        if (existing) {
          await update('rule_correlations', r => r.pair_key === pairKey, () => ({
            multiplier,
            co_occur_count:     countBoth,
            expected_count:     Math.round(expectedBoth * 10) / 10,
            lift_ratio:         Math.round(liftRatio * 1000) / 1000,
            calibrated_at:      new Date().toISOString(),
            sample_size:        N,
          }));
        } else {
          await insert('rule_correlations', {
            pair_key:       pairKey,
            rule_code_a:    codeA,
            rule_code_b:    codeB,
            multiplier,
            co_occur_count: countBoth,
            expected_count: Math.round(expectedBoth * 10) / 10,
            lift_ratio:     Math.round(liftRatio * 1000) / 1000,
            calibrated_at:  new Date().toISOString(),
            sample_size:    N,
          });
        }
        storedPairs.push({ codeA, codeB, multiplier, liftRatio: Math.round(liftRatio * 100) / 100 });
      }
    }
  }

  console.log(`[Calibration] computeRuleCorrelations() — ${storedPairs.length} pairs stored/updated`);
  return { pairs: storedPairs.length, top_pairs: storedPairs.slice(0, 5) };
}

// ──────────────────────────────────────────────────────────────────────────────
// 3.3 UPDATE ORIGINATOR TRUST SCORES
// Compute a 0-100 trust score per company_id from transaction history:
//   40% approval_rate + 30% (1 - return_rate) + 20% (1 - mir_rate) + 10% age_factor
// ──────────────────────────────────────────────────────────────────────────────
async function updateOriginatorTrustScores() {
  console.log('[Calibration] updateOriginatorTrustScores() — starting');

  const [decisions, transactions] = await Promise.all([
    queryAll('review_decisions'),
    queryAll('transactions'),
  ]);

  // Group by company_id
  const companyMap = {};
  transactions.forEach(txn => {
    const cid = txn.company_id || txn.company_name;
    if (!cid) return;
    if (!companyMap[cid]) {
      companyMap[cid] = {
        company_id:   cid,
        company_name: txn.company_name,
        txns:         [],
        firstSeen:    txn.created_at,
      };
    }
    companyMap[cid].txns.push(txn);
    if (txn.created_at && txn.created_at < companyMap[cid].firstSeen) {
      companyMap[cid].firstSeen = txn.created_at;
    }
  });

  const updates = [];

  for (const [cid, company] of Object.entries(companyMap)) {
    const txns      = company.txns;
    const total     = txns.length;
    if (total < 1) continue;

    const approved  = txns.filter(t => ['approved', 'auto_approved'].includes(t.status)).length;
    const declined  = txns.filter(t => t.status === 'declined').length;
    const returned  = txns.filter(t => t.has_return || t.return_code).length;

    // MIR rate: transactions that required info requests
    const mirTxns   = txns.filter(t => ['more_info_required', 'ai_workflow'].includes(t.status)).length;

    const approvalRate = approved / total;
    const returnRate   = returned / total;
    const mirRate      = mirTxns / total;

    // Age factor: 0 → 1 as account ages from 0 to 365+ days
    const firstSeenDate  = company.firstSeen ? new Date(company.firstSeen) : new Date();
    const ageInDays      = Math.max(0, (Date.now() - firstSeenDate.getTime()) / 86400000);
    const ageFactor      = Math.min(1.0, ageInDays / 365);

    const trustScore = Math.round(
      (approvalRate   * 40) +
      ((1 - returnRate) * 30) +
      ((1 - mirRate)    * 20) +
      (ageFactor        * 10)
    );
    const clampedTrust = Math.max(0, Math.min(100, trustScore));

    // Upsert originator_profiles table
    const existing = await queryOne('originator_profiles', p => p.company_id === cid)
      .catch(() => null);

    const profileData = {
      company_id:        cid,
      company_name:      company.company_name,
      trust_score:       clampedTrust,
      total_txns:        total,
      approval_rate:     Math.round(approvalRate * 1000) / 1000,
      return_rate:       Math.round(returnRate * 1000) / 1000,
      mir_rate:          Math.round(mirRate * 1000) / 1000,
      age_days:          Math.round(ageInDays),
      age_factor:        Math.round(ageFactor * 1000) / 1000,
      calibrated_at:     new Date().toISOString(),
    };

    if (existing) {
      await update('originator_profiles', p => p.company_id === cid, () => profileData);
    } else {
      await insert('originator_profiles', profileData);
    }

    updates.push({ company_id: cid, trust_score: clampedTrust, total_txns: total });
  }

  console.log(`[Calibration] updateOriginatorTrustScores() — ${updates.length} profiles updated`);
  return { updated: updates.length, profiles: updates };
}

// ──────────────────────────────────────────────────────────────────────────────
// 2.1 CALIBRATE THRESHOLDS
// Adjust L1/L2/L3 score boundaries based on observed L2 approval rates.
// If >70% of L2 transactions are being approved, the L1→L2 threshold is too low
// (too many transactions escalate unnecessarily) → raise it by up to 2 pts.
// ──────────────────────────────────────────────────────────────────────────────
async function calibrateThresholds() {
  console.log('[Calibration] calibrateThresholds() — starting');

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const decisions = await queryAll('review_decisions', d => d.created_at >= cutoff);

  const l2Decisions      = decisions.filter(d => d.risk_level_at_decision === 2);
  const l2ApproveCount   = l2Decisions.filter(d => d.decision === 'approve').length;
  const l2Total          = l2Decisions.length;

  if (l2Total < 10) {
    console.log('[Calibration] calibrateThresholds() — insufficient L2 data, skipping');
    return { skipped: true, reason: 'insufficient_l2_data', l2_decisions: l2Total };
  }

  const l2ApprovalRate = l2ApproveCount / l2Total;

  // Load current thresholds from DB
  const rows = await queryAll('threshold_config').catch(() => []);
  const threshMap = {};
  rows.forEach(r => { threshMap[r._doc_key || r.key] = parseFloat(r.value); });

  const currentL1L2 = threshMap.SCORE_L2_MIN      || 40;
  const currentL2L3 = threshMap.L2_L3_THRESHOLD   || 60;
  const currentL3Direct = threshMap.SCORE_L3_MIN  || 70;

  let delta = 0;
  if (l2ApprovalRate > L2_TARGET_APPROVAL + 0.10) {
    // Too many L2s are approved → threshold too low → raise it
    delta = Math.min(THRESHOLD_L1L2_STEP, Math.round((l2ApprovalRate - L2_TARGET_APPROVAL) * 20));
  } else if (l2ApprovalRate < L2_TARGET_APPROVAL - 0.15) {
    // Too many L2s are declined → threshold too high → lower it
    delta = -Math.min(THRESHOLD_L1L2_STEP, Math.round((L2_TARGET_APPROVAL - l2ApprovalRate) * 20));
  }

  if (delta === 0) {
    console.log(`[Calibration] calibrateThresholds() — no change needed (L2 approval rate: ${Math.round(l2ApprovalRate * 100)}%)`);
    return { no_change: true, l2_approval_rate: l2ApprovalRate, current_l1_l2: currentL1L2 };
  }

  const newL1L2     = Math.max(25, Math.min(55, currentL1L2 + delta));
  const newL2L3     = Math.max(50, Math.min(75, currentL2L3 + delta));
  const newL3Direct = Math.max(60, Math.min(85, currentL3Direct + delta));

  // Upsert each threshold key
  const upsertThreshold = async (key, value, description) => {
    const existing = await queryOne('threshold_config', r => (r._doc_key || r.key) === key).catch(() => null);
    if (existing) {
      await update('threshold_config', r => (r._doc_key || r.key) === key, () => ({ value, calibrated_at: new Date().toISOString() }));
    } else {
      await insert('threshold_config', { _doc_key: key, key, value, description, calibrated_at: new Date().toISOString() });
    }
  };

  await Promise.all([
    upsertThreshold('SCORE_L2_MIN',      newL1L2,     'L1→L2 transition score (calibrated)'),
    upsertThreshold('L2_L3_THRESHOLD',   newL2L3,     'L2→L3 transition score (calibrated)'),
    upsertThreshold('SCORE_L3_MIN',      newL3Direct, 'L1→L3 direct jump score (calibrated)'),
  ]);

  await insert('audit_logs', {
    transaction_id: null,
    event_type:    'threshold_calibrated',
    event_summary: `📊 Thresholds calibrated: L1→L2 ${currentL1L2}→${newL1L2}, L2→L3 ${currentL2L3}→${newL2L3} (L2 approval rate: ${Math.round(l2ApprovalRate * 100)}%, delta: ${delta > 0 ? '+' : ''}${delta})`,
    event_data:    { delta, l2_approval_rate: l2ApprovalRate, l2_total: l2Total, prev: { currentL1L2, currentL2L3, currentL3Direct }, next: { newL1L2, newL2L3, newL3Direct } },
    actor: 'CALIBRATION', severity: 'info',
  });

  // Invalidate riskEngine caches so new thresholds take effect immediately
  try {
    const { invalidateRuleCache } = require('./riskEngine');
    invalidateRuleCache();
  } catch (_) {}

  console.log(`[Calibration] calibrateThresholds() — L1→L2 ${currentL1L2}→${newL1L2} (delta ${delta > 0 ? '+' : ''}${delta})`);
  return { adjusted: true, delta, l2_approval_rate: l2ApprovalRate, new_thresholds: { newL1L2, newL2L3, newL3Direct } };
}

// ──────────────────────────────────────────────────────────────────────────────
// 2.3 CHECK DISTRIBUTION DRIFT
// Alert when:
//  • L1% drifts >15pp from baseline (either direction)
//  • L3% drops below 3% (over-leniency / gaming)
//  • Autonomy rate (AI auto-handled) exceeds 60% (over-automation risk)
// ──────────────────────────────────────────────────────────────────────────────
async function checkDistributionDrift() {
  console.log('[Calibration] checkDistributionDrift() — starting');

  const txns = await queryAll('transactions');
  if (txns.length < 20) {
    return { skipped: true, reason: 'insufficient_data', total: txns.length };
  }

  const total   = txns.length;
  const l1Count = txns.filter(t => t.risk_level === 1).length;
  const l2Count = txns.filter(t => t.risk_level === 2).length;
  const l3Count = txns.filter(t => t.risk_level === 3).length;
  const autoCount = txns.filter(t => ['auto_approved', 'ai_workflow'].includes(t.status)).length;

  const l1Pct   = Math.round((l1Count / total) * 100);
  const l2Pct   = Math.round((l2Count / total) * 100);
  const l3Pct   = Math.round((l3Count / total) * 100);
  const autoPct = Math.round((autoCount / total) * 100);

  // Load or set baseline
  const baselineRow = await queryOne('threshold_config', r => (r._doc_key || r.key) === 'BASELINE_L1_PCT')
    .catch(() => null);

  const alerts = [];

  if (!baselineRow) {
    // First run — store current distribution as baseline
    await insert('threshold_config', { _doc_key: 'BASELINE_L1_PCT', key: 'BASELINE_L1_PCT', value: l1Pct, description: 'Baseline L1 distribution %' });
    await insert('threshold_config', { _doc_key: 'BASELINE_L3_PCT', key: 'BASELINE_L3_PCT', value: l3Pct, description: 'Baseline L3 distribution %' });
    await insert('threshold_config', { _doc_key: 'BASELINE_AUTO_PCT', key: 'BASELINE_AUTO_PCT', value: autoPct, description: 'Baseline autonomy %' });
    console.log(`[Calibration] Baseline set: L1=${l1Pct}% L2=${l2Pct}% L3=${l3Pct}% Auto=${autoPct}%`);
  } else {
    const baselineL1  = parseFloat(baselineRow.value) || l1Pct;
    const l1Drift     = Math.abs(l1Pct - baselineL1);

    if (l1Drift > DRIFT_ALERT_L1_PP) {
      const direction = l1Pct > baselineL1 ? 'up' : 'down';
      alerts.push({ type: 'L1_DRIFT', message: `L1% drifted ${direction} by ${l1Drift}pp (baseline ${baselineL1}%, now ${l1Pct}%)`, severity: 'warning' });
    }
    if (l3Pct < DRIFT_ALERT_L3_MIN) {
      alerts.push({ type: 'L3_LOW', message: `L3% is ${l3Pct}% (below ${DRIFT_ALERT_L3_MIN}% threshold) — possible rule relaxation or data anomaly`, severity: 'critical' });
    }
    if (autoPct > DRIFT_ALERT_AUTO_MAX) {
      alerts.push({ type: 'AUTONOMY_HIGH', message: `Autonomy rate is ${autoPct}% (exceeds ${DRIFT_ALERT_AUTO_MAX}% limit) — review pattern promotion policy`, severity: 'warning' });
    }
  }

  const distribution = { l1Pct, l2Pct, l3Pct, autoPct, total, l1Count, l2Count, l3Count, autoCount };

  if (alerts.length > 0) {
    console.warn(`[Calibration] ⚠️ Distribution drift detected: ${alerts.map(a => a.type).join(', ')}`);
    for (const alert of alerts) {
      await insert('audit_logs', {
        transaction_id: null,
        event_type:    'distribution_drift',
        event_summary: `⚠️ DRIFT: ${alert.message}`,
        event_data:    { ...alert, distribution },
        actor: 'CALIBRATION', severity: alert.severity,
      });
    }
  } else {
    console.log(`[Calibration] checkDistributionDrift() — no drift detected (L1=${l1Pct}% L2=${l2Pct}% L3=${l3Pct}% Auto=${autoPct}%)`);
  }

  return { alerts, distribution, checked_at: new Date().toISOString() };
}

// ──────────────────────────────────────────────────────────────────────────────
// WEEKLY CALIBRATION ORCHESTRATOR
// Runs all calibration steps in the correct dependency order:
//  1. Adapt rule weights (affects scoring)
//  2. Compute rule correlations (affects co-occurrence bonuses)
//  3. Update originator trust scores (affects score multipliers)
//  4. Calibrate thresholds (uses updated approval rates)
//  5. Check distribution drift (read-only audit)
// ──────────────────────────────────────────────────────────────────────────────
async function runWeeklyCalibration() {
  const startedAt = new Date().toISOString();
  console.log(`\n🔄 Weekly calibration started — ${startedAt}`);

  const results = {};

  try {
    results.ruleWeights = await adaptRuleWeights();
  } catch (e) {
    console.error('[Calibration] adaptRuleWeights failed:', e.message);
    results.ruleWeights = { error: e.message };
  }

  try {
    results.correlations = await computeRuleCorrelations();
  } catch (e) {
    console.error('[Calibration] computeRuleCorrelations failed:', e.message);
    results.correlations = { error: e.message };
  }

  try {
    results.trustScores = await updateOriginatorTrustScores();
  } catch (e) {
    console.error('[Calibration] updateOriginatorTrustScores failed:', e.message);
    results.trustScores = { error: e.message };
  }

  try {
    results.thresholds = await calibrateThresholds();
  } catch (e) {
    console.error('[Calibration] calibrateThresholds failed:', e.message);
    results.thresholds = { error: e.message };
  }

  try {
    results.drift = await checkDistributionDrift();
  } catch (e) {
    console.error('[Calibration] checkDistributionDrift failed:', e.message);
    results.drift = { error: e.message };
  }

  // Invalidate all riskEngine caches so calibrated values take effect immediately
  try {
    const { invalidateRuleCache } = require('./riskEngine');
    invalidateRuleCache();
    console.log('[Calibration] riskEngine caches invalidated');
  } catch (e) {
    console.warn('[Calibration] Could not invalidate riskEngine cache:', e.message);
  }

  const completedAt = new Date().toISOString();
  await insert('audit_logs', {
    transaction_id: null,
    event_type:    'weekly_calibration_complete',
    event_summary: `🔄 Weekly calibration complete — weights: ${results.ruleWeights?.updated ?? 'n/a'} updated, ` +
                   `correlations: ${results.correlations?.pairs ?? 'n/a'}, ` +
                   `trust profiles: ${results.trustScores?.updated ?? 'n/a'}, ` +
                   `threshold delta: ${results.thresholds?.delta ?? 0}, ` +
                   `drift alerts: ${results.drift?.alerts?.length ?? 0}`,
    event_data:    { started_at: startedAt, completed_at: completedAt, results },
    actor: 'CALIBRATION', severity: 'info',
  }).catch(e => console.warn('[Calibration] Audit log insert failed:', e.message));

  console.log(`✅ Weekly calibration complete — ${completedAt}`);
  return { started_at: startedAt, completed_at: completedAt, results };
}

module.exports = {
  adaptRuleWeights,
  computeRuleCorrelations,
  updateOriginatorTrustScores,
  calibrateThresholds,
  checkDistributionDrift,
  runWeeklyCalibration,
};
