// backend/services/riskEngine.js
//
// Improvements applied:
//  2.1 Dynamic threshold calibration  — load SCORE_L2_MIN / L2_L3_THRESHOLD from DB (10-min cache)
//  2.2 Per-SEC-code multipliers       — adjust effective thresholds per code (IAT stricter, PPD lenient)
//  2.4 Soft boundary zone detection   — flag transactions ±4 pts from any level boundary
//  3.1 Adaptive rule weights          — prefer rule.learned_weight over static rule.weight
//  3.2 Co-occurrence multipliers      — bonus when correlated rule pairs both fire
//  3.3 Originator trust adjustment    — adjust final score by trust tier (0.85–1.22×)
//  3.4 Superlinear velocity scoring   — VEL_001 severity scales non-linearly past threshold
//  3.5 Risk fingerprint               — structured decomposition returned alongside riskScore

'use strict';

const { queryAll, update } = require('../database/db');

// ── Pure helpers ──────────────────────────────────────────────────────────────
function isValidRoutingNumber(rtn) {
  const d = String(rtn || '').replace(/\D/g, '');
  if (d.length !== 9) return false;
  const n = d.split('').map(Number);
  return (3*(n[0]+n[3]+n[6]) + 7*(n[1]+n[4]+n[7]) + (n[2]+n[5]+n[8])) % 10 === 0;
}
function isRoundDollar(amount) { return amount > 0 && amount % 100 === 0; }
function getDaysAhead(effectiveDate) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const eff   = new Date(effectiveDate + 'T00:00:00');
  return Math.round((eff - today) / (1000 * 60 * 60 * 24));
}

// ── In-memory caches ──────────────────────────────────────────────────────────
const THRESHOLD_CACHE_TTL   = 10 * 60 * 1000; // 10 min
const SEC_CACHE_TTL         = 10 * 60 * 1000; // 10 min
const CORRELATION_CACHE_TTL =  5 * 60 * 1000; //  5 min

let _thresholdCache   = { data: null, loadedAt: 0 };
let _secCodeCache     = { data: null, loadedAt: 0 };
let _correlationCache = { data: null, loadedAt: 0 };

// ── Default fallbacks (used until DB seeded or on load failure) ───────────────
const DEFAULT_THRESHOLDS = {
  SCORE_L2_MIN:      40, // L1→L2 tipping point when maxLvl===1
  L2_L3_THRESHOLD:   60, // L2→L3 tipping point when maxLvl===2
  SCORE_L3_MIN:      70, // direct L1→L3 jump threshold when maxLvl===1
  BOUNDARY_ZONE_PTS:  4, // ±pts considered a "soft zone"
  AUTO_APPROVE_CAP:  30, // score ceiling for auto-approve path
};

// SEC multiplier adjusts effective THRESHOLDS, not the score.
// Lower mult → lower threshold → easier to reach L2/L3 → stricter treatment.
const DEFAULT_SEC_MULTIPLIERS = {
  IAT: 0.78,  // International: strictest (OFAC, cross-border)
  TEL: 0.82,  // Telephone-initiated: high fraud risk
  WEB: 0.88,  // Internet-initiated: moderate-high
  CTX: 0.92,  // Corporate trade exchange
  CCD: 1.00,  // Corporate credit/debit: baseline
  PPD: 1.10,  // Prearranged payment: most lenient (established relationships)
};

