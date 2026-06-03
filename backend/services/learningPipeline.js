// backend/services/learningPipeline.js — Rich feature vector learning
const crypto = require('crypto');
const { queryAll, queryOne, insert, update } = require('../database/db');

const MIN_DECISIONS  = 5;
const CONF_THRESHOLD = 0.85;

// ── Confidence weight by reviewer certainty ─────────────────────────────────
const CONFIDENCE_WEIGHTS = { HIGH: 1.0, MEDIUM: 0.7, LOW: 0.4 };

function getAmountBucket(amount) {
  if (amount < 500)     return 'micro';
  if (amount < 5000)    return 'small';
  if (amount < 25000)   return 'medium';
  if (amount < 100000)  return 'large';
  return 'xlarge';
}

// ── Rich feature vector from transaction + reviewer enrichment ──────────────
function buildFeatureVector(txn, riskFlags, reviewData = {}) {
  return {
    // Transaction identity
    sec_code:             txn.sec_code,
    transaction_code:     txn.transaction_code || 'unknown',
    transaction_type:     txn.transaction_type,
    amount_bucket:        getAmountBucket(txn.amount),
    account_type:         txn.account_type || 'checking',
    is_prenote:           txn.prenote || false,

    // Risk indicators
    flag_codes:           (riskFlags || []).map(f => f.rule_code).sort(),
    flag_count:           (riskFlags || []).length,
    max_flag_level:       (riskFlags || []).reduce((m, f) => Math.max(m, f.flag_level), 1),
    has_ofac_flag:        (riskFlags || []).some(f => f.category === 'sanctions'),
    has_aml_flag:         txn.aml_flag || false,

    // Compliance
    has_addenda:          txn.addenda_record_indicator === '1' || txn.addenda_record_indicator === 1,
    authorization_type:   txn.authorization_type || null,
    ofac_screened:        txn.ofac_screened || false,

    // Reviewer enrichment (from rich review form)
    identity_verified:        reviewData.identity_verified || false,
    identity_method:          reviewData.identity_verification_method || null,
    counterparty_type:        reviewData.counterparty_type || 'UNKNOWN',
    fraud_indicators_present: (reviewData.fraud_indicators || []).length > 0,
    fraud_indicators:         reviewData.fraud_indicators || [],
    business_purpose:         reviewData.business_purpose || null,
    authorization_confirmed:  reviewData.authorization_reviewed || false,
    customer_contacted:       reviewData.customer_contacted || false,
    customer_outcome:         reviewData.customer_contact_outcome || null,
    escalation_level:         reviewData.escalation_level || 'none',
  };
}

function generatePatternHash(txn, riskFlags) {
  const key = {
    sec_code:      txn.sec_code,
    txn_type:      txn.transaction_type,
    amount_bucket: getAmountBucket(txn.amount),
    flag_codes:    (riskFlags || []).map(f => f.rule_code).sort().join(','),
    account_type:  txn.account_type || 'checking',
  };
  return crypto.createHash('sha256').update(JSON.stringify(key)).digest('hex').slice(0, 16);
}

function buildPatternDescription(txn, riskFlags) {
  const bucket   = getAmountBucket(txn.amount);
  const flagList = (riskFlags || []).map(f => f.rule_name).join(' | ') || 'No flags';
  return `${txn.sec_code} ${txn.transaction_type?.toUpperCase()} [${bucket}] via ${txn.account_type || 'checking'} | ${flagList}`;
}

