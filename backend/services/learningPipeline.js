// backend/services/learningPipeline.js
//
// Three responsibilities:
//
//  1. LEARNING — record every human action in real time into a structured
//     JSON lifecycle. When a transaction is finally decided, seal the lifecycle
//     and use it to update the pattern's statistics and learned_qa_pairs.
//
//  2. PROMOTION — when a pattern has ≥5 unique transactions at ≥85% confidence,
//     promote it and build a workflow_playbook from all learned examples.
//
//  3. AUTONOMOUS EXECUTION — when a new transaction matches a promoted pattern,
//     run the full workflow autonomously:
//       a) AI sends MIR portal request (same as human would)
//       b) AI evaluates originator response using LLM + learned examples
//       c) AI decides: approve / decline / ask again
//       d) Human can intervene and override at any point
//       e) Every step tagged actor: 'AI_AUTOMATION' in audit logs
//
// ── Improvements applied ──────────────────────────────────────────────────────
//  1.1 Bayesian Beta prior on confidence (prevents premature promotion)
//  1.2 Temporal decay on historical weights (old decisions lose influence)
//  1.3 Overlapping amount buckets (fixes $4,999 vs $5,001 hash split)
//  1.4 Re-promotion path after demotion (with elevated 90% threshold)
//  1.5 Cross-pattern transfer learning (warm-start from sibling patterns)
//  1.6 L3 conflict guard (autonomous workflow never auto-approves L3)

'use strict';

const crypto = require('crypto');
const { queryAll, queryOne, insert, update } = require('../database/db');

// ── Core thresholds ───────────────────────────────────────────────────────────
const MIN_DECISIONS  = 5;
const CONF_THRESHOLD = 0.85;
const DEMOTION_FLOOR = 0.70;
const CONFIDENCE_WEIGHTS = { HIGH: 1.0, MEDIUM: 0.7, LOW: 0.4 };

// ── 1.1 Bayesian Beta prior (α=2, β=2) ───────────────────────────────────────
// Prevents a single high-confidence early decision from producing confidence≈1.0.
// First approve at weight=1.0 → (1+2)/(1+0+2+2) = 0.60 (was 1.0 without prior)
const BETA_PRIOR_A = 2;
const BETA_PRIOR_B = 2;

// ── 1.2 Temporal decay ───────────────────────────────────────────────────────
// Half-life ≈ 87 days. Decisions from 6+ months ago contribute ~5% of their original weight.
const DECAY_LAMBDA = 0.008;

// ── 1.4 Re-promotion constants ────────────────────────────────────────────────
const REPROMOTE_THRESHOLD        = 0.90;  // Higher bar than initial promotion (0.85)
const REPROMOTE_MIN_DECISIONS    = 8;
const MAX_DEMOTIONS_BEFORE_FREEZE = 3;    // Pattern frozen permanently after 3 demotions

// ── 1.5 Cross-pattern transfer ────────────────────────────────────────────────
const TRANSFER_WEIGHT = 0.25; // 25% of sibling's weights transferred to new pattern

// ── 1.6 Autonomy safety limits ────────────────────────────────────────────────
const AUTONOMY_MAX_RISK_LEVEL = 2;  // Never autonomous on L3 transactions
const AUTONOMY_MAX_SCORE      = 72; // Score cap for autonomous approval

// ── Amount buckets ────────────────────────────────────────────────────────────
// Original single-bucket function — kept for feature-vector building (backward compat)
function getAmountBucket(amount) {
  if (amount < 500)    return 'micro';
  if (amount < 5000)   return 'small';
  if (amount < 25000)  return 'medium';
  if (amount < 100000) return 'large';
  return 'xlarge';
}

// 1.3 Dual-bucket: returns array of 1 or 2 buckets when amount is within 10% of a boundary.
// $4,750 → ['small', 'medium']   $5,250 → ['medium', 'small']   $10,000 → ['medium']
function getAmountBuckets(amount) {
  const BOUNDS = [500, 5000, 25000, 100000];
  const NAMES  = ['micro', 'small', 'medium', 'large', 'xlarge'];
  const primaryIdx = BOUNDS.findIndex(b => amount < b);
  const primary    = NAMES[primaryIdx === -1 ? 4 : primaryIdx];

  for (let i = 0; i < BOUNDS.length; i++) {
    if (Math.abs(amount - BOUNDS[i]) / BOUNDS[i] < 0.10) {
      // Adjacent bucket is the one on the other side of this boundary
      const adjacent = amount < BOUNDS[i] ? NAMES[i + 1] : NAMES[i];
      if (adjacent && adjacent !== primary) return [primary, adjacent];
    }
  }
  return [primary];
}

// ── Feature vector ────────────────────────────────────────────────────────────
function buildFeatureVector(txn, riskFlags, reviewData = {}) {
  return {
    sec_code:          txn.sec_code,
    transaction_code:  txn.transaction_code || 'unknown',
    transaction_type:  txn.transaction_type,
    amount_bucket:     getAmountBucket(txn.amount),
    account_type:      txn.account_type || 'checking',
    is_prenote:        txn.prenote || false,
    flag_codes:        (riskFlags || []).map(f => f.rule_code).sort(),
    flag_count:        (riskFlags || []).length,
    max_flag_level:    (riskFlags || []).reduce((m, f) => Math.max(m, f.flag_level), 1),
    has_ofac_flag:     (riskFlags || []).some(f => f.category === 'sanctions'),
    has_aml_flag:      txn.aml_flag || false,
    has_addenda:       txn.addenda_record_indicator === '1',
    authorization_type:txn.authorization_type || null,
    ofac_screened:     txn.ofac_screened || false,
    identity_verified: reviewData.identity_verified || false,
    counterparty_type: reviewData.counterparty_type || 'UNKNOWN',
    fraud_indicators:  reviewData.fraud_indicators || [],
    business_purpose:  reviewData.business_purpose || null,
    escalation_level:  reviewData.escalation_level || 'none',
  };
}

// ── Pattern hashing ───────────────────────────────────────────────────────────
// Internal helper used by both single and multi-hash variants
function _hashFromKey(key) {
  return crypto.createHash('sha256').update(JSON.stringify(key)).digest('hex').slice(0, 16);
}