// ── 2.1 Threshold loader ──────────────────────────────────────────────────────
async function _loadThresholds() {
  const now = Date.now();
  if (_thresholdCache.data && now - _thresholdCache.loadedAt < THRESHOLD_CACHE_TTL) {
    return _thresholdCache.data;
  }
  try {
    const rows = await queryAll('threshold_config');
    if (!rows || rows.length === 0) throw new Error('empty');
    const map = {};
    rows.forEach(r => { map[r._doc_key || r.key] = r.value; });
    const t = {
      SCORE_L2_MIN:      parseFloat(map.SCORE_L2_MIN)      || DEFAULT_THRESHOLDS.SCORE_L2_MIN,
      L2_L3_THRESHOLD:   parseFloat(map.L2_L3_THRESHOLD)   || DEFAULT_THRESHOLDS.L2_L3_THRESHOLD,
      SCORE_L3_MIN:      parseFloat(map.SCORE_L3_MIN)      || DEFAULT_THRESHOLDS.SCORE_L3_MIN,
      BOUNDARY_ZONE_PTS: parseFloat(map.BOUNDARY_ZONE_PTS) || DEFAULT_THRESHOLDS.BOUNDARY_ZONE_PTS,
      AUTO_APPROVE_CAP:  parseFloat(map.AUTO_APPROVE_CAP)  || DEFAULT_THRESHOLDS.AUTO_APPROVE_CAP,
    };
    _thresholdCache = { data: t, loadedAt: now };
    return t;
  } catch (_) {
    if (!_thresholdCache.data) {
      _thresholdCache = { data: { ...DEFAULT_THRESHOLDS }, loadedAt: now };
    }
    return _thresholdCache.data;
  }
}

// ── 2.2 SEC multiplier loader ─────────────────────────────────────────────────
async function _loadSecMultipliers() {
  const now = Date.now();
  if (_secCodeCache.data && now - _secCodeCache.loadedAt < SEC_CACHE_TTL) {
    return _secCodeCache.data;
  }
  try {
    const rows = await queryAll('sec_code_config');
    if (!rows || rows.length === 0) throw new Error('empty');
    const map = {};
    rows.forEach(r => { map[r._doc_key || r.sec_code] = parseFloat(r.multiplier) || 1.0; });
    _secCodeCache = { data: map, loadedAt: now };
    return map;
  } catch (_) {
    if (!_secCodeCache.data) {
      _secCodeCache = { data: { ...DEFAULT_SEC_MULTIPLIERS }, loadedAt: now };
    }
    return _secCodeCache.data;
  }
}

// ── 3.2 Correlation loader ────────────────────────────────────────────────────
async function _loadCorrelations() {
  const now = Date.now();
  if (_correlationCache.data && now - _correlationCache.loadedAt < CORRELATION_CACHE_TTL) {
    return _correlationCache.data;
  }
  try {
    const rows = await queryAll('rule_correlations');
    _correlationCache = { data: rows || [], loadedAt: now };
    return _correlationCache.data;
  } catch (_) {
    if (!_correlationCache.data) _correlationCache = { data: [], loadedAt: now };
    return _correlationCache.data;
  }
}

// ── 3.3 Originator trust → score multiplier ───────────────────────────────────
function _getTrustMultiplier(trustScore) {
  if (trustScore === null || trustScore === undefined) return 1.00;
  const ts = parseFloat(trustScore);
  if (Number.isNaN(ts)) return 1.00;
  if (ts >= 80) return 0.85; // high trust  → reduce score by 15%
  if (ts >= 50) return 1.00; // mid trust   → no adjustment
  if (ts >= 30) return 1.12; // low trust   → increase score by 12%
  return 1.22;               // very low    → increase score by 22%
}