// ── Record a rich human decision ────────────────────────────────────────────
async function recordDecision(txn, decision, reviewData, riskResult) {
  const {
    decision_reason, identity_verified, identity_verification_method, counterparty_type,
    account_ownership_confirmed, fraud_indicators, risk_override_reason, escalation_level,
    escalation_reason, business_purpose, authorization_reviewed, authorization_type_confirmed,
    customer_contacted, customer_contact_outcome, recommended_return_code, return_code_reason,
    reviewer_confidence, additional_notes, time_to_decide_seconds
  } = reviewData || {};

  const confWeight = CONFIDENCE_WEIGHTS[reviewer_confidence || 'MEDIUM'];

  // 1. Insert rich review decision
  insert('review_decisions', {
    transaction_id:                txn.transaction_id,
    decision,
    decision_reason:               decision_reason || null,
    reviewer_confidence:           reviewer_confidence || 'MEDIUM',
    confidence_weight:             confWeight,
    time_to_decide_seconds:        time_to_decide_seconds || null,

    // Risk context
    risk_level_at_decision:        riskResult.riskLevel,
    risk_score_at_decision:        riskResult.riskScore,
    risk_flags_at_decision:        riskResult.riskFlags,
    ai_recommendation:             txn.ai_recommendation || null,
    ai_confidence:                 txn.ai_confidence || null,

    // Identity & counterparty
    identity_verified:             identity_verified || false,
    identity_verification_method:  identity_verification_method || null,
    counterparty_type:             counterparty_type || null,
    account_ownership_confirmed:   account_ownership_confirmed || false,

    // Fraud assessment
    fraud_indicators:              fraud_indicators || [],
    risk_override_reason:          risk_override_reason || null,

    // Escalation
    escalation_level:              escalation_level || 'none',
    escalation_reason:             escalation_reason || null,

    // Business justification
    business_purpose:              business_purpose || null,
    authorization_reviewed:        authorization_reviewed || false,
    authorization_type_confirmed:  authorization_type_confirmed || null,
    customer_contacted:            customer_contacted || false,
    customer_contact_outcome:      customer_contact_outcome || null,

    // Return info
    recommended_return_code:       recommended_return_code || null,
    return_code_reason:            return_code_reason || null,

    additional_notes:              additional_notes || null,
  });

  // 2. Also insert into legacy human_decisions for backward compat
  insert('human_decisions', {
    transaction_id:            txn.transaction_id,
    reviewer_id:               'reviewer_01',
    reviewer_name:             'Risk Analyst',
    decision,
    decision_reason:           decision_reason || null,
    risk_level_at_decision:    riskResult.riskLevel,
    risk_score_at_decision:    riskResult.riskScore,
    risk_flags_at_decision:    riskResult.riskFlags,
    ai_recommendation_at_decision: txn.ai_recommendation || null,
    ai_confidence_at_decision: txn.ai_confidence || null
  });

  // 3. Update / create learning pattern
  const patternHash    = generatePatternHash(txn, riskResult.riskFlags);
  const description    = buildPatternDescription(txn, riskResult.riskFlags);
  const featureVector  = buildFeatureVector(txn, riskResult.riskFlags, reviewData);
  const existing       = queryOne('learning_patterns', p => p.pattern_hash === patternHash);

  if (existing) {
    // Weighted score update
    const approveW = existing.approve_weight + (decision === 'approve' ? confWeight : 0);
    const declineW = existing.decline_weight + (decision === 'decline' ? confWeight : 0);
    const totalW   = approveW + declineW;
    const newConf  = totalW > 0 ? approveW / totalW : 0;
    const newTotal = existing.total_decisions + 1;

    // Aggregate fraud indicator counts
    const flagCounts = { ...(existing.fraud_indicator_counts || {}) };
    (fraud_indicators || []).forEach(fi => { flagCounts[fi] = (flagCounts[fi] || 0) + 1; });

    update('learning_patterns', p => p.pattern_hash === patternHash, () => ({
      approve_count:            existing.approve_count + (decision === 'approve' ? 1 : 0),
      decline_count:            existing.decline_count + (decision === 'decline' ? 1 : 0),
      approve_weight:           approveW,
      decline_weight:           declineW,
      total_decisions:          newTotal,
      confidence_score:         newConf,
      last_feature_vector:      featureVector,
      fraud_indicator_counts:   flagCounts,
      avg_time_to_decide:       existing.avg_time_to_decide
        ? (existing.avg_time_to_decide * (newTotal - 1) + (time_to_decide_seconds || 0)) / newTotal
        : (time_to_decide_seconds || 0),
      most_common_purpose:      business_purpose || existing.most_common_purpose,
    }));

    // Check promotion
    const updated = queryOne('learning_patterns', p => p.pattern_hash === patternHash);
    if (!existing.promoted_to_level1 && !existing.is_frozen && updated.total_decisions >= MIN_DECISIONS && updated.confidence_score >= CONF_THRESHOLD) {
      _promotePattern(patternHash, updated.total_decisions, updated.confidence_score);
    }
    // Check demotion
    if (existing.promoted_to_level1 && updated.confidence_score < 0.70) {
      _demotePattern(patternHash, updated.confidence_score);
    }
  } else {
    const approveW = decision === 'approve' ? confWeight : 0;
    const declineW = decision === 'decline' ? confWeight : 0;
    insert('learning_patterns', {
      pattern_hash:           patternHash,
      pattern_description:    description,
      feature_vector:         featureVector,
      last_feature_vector:    featureVector,
      sec_codes:              [txn.sec_code],
      amount_range_min:       txn.amount * 0.5,
      amount_range_max:       txn.amount * 2.0,
      total_decisions:        1,
      approve_count:          decision === 'approve' ? 1 : 0,
      decline_count:          decision === 'decline' ? 1 : 0,
      approve_weight:         approveW,
      decline_weight:         declineW,
      confidence_score:       approveW / (approveW + declineW + 0.001),
      promoted_to_level1:     false,
      is_frozen:              false,
      demotion_count:         0,
      min_decisions_required: MIN_DECISIONS,
      confidence_threshold:   CONF_THRESHOLD,
      fraud_indicator_counts: {},
      most_common_purpose:    business_purpose || null,
      avg_time_to_decide:     time_to_decide_seconds || 0,
    });
  }

  // 4. Audit log
  insert('audit_logs', {
    transaction_id: txn.transaction_id,
    event_type:     'human_reviewed',
    event_summary:  `Human ${decision.toUpperCase()}${decision === 'approve' ? 'D' : 'D'} · Confidence: ${reviewer_confidence || 'MEDIUM'} · ${business_purpose || 'No purpose stated'}`,
    event_data:     {
      decision, risk_level: riskResult.riskLevel,
      identity_verified, fraud_indicators, escalation_level,
      business_purpose, recommended_return_code, reviewer_confidence
    },
    actor:    'HUMAN',
    actor_id: 'reviewer_01',
    severity: decision === 'decline' ? 'warning' : 'info'
  });
}

