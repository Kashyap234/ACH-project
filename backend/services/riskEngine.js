// backend/services/riskEngine.js — Full NACHA-compliant rule evaluation (Firestore async)
const { queryAll, update } = require('../database/db');

// ── ABA Mod-10 Checksum ─────────────────────────────────────────────────────
function isValidRoutingNumber(rtn) {
  const d = String(rtn || '').replace(/\D/g, '');
  if (d.length !== 9) return false;
  const n = d.split('').map(Number);
  return (3*(n[0]+n[3]+n[6]) + 7*(n[1]+n[4]+n[7]) + (n[2]+n[5]+n[8])) % 10 === 0;
}

function isRoundDollar(amount) { return amount > 0 && amount % 100 === 0; }

function getDaysAhead(effectiveDate) {
  const today = new Date(); today.setHours(0,0,0,0);
  const eff   = new Date(effectiveDate + 'T00:00:00');
  return Math.round((eff - today) / (1000 * 60 * 60 * 24));
}

// ── Evaluate one rule against a transaction ─────────────────────────────────
function evaluateRule(rule, txn, ctx = {}) {
  const { field, operator, value } = rule.condition_logic;

  const fieldMap = {
    amount:              txn.amount,
    sec_code:            txn.sec_code,
    routing_number:      txn.routing_number || txn.rdfi_routing,
    transaction_code:    String(txn.transaction_code || ''),
    prenote:             txn.prenote === true || txn.prenote === 'true',
    ofac_screened:       txn.ofac_screened === true || txn.ofac_screened === 'true',
    ofac_result:         txn.ofac_result || 'clear',
    aml_flag:            txn.aml_flag === true || txn.aml_flag === 'true',
    authorization_type:  txn.authorization_type || null,
    created_hour:        new Date().getHours(),
    days_ahead:          getDaysAhead(txn.effective_date || txn.effective_entry_date || new Date().toISOString().split('T')[0]),
    company_daily_count: ctx.company_daily_count || 1,
    duplicate_trace:     ctx.duplicate_trace || false,
    rdfi_trace_mismatch: ctx.rdfi_trace_mismatch || false,
    positive_pay_mismatch: txn.positive_pay_mismatch === true,
    ach_block_active:    ctx.ach_block_active || false,
    check_stale:         ctx.check_stale || false,
    new_originator:      ctx.new_originator || false,
    invalid_rtn:         !isValidRoutingNumber(txn.routing_number || txn.rdfi_routing),
  };

  let fv = fieldMap[field] !== undefined ? fieldMap[field] : null;

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
    case 'invalid_rtn': return value ? !isValidRoutingNumber(txn.routing_number || txn.rdfi_routing) : isValidRoutingNumber(txn.routing_number || txn.rdfi_routing);
    default:          return false;
  }
}

// ── Main scoring function ───────────────────────────────────────────────────
async function scoreTransaction(txn, ctx = {}) {
  const rules  = await queryAll('risk_rules', r => r.is_active);
  const flags  = [];
  let   total  = 0;
  let   maxLvl = 1;

  for (const rule of rules) {
    if (evaluateRule(rule, txn, ctx)) {
      const severity = rule.flag_level === 3 ? 'critical' : rule.flag_level === 2 ? 'warning' : 'info';
      flags.push({
        rule_code:   rule.rule_code,
        rule_name:   rule.rule_name,
        category:    rule.rule_category,
        description: rule.description,
        flag_level:  rule.flag_level,
        weight:      rule.weight,
        severity
      });
      // Weight contributes proportionally: weight(1-3) × level(1-3) × 5 → max ~45 per rule
      total += rule.weight * rule.flag_level * 5;
      if (rule.flag_level > maxLvl) maxLvl = rule.flag_level;
      // Fire-and-forget trigger count update (non-blocking)
      update('risk_rules', r => r.rule_code === rule.rule_code, r => ({ trigger_count: (r.trigger_count || 0) + 1 }))
        .catch(e => console.warn('[RiskEngine] trigger_count update failed:', e.message));
    }
  }

  const riskScore  = Math.min(100, Math.round(total));
  // riskLevel is driven primarily by the highest flag level triggered.
  // Score is only a tiebreaker when maxLvl is already elevated (>=2).
  const riskLevel  = maxLvl === 3 ? 3
    : maxLvl === 2 ? (riskScore >= 60 ? 3 : 2)
    : (riskScore >= 70 ? 3 : riskScore >= 40 ? 2 : 1);

  return { riskLevel, riskScore, riskFlags: flags, evaluatedRules: rules.length };
}

module.exports = { scoreTransaction, isValidRoutingNumber, getDaysAhead };