// ── Rule evaluator (unchanged logic) ──────────────────────────────────────────
function evaluateRule(rule, txn, ctx = {}) {
  const { field, operator, value } = rule.condition_logic;
  const fieldMap = {
    amount:               txn.amount,
    sec_code:             txn.sec_code,
    routing_number:       txn.routing_number || txn.rdfi_routing,
    transaction_code:     String(txn.transaction_code || ''),
    prenote:              txn.prenote === true || txn.prenote === 'true',
    ofac_screened:        txn.ofac_screened === true || txn.ofac_screened === 'true',
    ofac_result:          txn.ofac_result || 'clear',
    aml_flag:             txn.aml_flag === true || txn.aml_flag === 'true',
    authorization_type:   txn.authorization_type || null,
    created_hour:         new Date().getHours(),
    days_ahead:           getDaysAhead(txn.effective_date || txn.effective_entry_date || new Date().toISOString().split('T')[0]),
    company_daily_count:  ctx.company_daily_count || 1,
    duplicate_trace:      ctx.duplicate_trace || false,
    rdfi_trace_mismatch:  ctx.rdfi_trace_mismatch || false,
    positive_pay_mismatch: txn.positive_pay_mismatch === true,
    ach_block_active:     ctx.ach_block_active || false,
    check_stale:          ctx.check_stale || false,
    new_originator:       ctx.new_originator || false,
    invalid_rtn:          !isValidRoutingNumber(txn.routing_number || txn.rdfi_routing),
  };
  const fv = fieldMap[field] !== undefined ? fieldMap[field] : null;
  switch (operator) {
    case '>':         return fv > value;
    case '<':         return fv < value;
    case '>=':        return fv >= value;
    case '<=':        return fv <= value;
    case '===':       return fv === value;
    case '!==':       return fv !== value;
    case 'between':   return fv >= value[0] && fv <= value[1];
    case 'outside':   return fv < value[0] || fv > value[1];
    case 'is_round':  return value ? isRoundDollar(fv) : !isRoundDollar(fv);
    case 'invalid_rtn': return value
      ? !isValidRoutingNumber(txn.routing_number || txn.rdfi_routing)
      :  isValidRoutingNumber(txn.routing_number || txn.rdfi_routing);
    default:          return false;
  }
}