// 1.3 Returns array of hashes: [primaryHash, optionalAdjacentHash]
function generatePatternHashes(txn, riskFlags) {
  const buckets   = getAmountBuckets(txn.amount);
  const flagCodes = (riskFlags || []).map(f => f.rule_code).sort().join(',');
  return buckets.map(bucket => _hashFromKey({
    sec_code:      txn.sec_code,
    txn_type:      txn.transaction_type,
    amount_bucket: bucket,
    flag_codes:    flagCodes,
    account_type:  txn.account_type || 'checking',
  }));
}

// Primary hash (backward-compatible single value)
function generatePatternHash(txn, riskFlags) {
  return generatePatternHashes(txn, riskFlags)[0];
}

function buildPatternDescription(txn, riskFlags) {
  const bucket   = getAmountBucket(txn.amount);
  const flagList = (riskFlags || []).map(f => f.rule_name).join(' | ') || 'No flags';
  return `${txn.sec_code} ${(txn.transaction_type || '').toUpperCase()} [${bucket}] via ${txn.account_type || 'checking'} | ${flagList}`;
}

// ── LLM caller ────────────────────────────────────────────────────────────────
let _geminiModel = null;
function _getGemini() {
  if (_geminiModel) return _geminiModel;
  const key = process.env.GEMINI_API_KEY;
  if (key && key !== 'YOUR_GEMINI_API_KEY') {
    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      _geminiModel = new GoogleGenerativeAI(key).getGenerativeModel({
        model: 'gemini-2.0-flash-lite',
        generationConfig: { temperature: 0.1, maxOutputTokens: 512 },
      });
    } catch (_) {}
  }
  return _geminiModel;
}