function _promotePattern(hash, total, conf) {
  update('learning_patterns', p => p.pattern_hash === hash, () => ({
    promoted_to_level1: true,
    promotion_date:     new Date().toISOString(),
    promotion_reason:   `Auto-promoted: ${total} decisions, ${Math.round(conf * 100)}% weighted approval rate`,
  }));
  insert('audit_logs', {
    transaction_id: null,
    event_type:     'pattern_promoted',
    event_summary:  `🚀 Pattern ${hash} promoted to Level 1 auto-approval (${Math.round(conf * 100)}% confidence, ${total} decisions)`,
    event_data:     { pattern_hash: hash, total_decisions: total, confidence: conf },
    actor:    'AI',
    severity: 'info'
  });
  console.log(`🚀 Pattern ${hash} promoted to Level 1 (${Math.round(conf * 100)}% confidence)`);
}

function _demotePattern(hash, conf) {
  update('learning_patterns', p => p.pattern_hash === hash, () => ({
    promoted_to_level1: false,
    demotion_count:     (queryOne('learning_patterns', p => p.pattern_hash === hash)?.demotion_count || 0) + 1,
    promotion_date:     null,
    promotion_reason:   null,
  }));
  insert('audit_logs', {
    transaction_id: null,
    event_type:     'pattern_demoted',
    event_summary:  `⬇️ Pattern ${hash} DEMOTED from Level 1 (confidence dropped to ${Math.round(conf * 100)}%)`,
    event_data:     { pattern_hash: hash, confidence: conf },
    actor:    'AI',
    severity: 'warning'
  });
}

function checkPatternMatch(txn, riskFlags) {
  const hash = generatePatternHash(txn, riskFlags);
  return queryOne('learning_patterns', p => p.pattern_hash === hash && p.promoted_to_level1 && !p.is_frozen) || null;
}

function getLearningStats() {
  const all      = queryAll('learning_patterns');
  const promoted = all.filter(p => p.promoted_to_level1);
  const totalDec = all.reduce((a, p) => a + (p.total_decisions || 0), 0);
  const totalRev = queryAll('review_decisions').length;

  // Most common fraud indicators across all declined reviews
  const allDeclines = queryAll('review_decisions', r => r.decision === 'decline');
  const fiCounts = {};
  allDeclines.forEach(r => (r.fraud_indicators || []).forEach(fi => { fiCounts[fi] = (fiCounts[fi] || 0) + 1; }));
  const topFraudIndicators = Object.entries(fiCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => ({ indicator: k, count: v }));

  return {
    totalPatterns: all.length,
    promotedPatterns: promoted.length,
    totalHumanDecisions: totalDec,
    totalRichReviews: totalRev,
    promotionRate: all.length > 0 ? Math.round((promoted.length / all.length) * 100) : 0,
    recentPromotions: promoted.slice(-5).reverse(),
    topFraudIndicators,
  };
}

module.exports = { recordDecision, checkPatternMatch, getLearningStats };