// ── Main scoring ──────────────────────────────────────────────────────────────
async function scoreTransaction(txn, ctx = {}) {
  // Load all dynamic config concurrently to minimise latency
  const [rules, thresholds, secMultipliers, correlations] = await Promise.all([
    queryAll('risk_rules', r => r.is_active),
    _loadThresholds(),
    _loadSecMultipliers(),
    _loadCorrelations(),
  ]);

  const flags   = [];
  const flagMap = {}; // rule_code → { contribution, flag_level }
  let total         = 0;
  let velocityBonus = 0;
  let maxLvl        = 1;

  for (const rule of rules) {
    if (!evaluateRule(rule, txn, ctx)) continue;

    const severity = rule.flag_level === 3 ? 'critical'
      : rule.flag_level === 2 ? 'warning' : 'info';

    // 3.1 Prefer calibrated learned weight; fall back to seeded static weight
    const effectiveWeight = (rule.learned_weight !== null && rule.learned_weight !== undefined)
      ? parseFloat(rule.learned_weight)
      : parseFloat(rule.weight || 0);

    const baseContrib = effectiveWeight * rule.flag_level * 5;
    let contribution  = baseContrib;

    // 3.4 Superlinear velocity: contribution scales non-linearly past threshold
    if (rule.rule_code === 'VEL_001' || rule.rule_category === 'velocity') {
      const velThreshold = rule.condition_logic?.value;
      const actualCount  = ctx.company_daily_count || 1;
      if (velThreshold && actualCount > velThreshold) {
        const overage      = (actualCount - velThreshold) / velThreshold;
        const velocityMult = Math.min(2.5, 1.0 + overage * 0.6);
        const extra        = baseContrib * (velocityMult - 1.0);
        velocityBonus     += extra;
        contribution       = baseContrib + extra; // = baseContrib × velocityMult
      }
    }

    flags.push({
      rule_code:       rule.rule_code,
      rule_name:       rule.rule_name,
      category:        rule.rule_category,
      description:     rule.description,
      flag_level:      rule.flag_level,
      weight:          rule.weight,
      learned_weight:  rule.learned_weight ?? null,
      effective_weight: effectiveWeight,
      contribution:    Math.round(contribution * 10) / 10,
      severity,
    });
    flagMap[rule.rule_code] = { contribution, flag_level: rule.flag_level };

    total += contribution;
    if (rule.flag_level > maxLvl) maxLvl = rule.flag_level;

    // Fire-and-forget trigger count (non-blocking, best-effort)
    update('risk_rules', r => r.rule_code === rule.rule_code,
      r => ({ trigger_count: (r.trigger_count || 0) + 1 })
    ).catch(e => console.warn('[RiskEngine] trigger_count update failed:', e.message));
  }

  // 3.2 Co-occurrence bonus: when correlated rule pairs both fire
  let coOccurrenceBonus = 0;
  for (const corr of correlations) {
    const fA   = flagMap[corr.rule_code_a];
    const fB   = flagMap[corr.rule_code_b];
    const mult = parseFloat(corr.multiplier) || 1.0;
    if (fA && fB && mult > 1.0) {
      // Bonus is proportional to the smaller of the two contributions
      coOccurrenceBonus += Math.min(fA.contribution, fB.contribution) * (mult - 1.0);
    }
  }

  const rawTotal = total + coOccurrenceBonus;

  // 3.3 Trust multiplier applied to score (not thresholds)
  const trustMult     = _getTrustMultiplier(ctx.originator_trust_score);
  const adjustedScore = Math.min(100, Math.round(rawTotal * trustMult));
  const riskScore     = adjustedScore;

  // 2.2 SEC multiplier adjusts effective thresholds (not the score itself)
  const secMult     = secMultipliers[txn.sec_code] || 1.0;
  const adjL1L2     = Math.round(thresholds.SCORE_L2_MIN    * secMult);
  const adjL2L3     = Math.round(thresholds.L2_L3_THRESHOLD * secMult);
  const adjL3Direct = Math.round(thresholds.SCORE_L3_MIN    * secMult);

  // 2.1 Risk level using calibrated + SEC-adjusted thresholds
  const riskLevel = maxLvl === 3
    ? 3
    : maxLvl === 2
      ? (riskScore >= adjL2L3 ? 3 : 2)
      : (riskScore >= adjL3Direct ? 3 : riskScore >= adjL1L2 ? 2 : 1);

  // 2.4 Soft boundary zone — flag transactions within ±BOUNDARY_ZONE_PTS of any level transition
  const zonePts = thresholds.BOUNDARY_ZONE_PTS || 4;
  let boundaryZone = null;
  if (Math.abs(riskScore - adjL2L3)     <= zonePts) boundaryZone = 'L2_L3';
  else if (Math.abs(riskScore - adjL1L2) <= zonePts) boundaryZone = 'L1_L2';
  else if (Math.abs(riskScore - adjL3Direct) <= zonePts) boundaryZone = 'L3_DIRECT';

  // 3.5 Risk fingerprint — structured decomposition for UI + AI context
  const sortedFlags    = [...flags].sort((a, b) => b.contribution - a.contribution);
  const riskFingerprint = {
    primary_driver: sortedFlags[0]?.rule_name || null,
    top_factors: sortedFlags.slice(0, 3).map(f => ({
      rule_code:    f.rule_code,
      rule_name:    f.rule_name,
      contribution: f.contribution,
      flag_level:   f.flag_level,
    })),
    component_breakdown: {
      base_score:          Math.round(total - velocityBonus),
      velocity_boost:      Math.round(velocityBonus * 10) / 10,
      co_occurrence_bonus: Math.round(coOccurrenceBonus * 10) / 10,
      raw_total:           Math.min(100, Math.round(rawTotal)),
      trust_multiplier:    trustMult,
      final_score:         riskScore,
    },
    boundary_zone:       boundaryZone,
    sec_code:            txn.sec_code,
    sec_multiplier:      secMult,
    sec_adj_thresholds:  { l1_l2: adjL1L2, l2_l3: adjL2L3, l3_direct: adjL3Direct },
    trust_multiplier:    trustMult,
    adjusted_score:      riskScore,
    co_occurrence_bonus: Math.round(coOccurrenceBonus * 10) / 10,
  };

  return { riskLevel, riskScore, riskFlags: flags, evaluatedRules: rules.length, riskFingerprint };
}

// Allow calibration service to invalidate caches after a weekly update
function invalidateRuleCache() {
  _thresholdCache   = { data: null, loadedAt: 0 };
  _secCodeCache     = { data: null, loadedAt: 0 };
  _correlationCache = { data: null, loadedAt: 0 };
}

module.exports = { scoreTransaction, isValidRoutingNumber, getDaysAhead, invalidateRuleCache };