async function _callLLM(prompt) {
  const model = _getGemini();
  if (model) {
    try {
      const r = await model.generateContent(prompt);
      return r.response.text().trim();
    } catch (e) {
      console.warn('[learningPipeline] LLM error:', e.message);
    }
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — LIFECYCLE RECORDING
// ══════════════════════════════════════════════════════════════════════════════

async function startLifecycle(txn, riskResult) {
  const patternHash = generatePatternHash(txn, riskResult.riskFlags);
  await insert('transaction_lifecycles', {
    lifecycle_id:         `LC-${txn.transaction_id}`,
    transaction_id:       txn.transaction_id,
    pattern_hash:         patternHash,
    lifecycle_status:     'in_progress',
    actor_type:           'HUMAN',
    transaction_snapshot: {
      sec_code:         txn.sec_code,
      transaction_type: txn.transaction_type,
      amount:           txn.amount,
      amount_bucket:    getAmountBucket(txn.amount),
      company_name:     txn.company_name,
      risk_level:       riskResult.riskLevel,
      risk_score:       riskResult.riskScore,
      flag_codes:       (riskResult.riskFlags || []).map(f => f.rule_code),
    },
    steps:           [],
    final_decision:  null,
    final_actor:     null,
    total_rounds:    0,
    completed_at:    null,
  });
}

async function recordLifecycleRequest(txnId, roundNumber, category, message, actorType) {
  const lc = await queryOne('transaction_lifecycles', l => l.transaction_id === txnId);
  if (!lc) return;
  const steps = [...(lc.steps || [])];
  steps.push({
    step:      steps.length + 1,
    actor:     actorType || 'HUMAN',
    action:    'info_requested',
    round:     roundNumber,
    category,
    message,
    timestamp: new Date().toISOString(),
  });
  await update('transaction_lifecycles', l => l.transaction_id === txnId, () => ({
    steps,
    total_rounds: roundNumber,
  }));
}

async function recordLifecycleResponse(txnId, roundNumber, responseMessage) {
  const lc = await queryOne('transaction_lifecycles', l => l.transaction_id === txnId);
  if (!lc) return;
  const steps = [...(lc.steps || [])];
  steps.push({
    step:             steps.length + 1,
    actor:            'ORIGINATOR',
    action:           'response_submitted',
    round:            roundNumber,
    response_message: responseMessage,
    response_length:  (responseMessage || '').length,
    timestamp:        new Date().toISOString(),
  });
  await update('transaction_lifecycles', l => l.transaction_id === txnId, () => ({ steps }));
}

async function finaliseLifecycle(txn, decision, reviewData, riskResult) {
  const lc = await queryOne('transaction_lifecycles', l => l.transaction_id === txn.transaction_id);
  if (!lc) return;
  const steps = [...(lc.steps || [])];
  steps.push({
    step:                steps.length + 1,
    actor:               reviewData._actorType || 'HUMAN',
    action:              'final_decision',
    decision,
    decision_reason:     reviewData.decision_reason || null,
    reviewer_confidence: reviewData.reviewer_confidence || 'MEDIUM',
    timestamp:           new Date().toISOString(),
  });
  await update('transaction_lifecycles', l => l.transaction_id === txn.transaction_id, () => ({
    steps,
    lifecycle_status: 'complete',
    final_decision:   decision,
    final_actor:      reviewData._actorType || 'HUMAN',
    completed_at:     new Date().toISOString(),
  }));
  await _updatePatternFromLifecycle(txn, decision, reviewData, riskResult, { ...lc, steps });
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — PATTERN LEARNING
// Applies improvements 1.1, 1.2, 1.4, 1.5
// ══════════════════════════════════════════════════════════════════════════════

async function _updatePatternFromLifecycle(txn, decision, reviewData, riskResult, lifecycle) {
  // Resubmission deduplication — only the first terminal decision updates counts.
  const allDecisions   = await queryAll('review_decisions', r => r.transaction_id === txn.transaction_id);
  const isResubmission = allDecisions.length > 1;

  const patternHash   = generatePatternHash(txn, riskResult.riskFlags);
  const description   = buildPatternDescription(txn, riskResult.riskFlags);
  const featureVector = buildFeatureVector(txn, riskResult.riskFlags, reviewData);
  const confWeight    = CONFIDENCE_WEIGHTS[reviewData.reviewer_confidence || 'MEDIUM'];
  const mirRounds     = lifecycle.total_rounds || 0;

  const requestSteps  = (lifecycle.steps || []).filter(s => s.action === 'info_requested');
  const responseSteps = (lifecycle.steps || []).filter(s => s.action === 'response_submitted');
  const categoriesUsed = requestSteps.map(s => s.category);

  const newQA = requestSteps.map((req, i) => ({
    round:            req.round,
    category:         req.category,
    message_template: req.message,
    response_example: responseSteps[i]?.response_message || null,
    response_length:  responseSteps[i]?.response_length  || 0,
    led_to_more_info: i < requestSteps.length - 1,
    led_to_decision:  i === requestSteps.length - 1,
    final_outcome:    i === requestSteps.length - 1 ? decision : null,
    recorded_at:      new Date().toISOString(),
  }));

  const existing = await queryOne('learning_patterns', p => p.pattern_hash === patternHash);

  if (existing) {
    const catCounts = { ...(existing.mir_category_counts || {}) };
    categoriesUsed.forEach(c => { catCounts[c] = (catCounts[c] || 0) + 1; });
    const allQA = [...(existing.learned_qa_pairs || []), ...newQA].slice(-20);

    if (!isResubmission) {
      // 1.2 Temporal decay: weight old decisions less as time passes.
      // Reads updated_at from the existing pattern record.
      const lastUpdatedAt    = existing.updated_at || existing.created_at;
      const daysSinceLast    = lastUpdatedAt
        ? (Date.now() - new Date(lastUpdatedAt).getTime()) / 86400000
        : 0;
      const decayFactor      = Math.exp(-DECAY_LAMBDA * Math.max(0, daysSinceLast));
      const decayedApproveW  = (existing.approve_weight || 0) * decayFactor;
      const decayedDeclineW  = (existing.decline_weight || 0) * decayFactor;

      // Add this decision on top of decayed historical weights
      const approveW = decayedApproveW + (decision === 'approve' ? confWeight : 0);
      const declineW = decayedDeclineW + (decision === 'decline' ? confWeight : 0);

      // 1.1 Bayesian Beta prior: (approveW + α) / (total + α + β)
      // Prevents extreme confidence on sparse data
      const newConf  = (approveW + BETA_PRIOR_A) / (approveW + declineW + BETA_PRIOR_A + BETA_PRIOR_B);
      const newTotal = existing.total_decisions + 1;

      const newMirCount  = existing.mir_count + (mirRounds > 0 ? 1 : 0);
      const prevAvgRounds = existing.avg_rounds_to_resolve || 0;
      const newAvgRounds  = mirRounds > 0
        ? (prevAvgRounds * (existing.mir_count || 0) + mirRounds) / Math.max(1, newMirCount)
        : prevAvgRounds;

      await update('learning_patterns', p => p.pattern_hash === patternHash, () => ({
        approve_count:         existing.approve_count + (decision === 'approve' ? 1 : 0),
        decline_count:         existing.decline_count + (decision === 'decline' ? 1 : 0),
        approve_weight:        approveW,
        decline_weight:        declineW,
        total_decisions:       newTotal,
        confidence_score:      newConf,
        last_feature_vector:   featureVector,
        mir_count:             newMirCount,
        mir_category_counts:   catCounts,
        avg_rounds_to_resolve: newAvgRounds,
        learned_qa_pairs:      allQA,
        most_common_purpose:   reviewData.business_purpose || existing.most_common_purpose,
        avg_time_to_decide:    existing.avg_time_to_decide
          ? (existing.avg_time_to_decide * (newTotal - 1) + (reviewData.time_to_decide_seconds || 0)) / newTotal
          : (reviewData.time_to_decide_seconds || 0),
      }));

      const updated = await queryOne('learning_patterns', p => p.pattern_hash === patternHash);
      if (!updated) return; // Guard against unexpected DB state

      // Promotion check
      if (!existing.promoted_to_level1 && !existing.is_frozen
          && updated.total_decisions >= MIN_DECISIONS
          && updated.confidence_score >= CONF_THRESHOLD) {
        await _promotePattern(patternHash, updated);
      }

      // Demotion check
      if (existing.promoted_to_level1 && updated.confidence_score < DEMOTION_FLOOR) {
        await _demotePattern(patternHash, updated.confidence_score);
      }

      // 1.4 Re-promotion check: patterns that recovered after demotion
      const demotionCount = existing.demotion_count || 0;
      if (!existing.promoted_to_level1
          && demotionCount > 0
          && demotionCount < MAX_DEMOTIONS_BEFORE_FREEZE
          && !existing.is_frozen
          && updated.confidence_score >= REPROMOTE_THRESHOLD
          && updated.total_decisions  >= REPROMOTE_MIN_DECISIONS) {
        await _repromotePattern(patternHash, updated);
      }

      // Auto-freeze: pattern has been demoted too many times
      if ((updated.demotion_count || 0) >= MAX_DEMOTIONS_BEFORE_FREEZE && !existing.is_frozen) {
        await update('learning_patterns', p => p.pattern_hash === patternHash, () => ({
          is_frozen:          true,
          promoted_to_level1: false,
          workflow_playbook:  null,
        }));
        await insert('audit_logs', {
          transaction_id: null,
          event_type:    'pattern_frozen',
          event_summary: `🧊 Pattern ${patternHash} FROZEN — ${MAX_DEMOTIONS_BEFORE_FREEZE} demotions exceeded, autonomous workflow disabled permanently`,
          event_data:    { pattern_hash: patternHash, demotion_count: updated.demotion_count },
          actor: 'AI', severity: 'warning',
        });
        console.warn(`🧊 Pattern ${patternHash} FROZEN permanently`);
      }
    } else {
      // Resubmission — only update QA pairs, never touch decision statistics
      await update('learning_patterns', p => p.pattern_hash === patternHash, () => ({
        learned_qa_pairs:    allQA,
        mir_category_counts: catCounts,
      }));
    }
  } else {
    // ── New pattern ───────────────────────────────────────────────────────────
    // 1.5 Cross-pattern transfer: warm-start from a sibling pattern that shares
    // sec_code + transaction_type but uses a different amount bucket.
    let transferApproveW = 0, transferDeclineW = 0, transferSource = null;
    try {
      const primaryBucket = getAmountBucket(txn.amount);
      const siblings = await queryAll('learning_patterns',
        p => p.promoted_to_level1 === true
          && p.is_frozen !== true
          && p.feature_vector?.sec_code        === txn.sec_code
          && p.feature_vector?.transaction_type === txn.transaction_type
          && p.feature_vector?.amount_bucket    !== primaryBucket
      );

      if (siblings.length > 0) {
        // Pick the sibling with the highest confidence × total_decisions product
        const bestSibling = siblings.reduce((best, s) =>
          ((s.confidence_score || 0) * (s.total_decisions || 0)) >
          ((best.confidence_score || 0) * (best.total_decisions || 0)) ? s : best
        , siblings[0]);

        if ((bestSibling.confidence_score || 0) >= CONF_THRESHOLD) {
          transferApproveW = (bestSibling.approve_weight || 0) * TRANSFER_WEIGHT;
          transferDeclineW = (bestSibling.decline_weight || 0) * TRANSFER_WEIGHT;
          transferSource   = bestSibling.pattern_hash;
          console.log(`[LearningPipeline] 1.5 Transfer: sibling ${transferSource} → new ${patternHash} (${Math.round(bestSibling.confidence_score * 100)}% conf, ${TRANSFER_WEIGHT * 100}% weight)`);
        }
      }
    } catch (e) {
      console.warn('[LearningPipeline] Cross-pattern transfer lookup failed (non-fatal):', e.message);
    }

    const approveW    = transferApproveW + (decision === 'approve' ? confWeight : 0);
    const declineW    = transferDeclineW + (decision === 'decline' ? confWeight : 0);
    // 1.1 Bayesian prior applied from the first decision
    const initialConf = (approveW + BETA_PRIOR_A) / (approveW + declineW + BETA_PRIOR_A + BETA_PRIOR_B);

    await insert('learning_patterns', {
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
      mir_count:              mirRounds > 0 ? 1 : 0,
      mir_category_counts:    Object.fromEntries(categoriesUsed.map(c => [c, 1])),
      approve_weight:         approveW,
      decline_weight:         declineW,
      confidence_score:       initialConf,
      transfer_source_hash:   transferSource,
      promoted_to_level1:     false,
      is_frozen:              false,
      demotion_count:         0,
      min_decisions_required: MIN_DECISIONS,
      confidence_threshold:   CONF_THRESHOLD,
      avg_rounds_to_resolve:  mirRounds,
      learned_qa_pairs:       newQA,
      workflow_playbook:      null,
      most_common_purpose:    reviewData.business_purpose || null,
      avg_time_to_decide:     reviewData.time_to_decide_seconds || 0,
    });
  }
}

// ── Promotion ─────────────────────────────────────────────────────────────────
async function _promotePattern(hash, pattern) {
  const playbook = await _buildWorkflowPlaybook(pattern).catch(() => null);
  await update('learning_patterns', p => p.pattern_hash === hash, () => ({
    promoted_to_level1: true,
    promotion_date:     new Date().toISOString(),
    promotion_reason:   `Auto-promoted: ${pattern.total_decisions} decisions, ${Math.round(pattern.confidence_score * 100)}% confidence`,
    workflow_playbook:  playbook,
  }));
  await insert('audit_logs', {
    transaction_id: null,
    event_type:    'pattern_promoted',
    event_summary: `🚀 Pattern ${hash} PROMOTED — autonomous workflow enabled (${Math.round(pattern.confidence_score * 100)}% conf, ${pattern.total_decisions} decisions)`,
    event_data:    { pattern_hash: hash, total_decisions: pattern.total_decisions, confidence: pattern.confidence_score, playbook_rounds: playbook?.expected_rounds },
    actor: 'AI', severity: 'info',
  });
  console.log(`\n🚀 Pattern ${hash} PROMOTED — autonomous workflow active`);
  console.log(`   Confidence: ${Math.round(pattern.confidence_score * 100)}% | Decisions: ${pattern.total_decisions}`);
}

// 1.4 Re-promotion with elevated confidence threshold
async function _repromotePattern(hash, pattern) {
  const playbook = await _buildWorkflowPlaybook(pattern).catch(() => null);
  await update('learning_patterns', p => p.pattern_hash === hash, () => ({
    promoted_to_level1: true,
    promotion_date:     new Date().toISOString(),
    promotion_reason:   `Re-promoted: ${pattern.total_decisions} decisions, ${Math.round(pattern.confidence_score * 100)}% confidence (elevated 90% threshold after ${pattern.demotion_count} demotion(s))`,
    workflow_playbook:  playbook,
  }));
  await insert('audit_logs', {
    transaction_id: null,
    event_type:    'pattern_repromoted',
    event_summary: `↗️ Pattern ${hash} RE-PROMOTED — autonomous workflow re-enabled (${Math.round(pattern.confidence_score * 100)}% conf, demotion_count=${pattern.demotion_count})`,
    event_data:    { pattern_hash: hash, total_decisions: pattern.total_decisions, confidence: pattern.confidence_score, demotion_count: pattern.demotion_count },
    actor: 'AI', severity: 'info',
  });
  console.log(`↗️ Pattern ${hash} RE-PROMOTED after recovery (conf=${Math.round(pattern.confidence_score * 100)}%)`);
}

async function _buildWorkflowPlaybook(pattern) {
  const qaPairs = pattern.learned_qa_pairs || [];
  const byRound = {};
  qaPairs.forEach(qa => {
    if (!byRound[qa.round]) byRound[qa.round] = [];
    byRound[qa.round].push(qa);
  });

  const rounds = Object.entries(byRound).map(([round, items]) => {
    const catFreq = {};
    items.forEach(i => { catFreq[i.category] = (catFreq[i.category] || 0) + 1; });
    const category = Object.entries(catFreq).sort((a, b) => b[1] - a[1])[0]?.[0];
    const bestMsg  = items[items.length - 1]?.message_template || '';
    const ledToDecision = items.filter(i => i.led_to_decision).length / Math.max(items.length, 1);
    return {
      round:               parseInt(round),
      category,
      message_template:    bestMsg,
      pct_led_to_decision: Math.round(ledToDecision * 100),
    };
  });

  const approveRate      = pattern.approve_count / Math.max(pattern.total_decisions, 1);
  const expectedDecision = approveRate >= 0.5 ? 'approve' : 'decline';

  const llmPrompt = [
    `You are an ACH compliance AI. Summarise this learned transaction workflow in 2 sentences.`,
    `Pattern: ${pattern.pattern_description}`,
    `Typical rounds: ${rounds.length}`,
    `Categories: ${rounds.map(r => r.category).join(' then ')}`,
    `Approval rate: ${Math.round(approveRate * 100)}%`,
    `Respond with ONLY the 2-sentence summary.`,
  ].join('\n');

  const summary = await _callLLM(llmPrompt).catch(() => null)
    || `This pattern requires ${rounds.length} round(s) of information before a decision. Approval rate is ${Math.round(approveRate * 100)}%.`;

  return {
    pattern_hash:       pattern.pattern_hash,
    expected_rounds:    rounds.length,
    rounds,
    expected_decision:  expectedDecision,
    approval_rate:      approveRate,
    summary,
    built_at:           new Date().toISOString(),
    built_from_samples: qaPairs.length,
  };
}

async function _demotePattern(hash, conf) {
  const existing = await queryOne('learning_patterns', p => p.pattern_hash === hash);
  const newDemotionCount = (existing?.demotion_count || 0) + 1;
  await update('learning_patterns', p => p.pattern_hash === hash, () => ({
    promoted_to_level1: false,
    demotion_count:     newDemotionCount,
    promotion_date:     null,
    workflow_playbook:  null,
  }));
  await insert('audit_logs', {
    transaction_id: null,
    event_type:    'pattern_demoted',
    event_summary: `⬇️ Pattern ${hash} DEMOTED — autonomous workflow disabled (conf: ${Math.round(conf * 100)}%, demotion #${newDemotionCount})`,
    event_data:    { pattern_hash: hash, confidence: conf, demotion_count: newDemotionCount },
    actor: 'AI', severity: 'warning',
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — AUTONOMOUS WORKFLOW ENGINE
// Applies improvement 1.6 (L3 conflict guard)
// ══════════════════════════════════════════════════════════════════════════════

async function runAutonomousWorkflow(txn, riskResult, pattern) {
  // ── 1.6 Safety guard ─────────────────────────────────────────────────────
  // A promoted pattern that matched a L2 transaction during training must never
  // auto-approve the same pattern if it now arrives as L3 (e.g. SEC code changed
  // to IAT, or OFAC flag added). Risk level and score are both gated.
  const effectiveLevel = riskResult.riskLevel || txn.risk_level || 1;
  const effectiveScore = riskResult.riskScore || txn.risk_score || 0;

  if (effectiveLevel > AUTONOMY_MAX_RISK_LEVEL || effectiveScore > AUTONOMY_MAX_SCORE) {
    const reason = `Autonomous workflow blocked: risk exceeds safety limit (L${effectiveLevel}, score ${effectiveScore} — max L${AUTONOMY_MAX_RISK_LEVEL}/score ${AUTONOMY_MAX_SCORE})`;
    console.warn(`🛡️ [AI_AUTOMATION] ${reason} for ${txn.transaction_id}`);
    await _escalateToHuman(txn, reason);
    await insert('audit_logs', {
      transaction_id: txn.transaction_id,
      event_type:    'ai_autonomy_blocked',
      event_summary: `🛡️ Autonomy blocked — ${reason}`,
      event_data:    {
        pattern_hash: pattern.pattern_hash,
        risk_level:   effectiveLevel, risk_score: effectiveScore,
        max_level:    AUTONOMY_MAX_RISK_LEVEL, max_score: AUTONOMY_MAX_SCORE,
      },
      actor: 'AI_AUTOMATION', severity: 'warning',
    });
    return;
  }

  console.log(`\n🤖 AI_AUTOMATION: Starting autonomous workflow for ${txn.transaction_id}`);

  await update('transactions', t => t.transaction_id === txn.transaction_id, () => ({
    status:              'ai_workflow',
    ai_workflow_started: new Date().toISOString(),
    ai_workflow_pattern: pattern.pattern_hash,
    ai_human_override:   false,
  }));

  await startLifecycle(txn, riskResult);
  await update('transaction_lifecycles', l => l.transaction_id === txn.transaction_id, () => ({
    actor_type: 'AI_AUTOMATION',
  }));

  await insert('audit_logs', {
    transaction_id: txn.transaction_id,
    event_type:    'ai_workflow_started',
    event_summary: `🤖 AI_AUTOMATION: Autonomous workflow started (Pattern: ${pattern.pattern_hash}, ${Math.round(pattern.confidence_score * 100)}% confidence)`,
    event_data:    { pattern_hash: pattern.pattern_hash, confidence: pattern.confidence_score, playbook: pattern.workflow_playbook?.summary },
    actor: 'AI_AUTOMATION', severity: 'info',
  });

  _executeWorkflowRound(txn, riskResult, pattern, 1).catch(e => {
    console.error(`[AI_AUTOMATION] Workflow round 1 error for ${txn.transaction_id}:`, e.message);
  });
}

async function _executeWorkflowRound(txn, riskResult, pattern, roundNumber) {
  const playbook = pattern.workflow_playbook;
  if (!playbook || !playbook.rounds) return;

  const playbookRound = playbook.rounds.find(r => r.round === roundNumber)
    || playbook.rounds[playbook.rounds.length - 1];
  if (!playbookRound) return;

  const message = await _generateRequestMessage(txn, playbookRound, pattern)
    .catch(() => playbookRound.message_template || 'Please provide additional information for this transaction.');

  const { recordAutoMirRequest } = require('../routes/infoRequests');
  await recordAutoMirRequest(txn, playbookRound.category, message, pattern.pattern_hash, roundNumber);
  await recordLifecycleRequest(txn.transaction_id, roundNumber, playbookRound.category, message, 'AI_AUTOMATION');

  console.log(`🤖 AI_AUTOMATION: Round ${roundNumber} sent for ${txn.transaction_id} — ${playbookRound.category}`);
}

async function _generateRequestMessage(txn, playbookRound, pattern) {
  const prompt = [
    `You are an ACH compliance AI sending an information request to a transaction originator.`,
    `Transaction: ${txn.sec_code} ${txn.transaction_type} $${txn.amount} from ${txn.company_name}`,
    `Information needed: ${(playbookRound.category || '').replace(/_/g, ' ').toLowerCase()}`,
    `Template from past cases: "${playbookRound.message_template}"`,
    `Write a clear, professional 2-3 sentence request for this specific transaction.`,
    `Do not mention risk scores, internal systems, or policy numbers.`,
    `Respond with ONLY the message text.`,
  ].join('\n');
  return (await _callLLM(prompt)) || playbookRound.message_template || 'Please provide additional information regarding this transaction.';
}

async function evaluateOriginatorResponse(txn, infoRequest, responseMessage, pattern) {
  // Always check for human override before doing anything
  const freshTxn = await queryOne('transactions', t => t.transaction_id === txn.transaction_id);
  if (freshTxn?.ai_human_override) {
    console.log(`[AI_AUTOMATION] Human override active for ${txn.transaction_id} — stopping`);
    return { action: 'human_override' };
  }

  await recordLifecycleResponse(txn.transaction_id, infoRequest.round_number, responseMessage || '');

  const riskResult = { riskLevel: txn.risk_level, riskScore: txn.risk_score, riskFlags: txn.risk_flags || [] };
  const qaPairs    = pattern.learned_qa_pairs || [];

  const examples = qaPairs
    .filter(qa => qa.category === infoRequest.category && qa.response_example)
    .slice(-5)
    .map(qa =>
      `Response: "${(qa.response_example || '').slice(0, 150)}" → ` +
      (qa.led_to_decision ? `Final: ${qa.final_outcome}` : 'Led to another info request')
    ).join('\n');

  const prompt = [
    `You are an ACH compliance AI evaluating an originator's response.`,
    ``,
    `Transaction: ${txn.sec_code} ${(txn.transaction_type || '').toUpperCase()} $${txn.amount} from ${txn.company_name}`,
    `Risk score: ${txn.risk_score}/100`,
    `Category requested (${infoRequest.category}): "${infoRequest.message}"`,
    `Originator's response: "${responseMessage}"`,
    `Round: ${infoRequest.round_number}`,
    ``,
    `Examples from ${qaPairs.filter(qa => qa.category === infoRequest.category).length} similar past cases:`,
    examples || 'No prior examples for this category.',
    ``,
    `Historical approval rate for this pattern: ${Math.round((pattern.approve_count / Math.max(pattern.total_decisions, 1)) * 100)}%`,
    ``,
    `Decide:`,
    `"approve"   — response is sufficient, transaction is safe to approve`,
    `"decline"   — response is insufficient or raises concerns`,
    `"more_info" — response is incomplete, need another round`,
    ``,
    `Respond ONLY with valid JSON, no markdown:`,
    `{"action":"approve","confidence":0.92,"reason":"One sentence reason","next_category":null}`,
    ``,
    `If action is "more_info", set next_category to one of:`,
    `IDENTITY_VERIFICATION, AUTHORIZATION_PROOF, BUSINESS_PURPOSE_CLARIFICATION,`,
    `AMOUNT_DISCREPANCY, ACCOUNT_OWNERSHIP, SANCTIONS_REVIEW, DUPLICATE_EXPLANATION, CUSTOM`,
  ].join('\n');

  let evaluation = null;
  const llmResponse = await _callLLM(prompt);
  if (llmResponse) {
    try {
      evaluation = JSON.parse(llmResponse.replace(/```json|```/g, '').trim());
    } catch (_) {
      console.warn('[AI_AUTOMATION] JSON parse failed — using heuristic');
    }
  }
  if (!evaluation) {
    evaluation = _heuristicEvaluation(responseMessage, infoRequest, pattern);
  }

  console.log(`🤖 AI_AUTOMATION: Evaluated response for ${txn.transaction_id} → ${evaluation.action} (${Math.round((evaluation.confidence || 0) * 100)}%)`);

  const MAX_ROUNDS = parseInt(process.env.MIR_MAX_ROUNDS || '5');

  if (evaluation.action === 'approve') {
    await _aiApprove(txn, riskResult, evaluation.reason, pattern);
  } else if (evaluation.action === 'decline') {
    await _aiDecline(txn, riskResult, evaluation.reason, pattern);
  } else if (evaluation.action === 'more_info') {
    if (infoRequest.round_number >= MAX_ROUNDS) {
      await _escalateToHuman(txn, `Maximum MIR rounds (${MAX_ROUNDS}) reached without resolution.`);
      return { action: 'escalated' };
    }
    const nextRound    = infoRequest.round_number + 1;
    const nextCategory = evaluation.next_category || infoRequest.category;
    const nextMessage  = await _generateFollowUpMessage(txn, nextCategory, responseMessage, pattern)
      .catch(() => `Thank you for your response. We still need additional information regarding ${(nextCategory || '').replace(/_/g, ' ').toLowerCase()}.`);

    const { recordAutoMirRequest } = require('../routes/infoRequests');
    await recordAutoMirRequest(txn, nextCategory, nextMessage, pattern.pattern_hash, nextRound);
    await recordLifecycleRequest(txn.transaction_id, nextRound, nextCategory, nextMessage, 'AI_AUTOMATION');

    await insert('audit_logs', {
      transaction_id: txn.transaction_id,
      event_type:    'ai_followup_requested',
      event_summary: `🤖 AI_AUTOMATION: Round ${nextRound} — ${(nextCategory || '').replace(/_/g, ' ')}`,
      event_data:    { round: nextRound, category: nextCategory, evaluation_reason: evaluation.reason },
      actor: 'AI_AUTOMATION', severity: 'info',
    });
  }

  return evaluation;
}

// Heuristic fallback when LLM is unavailable
function _heuristicEvaluation(responseMessage, infoRequest, pattern) {
  const msg        = responseMessage || '';
  const lower      = msg.toLowerCase();
  const wordCount  = msg.trim().split(/\s+/).filter(Boolean).length;
  const approveRate = pattern.approve_count / Math.max(pattern.total_decisions, 1);

  if (wordCount < 10) {
    return { action: 'more_info', confidence: 0.6, reason: 'Response too brief', next_category: infoRequest.category };
  }
  const denyWords = ['not authorized', "didn't authorize", 'fraud', 'never submitted', 'not mine', 'unknown'];
  if (denyWords.some(k => lower.includes(k))) {
    return { action: 'decline', confidence: 0.85, reason: 'Response indicates unauthorized transaction', next_category: null };
  }
  const confirmWords = ['authorized', 'confirmed', 'reference', 'invoice', 'agreement', 'signed'];
  const hasConfirm   = confirmWords.some(k => lower.includes(k));
  if (hasConfirm && wordCount >= 20 && approveRate >= 0.7) {
    return { action: 'approve', confidence: approveRate, reason: 'Response confirms authorization', next_category: null };
  }
  if (approveRate >= 0.85 && wordCount >= 15) {
    return { action: 'approve', confidence: approveRate * 0.9, reason: 'High-confidence pattern with adequate response', next_category: null };
  }
  return { action: 'more_info', confidence: 0.5, reason: 'Response needs more detail', next_category: infoRequest.category };
}

async function _generateFollowUpMessage(txn, nextCategory, previousResponse, pattern) {
  const prompt = [
    `You are an ACH compliance AI. The originator responded but you need more information.`,
    `Their response: "${(previousResponse || '').slice(0, 200)}"`,
    `You now need: ${(nextCategory || '').replace(/_/g, ' ').toLowerCase()}`,
    `Write a polite 2-sentence follow-up acknowledging their response and asking for the additional information.`,
    `Respond with ONLY the message text.`,
  ].join('\n');
  return (await _callLLM(prompt))
    || `Thank you for your response. We require additional documentation for ${(nextCategory || '').replace(/_/g, ' ').toLowerCase()} before we can process this transaction.`;
}

async function _aiApprove(txn, riskResult, reason, pattern) {
  await update('transactions', t => t.transaction_id === txn.transaction_id, () => ({
    status:            'approved',
    reviewer_decision: 'approve',
    reviewer_notes:    `AI_AUTOMATION: ${reason}`,
    decision_at:       new Date().toISOString(),
    reviewer_id:       'AI_AUTOMATION',
    reviewer_name:     'AI Automation',
  }));
  await finaliseLifecycle(txn, 'approve', { _actorType: 'AI_AUTOMATION', decision_reason: reason, reviewer_confidence: 'HIGH' }, riskResult);
  await insert('audit_logs', {
    transaction_id: txn.transaction_id,
    event_type:    'ai_auto_approved',
    event_summary: `🤖 AI_AUTOMATION: ✅ Approved — ${reason}`,
    event_data:    { pattern_hash: pattern.pattern_hash, confidence: pattern.confidence_score, reason },
    actor: 'AI_AUTOMATION', severity: 'info',
  });
  await insert('review_decisions', {
    transaction_id: txn.transaction_id, decision: 'approve',
    decision_reason: `AI_AUTOMATION: ${reason}`, reviewer_confidence: 'HIGH',
    confidence_weight: 1.0, risk_level_at_decision: riskResult.riskLevel,
    risk_score_at_decision: riskResult.riskScore, risk_flags_at_decision: riskResult.riskFlags,
    ai_automation: true,
  });
  console.log(`✅ AI_AUTOMATION: Approved ${txn.transaction_id}`);
}

async function _aiDecline(txn, riskResult, reason, pattern) {
  await update('transactions', t => t.transaction_id === txn.transaction_id, () => ({
    status:            'declined',
    reviewer_decision: 'decline',
    reviewer_notes:    `AI_AUTOMATION: ${reason}`,
    decision_at:       new Date().toISOString(),
    reviewer_id:       'AI_AUTOMATION',
    reviewer_name:     'AI Automation',
  }));
  await finaliseLifecycle(txn, 'decline', { _actorType: 'AI_AUTOMATION', decision_reason: reason, reviewer_confidence: 'HIGH' }, riskResult);
  await insert('audit_logs', {
    transaction_id: txn.transaction_id,
    event_type:    'ai_auto_declined',
    event_summary: `🤖 AI_AUTOMATION: ❌ Declined — ${reason}`,
    event_data:    { pattern_hash: pattern.pattern_hash, confidence: pattern.confidence_score, reason },
    actor: 'AI_AUTOMATION', severity: 'warning',
  });
  await insert('review_decisions', {
    transaction_id: txn.transaction_id, decision: 'decline',
    decision_reason: `AI_AUTOMATION: ${reason}`, reviewer_confidence: 'HIGH',
    confidence_weight: 1.0, risk_level_at_decision: riskResult.riskLevel,
    risk_score_at_decision: riskResult.riskScore, risk_flags_at_decision: riskResult.riskFlags,
    ai_automation: true,
  });
  console.log(`❌ AI_AUTOMATION: Declined ${txn.transaction_id}`);
}

async function _escalateToHuman(txn, reason) {
  await update('transactions', t => t.transaction_id === txn.transaction_id, () => ({
    status:               'under_review',
    ai_human_override:    true,
    ai_escalation_reason: reason,
  }));
  await insert('audit_logs', {
    transaction_id: txn.transaction_id,
    event_type:    'ai_escalated_to_human',
    event_summary: `⚠️ AI_AUTOMATION: Escalated to human — ${reason}`,
    event_data:    { reason },
    actor: 'AI_AUTOMATION', severity: 'warning',
  });
  console.log(`⚠️ AI_AUTOMATION: Escalated ${txn.transaction_id} to human`);
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 4 — PUBLIC API
// ══════════════════════════════════════════════════════════════════════════════

async function recordDecision(txn, decision, reviewData, riskResult) {
  const {
    decision_reason, identity_verified, identity_verification_method, counterparty_type,
    account_ownership_confirmed, fraud_indicators, risk_override_reason, escalation_level,
    escalation_reason, business_purpose, authorization_reviewed, authorization_type_confirmed,
    customer_contacted, customer_contact_outcome, recommended_return_code, return_code_reason,
    reviewer_confidence, additional_notes, time_to_decide_seconds,
  } = reviewData || {};

  const confWeight = CONFIDENCE_WEIGHTS[reviewer_confidence || 'MEDIUM'];

  await insert('review_decisions', {
    transaction_id:               txn.transaction_id,
    decision,
    decision_reason:              decision_reason || null,
    reviewer_confidence:          reviewer_confidence || 'MEDIUM',
    confidence_weight:            confWeight,
    time_to_decide_seconds:       time_to_decide_seconds || null,
    risk_level_at_decision:       riskResult.riskLevel,
    risk_score_at_decision:       riskResult.riskScore,
    risk_flags_at_decision:       riskResult.riskFlags,
    ai_recommendation:            txn.ai_recommendation || null,
    ai_confidence:                txn.ai_confidence || null,
    identity_verified:            identity_verified || false,
    identity_verification_method: identity_verification_method || null,
    counterparty_type:            counterparty_type || null,
    account_ownership_confirmed:  account_ownership_confirmed || false,
    fraud_indicators:             fraud_indicators || [],
    risk_override_reason:         risk_override_reason || null,
    escalation_level:             escalation_level || 'none',
    escalation_reason:            escalation_reason || null,
    business_purpose:             business_purpose || null,
    authorization_reviewed:       authorization_reviewed || false,
    authorization_type_confirmed: authorization_type_confirmed || null,
    customer_contacted:           customer_contacted || false,
    customer_contact_outcome:     customer_contact_outcome || null,
    recommended_return_code:      recommended_return_code || null,
    return_code_reason:           return_code_reason || null,
    additional_notes:             additional_notes || null,
    ai_automation:                false,
  });

  await insert('human_decisions', {
    transaction_id:                txn.transaction_id,
    reviewer_id:                   'reviewer_01',
    reviewer_name:                 'Risk Analyst',
    decision,
    decision_reason:               decision_reason || null,
    risk_level_at_decision:        riskResult.riskLevel,
    risk_score_at_decision:        riskResult.riskScore,
    risk_flags_at_decision:        riskResult.riskFlags,
    ai_recommendation_at_decision: txn.ai_recommendation || null,
    ai_confidence_at_decision:     txn.ai_confidence || null,
  });

  await finaliseLifecycle(txn, decision, { ...reviewData, _actorType: 'HUMAN' }, riskResult);

  await insert('audit_logs', {
    transaction_id: txn.transaction_id,
    event_type:    'human_reviewed',
    event_summary: `Human ${decision.toUpperCase()}D · Confidence: ${reviewer_confidence || 'MEDIUM'} · ${business_purpose || 'No purpose stated'}`,
    event_data:    { decision, risk_level: riskResult.riskLevel, identity_verified, fraud_indicators, escalation_level, business_purpose, recommended_return_code, reviewer_confidence },
    actor: 'HUMAN', actor_id: 'reviewer_01',
    severity: decision === 'decline' ? 'warning' : 'info',
  });
}

// 1.3 checkPatternMatch now checks the primary hash AND the adjacent bucket hash
async function checkPatternMatch(txn, riskFlags) {
  const hashes = generatePatternHashes(txn, riskFlags);
  for (const hash of hashes) {
    const match = await queryOne('learning_patterns',
      p => p.pattern_hash === hash && p.promoted_to_level1 === true && p.is_frozen !== true
    );
    if (match) return match;
  }
  return null;
}

async function recordMirDecision(txn, category, actorType, riskResult) {
  try {
    const hash     = generatePatternHash(txn, riskResult.riskFlags);
    const existing = await queryOne('learning_patterns', p => p.pattern_hash === hash);
    if (existing) {
      const catCounts = { ...(existing.mir_category_counts || {}) };
      catCounts[category] = (catCounts[category] || 0) + 1;
      const dominant = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || category;
      await update('learning_patterns', p => p.pattern_hash === hash, () => ({
        mir_category_counts:  catCounts,
        mir_request_category: dominant,
      }));
    }
    await recordLifecycleRequest(txn.transaction_id, txn.info_request_rounds || 1, category, '', actorType || 'HUMAN');
  } catch (e) {
    console.warn('[learningPipeline] recordMirDecision (non-fatal):', e.message);
  }
}

async function getLearningStats() {
  const all      = await queryAll('learning_patterns');
  const promoted = all.filter(p => p.promoted_to_level1);
  const frozen   = all.filter(p => p.is_frozen);
  const transferred = all.filter(p => p.transfer_source_hash);
  const totalDec = all.reduce((a, p) => a + (p.total_decisions || 0), 0);
  const totalRev = (await queryAll('review_decisions')).length;

  const allDeclines = await queryAll('review_decisions', r => r.decision === 'decline');
  const fiCounts = {};
  allDeclines.forEach(r => (r.fraud_indicators || []).forEach(fi => { fiCounts[fi] = (fiCounts[fi] || 0) + 1; }));
  const topFraudIndicators = Object.entries(fiCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([k, v]) => ({ indicator: k, count: v }));

  return {
    totalPatterns:        all.length,
    promotedPatterns:     promoted.length,
    frozenPatterns:       frozen.length,
    transferredPatterns:  transferred.length,
    totalHumanDecisions:  totalDec,
    totalRichReviews:     totalRev,
    promotionRate:        all.length > 0 ? Math.round((promoted.length / all.length) * 100) : 0,
    recentPromotions:     promoted.slice(-5).reverse(),
    topFraudIndicators,
    autonomousPatterns:   promoted.filter(p => p.workflow_playbook).length,
    totalMirDecisions:    all.reduce((a, p) => a + (p.mir_count || 0), 0),
  };
}

module.exports = {
  // Core public API (unchanged signatures)
  recordDecision,
  checkPatternMatch,
  getLearningStats,
  // Lifecycle tracking
  recordMirDecision,
  startLifecycle,
  recordLifecycleRequest,
  recordLifecycleResponse,
  finaliseLifecycle,
  // Autonomous workflow
  runAutonomousWorkflow,
  evaluateOriginatorResponse,
  // Utilities
  generatePatternHash,
  generatePatternHashes,
};
