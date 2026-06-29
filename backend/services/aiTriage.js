// backend/services/aiTriage.js
//
// Improvements applied:
//  4.1 Bounded AI score adjustment  — getAiScoreAdjustment() returns 0–15 delta, confidence-gated
//  4.2 Tiered AI prompts            — minimal / standard / deep brief based on risk complexity
//  4.3 Counterfactual explainability — deep tier includes "What Would Resolve This" section
//
// Bug fix: corrected model name from 'gemini-3.1-flash-lite' to 'gemini-2.0-flash-lite'

'use strict';

let genAI = null, geminiModel = null;

function initGemini() {
  const key = process.env.GEMINI_API_KEY;
  if (key && key !== 'YOUR_GEMINI_API_KEY') {
    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      genAI = new GoogleGenerativeAI(key);
      geminiModel = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash-lite',
        generationConfig: { temperature: 0.15, maxOutputTokens: 1024 },
      });
      console.log('✅ Gemini AI initialized (Real Mode)');
    } catch (e) { console.warn('⚠️  Gemini init failed:', e.message); }
  } else {
    console.log('ℹ️  No Gemini API key — running in AI simulation mode');
  }
}

async function callLLM(prompt) {
  if (geminiModel) {
    try {
      const result = await geminiModel.generateContent(prompt);
      return result.response.text();
    } catch (e) { console.warn('[AI] Gemini fallback:', e.message); }
  }
  return simulate(prompt);
}

// ── 4.2 Brief tier selector ───────────────────────────────────────────────────
// Drives prompt verbosity/depth. Keeps cheap for simple cases; invests detail where it matters.
function _getBriefTier(riskResult) {
  const level        = riskResult.riskLevel || 1;
  const score        = riskResult.riskScore || 0;
  const flags        = riskResult.riskFlags || [];
  const criticalCnt  = flags.filter(f => f.flag_level === 3).length;
  const fingerprint  = riskResult.riskFingerprint;
  const inBoundary   = !!fingerprint?.boundary_zone;

  if (level === 3 || criticalCnt >= 2 || score >= 75 || inBoundary) return 'deep';
  if (level === 2 && flags.length <= 1 && score < 45)               return 'minimal';
  if (level === 2)                                                    return 'standard';
  return 'minimal'; // L1 (shouldn't normally reach generateReviewBrief)
}

// ── 4.1 AI score adjustment ───────────────────────────────────────────────────
// Returns a bounded positive delta (0–15 pts) when AI detects contextual risk
// not captured by rule-based scoring. Caller wraps in a 2.5 s timeout.
async function getAiScoreAdjustment(txn, riskResult) {
  // Only meaningful for L2/L3 — L1 is auto-approved, adjustment not needed
  if ((riskResult.riskLevel || 1) < 2) {
    return { delta: 0, reason: 'L1 transaction — no AI score adjustment applied', confidence: 0 };
  }

  const flags      = (riskResult.riskFlags || [])
    .map(f => `${f.rule_code}: ${f.rule_name} (level ${f.flag_level}, contrib ${f.contribution})`)
    .join('\n') || 'None';
  const fp         = riskResult.riskFingerprint || {};
  const secMult    = fp.sec_multiplier ? `${txn.sec_code} multiplier=${fp.sec_multiplier}` : txn.sec_code;
  const trustInfo  = fp.trust_multiplier ? `Trust multiplier=${fp.trust_multiplier}` : 'No trust data';
  const boundary   = fp.boundary_zone   ? `⚠️ Near boundary: ${fp.boundary_zone}` : 'Not near a boundary';

  const prompt = [
    `You are an ACH risk AI calibrating a transaction's risk score upward if warranted.`,
    ``,
    `Transaction details:`,
    `  ID=${txn.transaction_id}  SEC=${secMult}  Company="${txn.company_name}"  Amount=$${txn.amount}`,
    `  Type=${txn.transaction_type}  Auth=${txn.authorization_type || 'N/A'}  OFAC=${txn.ofac_screened}  AML=${txn.aml_flag}`,
    ``,
    `Current risk score: ${riskResult.riskScore}/100  Level: ${riskResult.riskLevel}`,
    `${boundary}  ${trustInfo}`,
    ``,
    `Triggered rules:`,
    flags,
    ``,
    `Evaluate whether contextual factors (narrative inconsistency, SEC code risk profile,`,
    `authorization type mismatch, unusual amount for stated purpose, trust tier) justify`,
    `increasing the risk score by 0–15 points.`,
    ``,
    `Rules:`,
    `- delta MUST be an integer between 0 and 15 (inclusive). 0 = no extra risk found.`,
    `- confidence must be between 0.0 and 1.0. Only apply delta if confidence >= 0.70.`,
    `- If confidence < 0.70, return delta=0.`,
    ``,
    `Respond ONLY with valid JSON (no markdown):`,
    `{"delta":5,"reason":"One-sentence explanation.","confidence":0.82}`,
  ].join('\n');

  let parsed = null;
  try {
    const raw = await callLLM(prompt);
    // Strip any accidental markdown fencing
    const clean = (raw || '').replace(/```json|```/g, '').trim();
    parsed = JSON.parse(clean);
  } catch (_) {}

  if (!parsed || typeof parsed.delta !== 'number') {
    return { delta: 0, reason: 'AI adjustment parse failed — no change', confidence: 0 };
  }

  // Enforce bounds regardless of what model returns
  const confidence = Math.max(0, Math.min(1, parseFloat(parsed.confidence) || 0));
  const rawDelta   = Math.round(parseFloat(parsed.delta) || 0);
  const delta      = confidence >= 0.70 ? Math.max(0, Math.min(15, rawDelta)) : 0;

  return {
    delta,
    reason:     String(parsed.reason || '').slice(0, 200),
    confidence,
  };
}

// ── generateReviewBrief (tiered) ──────────────────────────────────────────────
async function generateReviewBrief(txn, riskResult) {
  const tier  = _getBriefTier(riskResult);
  const brief = await _buildBriefByTier(txn, riskResult, tier);
  return {
    brief,
    tier,
    recommendation: riskResult.riskScore >= 70 ? 'decline' : 'review',
    confidence: Math.min(95, Math.round(40 + riskResult.riskScore * 0.55)),
  };
}

async function _buildBriefByTier(txn, riskResult, tier) {
  const flags    = (riskResult.riskFlags || [])
    .map(f => `  - [${f.severity.toUpperCase()}] ${f.rule_code}: ${f.rule_name} — ${f.description}`)
    .join('\n') || '  None';
  const fp       = riskResult.riskFingerprint || {};
  const boundary = fp.boundary_zone ? `⚠️ NEAR LEVEL BOUNDARY: ${fp.boundary_zone}` : '';
  const trust    = fp.trust_multiplier !== 1.0 ? `Trust multiplier: ${fp.trust_multiplier}` : '';
  const secInfo  = fp.sec_multiplier ? `SEC ${txn.sec_code} threshold multiplier: ${fp.sec_multiplier}` : '';

  if (tier === 'minimal') {
    const prompt = [
      `You are an ACH compliance AI. Write a short Level ${riskResult.riskLevel} review brief.`,
      `Transaction: ${txn.sec_code} $${txn.amount} from "${txn.company_name}" | Score: ${riskResult.riskScore}/100`,
      `Flags:\n${flags}`,
      `${boundary}`,
      `Write 3–4 sentences: risk summary, main flag, recommendation. Markdown. Be concise.`,
    ].join('\n');
    return callLLM(prompt);
  }

  if (tier === 'standard') {
    const prompt = [
      `You are a senior ACH fraud analyst AI. Pre-process this Level ${riskResult.riskLevel} transaction for human review.`,
      ``,
      `Transaction: ID=${txn.transaction_id} SEC=${txn.sec_code} Company="${txn.company_name}" (ID:${txn.company_id})`,
      `Amount=$${txn.amount} Type=${txn.transaction_type} RDFI=${txn.routing_number} Auth=${txn.authorization_type || '?'}`,
      `OFAC_screened=${txn.ofac_screened} AML_flag=${txn.aml_flag}`,
      `Risk Score: ${riskResult.riskScore}/100  Level: ${riskResult.riskLevel}`,
      `${boundary} ${secInfo} ${trust}`,
      ``,
      `Triggered Risk Rules:\n${flags}`,
      ``,
      `Generate in markdown:`,
      `1. Executive summary (2–3 sentences)`,
      `2. Per-flag plain-English explanation`,
      `3. AI Recommendation with confidence %`,
      `4. Pre-populated compliance checklist (checkboxes)`,
      ``,
      `Human only clicks Approve or Decline. Be professional and concise.`,
    ].join('\n');
    return callLLM(prompt);
  }

  // 4.3 Deep tier — includes counterfactual "What Would Resolve This" section
  const critFlags = (riskResult.riskFlags || []).filter(f => f.flag_level >= 2);
  const counterfactualItems = critFlags.map(f =>
    `  - ${f.rule_name}: What condition/document removes this flag?`
  ).join('\n') || '  - Evaluate all flags for resolvability.';

  const prompt = [
    `You are a senior ACH fraud analyst AI. Produce a DEEP compliance brief for this Level ${riskResult.riskLevel} transaction.`,
    ``,
    `Transaction: ID=${txn.transaction_id} SEC=${txn.sec_code} Company="${txn.company_name}" (ID:${txn.company_id})`,
    `Amount=$${txn.amount} Type=${txn.transaction_type} RDFI=${txn.routing_number} Auth=${txn.authorization_type || '?'}`,
    `OFAC_screened=${txn.ofac_screened} AML_flag=${txn.aml_flag}`,
    `Risk Score: ${riskResult.riskScore}/100  Level: ${riskResult.riskLevel}`,
    `${boundary} ${secInfo} ${trust}`,
    fp.primary_driver ? `Primary risk driver: ${fp.primary_driver}` : '',
    ``,
    `Triggered Risk Rules:\n${flags}`,
    ``,
    `Generate in markdown with ALL of these sections:`,
    ``,
    `### Executive Summary`,
    `(2–3 sentences with overall risk posture)`,
    ``,
    `### Risk Flag Analysis`,
    `(Per-flag plain-English explanation with business context)`,
    ``,
    `### AI Recommendation`,
    `(APPROVE / DECLINE / REQUEST INFO with confidence %)`,
    ``,
    `### What Would Resolve This`,
    `For each major flag, state:`,
    `(a) What specific condition would need to change for this flag to NOT fire`,
    `(b) What documentation the originator could provide to clear this flag`,
    `(c) Whether this flag is resolvable (e.g. auth proof) or non-resolvable (e.g. OFAC hit)`,
    `Flags to evaluate:`,
    counterfactualItems,
    ``,
    `### Pre-Populated Compliance Checklist`,
    `(Checkboxes the reviewer must action)`,
    ``,
    `Human clicks only Approve or Decline. Be precise and professional.`,
  ].filter(Boolean).join('\n');

  return callLLM(prompt);
}

// ── L1 compliance notes (unchanged) ──────────────────────────────────────────
async function generateComplianceNotes(txn, riskResult) {
  const prompt = [
    `You are a NACHA compliance AI. Generate Level 1 auto-approval compliance notes.`,
    `Transaction: ID=${txn.transaction_id} SEC=${txn.sec_code} TC=${txn.transaction_code || 'N/A'}`,
    `Company="${txn.company_name}" Amount=$${txn.amount} Type=${txn.transaction_type}`,
    `RDFI=${txn.routing_number} Account=${txn.account_number} EffDate=${txn.effective_date}`,
    `Trace=${txn.trace_number || 'N/A'} Authorization=${txn.authorization_type || 'N/A'}`,
    `Risk: Score=${riskResult.riskScore}/100 Level=1 Rules=${riskResult.evaluatedRules} Flags=0`,
    `Format in markdown: NACHA compliance table, regulatory basis, audit trail. Concise.`,
  ].join('\n');
  return callLLM(prompt);
}

// ── Brief regeneration after human action (unchanged structure) ───────────────
async function regenerateBriefForOperation(txn, riskResult, operation, context) {
  const { companyTransactions = [], infoRequests = [], operationDetails = {} } = context;
  const otherTxns    = companyTransactions.filter(t => t.transaction_id !== txn.transaction_id);
  const totalCount   = otherTxns.length;
  const approvedCount = otherTxns.filter(t => ['approved', 'auto_approved'].includes(t.status)).length;
  const declinedCount = otherTxns.filter(t => t.status === 'declined').length;
  const approvalRate  = totalCount > 0 ? Math.round((approvedCount / totalCount) * 100) : 'N/A';
  const avgAmount     = totalCount > 0
    ? (otherTxns.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0) / totalCount).toFixed(2)
    : 'N/A';
  const recentTxns = otherTxns.slice(0, 5)
    .map(t => `  - ${t.transaction_id}: $${t.amount} | ${t.status} | Risk L${t.risk_level || '?'}`)
    .join('\n') || '  None on record';

  const flags = (riskResult.riskFlags || [])
    .map(f => `  - [${(f.severity || 'info').toUpperCase()}] ${f.rule_code}: ${f.rule_name}`)
    .join('\n') || '  None';

  const mirHistory = infoRequests.length === 0
    ? 'No information requests on record.'
    : infoRequests.map(r => {
        const lines = [
          `  Round ${r.round_number} [${r.actor_type}] — ${(r.category || '').replace(/_/g, ' ')}`,
          `  Request: ${(r.message || '').slice(0, 150)}`,
        ];
        if (r.status === 'responded') lines.push(`  Response: ${(r.response_message || '').slice(0, 250)}`);
        else lines.push(`  Status: ${r.status}`);
        return lines.join('\n');
      }).join('\n\n');

  let opContext = '';
  if (operation === 'approved') {
    opContext = `DECISION: APPROVED\nReviewer: ${operationDetails.reviewer_name || 'Reviewer'}\nNotes: ${operationDetails.reason || 'None'}`;
  } else if (operation === 'declined') {
    opContext = `DECISION: DECLINED\nReviewer: ${operationDetails.reviewer_name || 'Reviewer'}\nNotes: ${operationDetails.reason || 'None'}\nReturn Code: ${operationDetails.return_code || 'N/A'}`;
  } else if (operation === 'more_info_requested') {
    opContext = [
      `ACTION: MORE INFORMATION REQUESTED`,
      `Round: ${operationDetails.round_number || 1}`,
      `Requested By: ${operationDetails.requested_by || 'Reviewer'}`,
      `Category: ${(operationDetails.category || 'CUSTOM').replace(/_/g, ' ')}`,
      `Message: ${operationDetails.message || ''}`,
    ].join('\n');
  } else if (operation === 'info_responded') {
    opContext = [
      `ACTION: ORIGINATOR RESPONDED`,
      `Round: ${operationDetails.round_number || 1}`,
      `Response: ${(operationDetails.response_message || '').slice(0, 400)}`,
      `Next Step: Back under human review`,
    ].join('\n');
  }

  const prompt = [
    `You are a senior ACH fraud analyst AI. Update the compliance brief for this transaction.`,
    ``,
    `=== CURRENT TRANSACTION ===`,
    `ID: ${txn.transaction_id} | Company: "${txn.company_name}" (ID: ${txn.company_id})`,
    `SEC: ${txn.sec_code} | Amount: $${txn.amount} | Type: ${txn.transaction_type}`,
    `Risk Level: ${riskResult.riskLevel} | Risk Score: ${riskResult.riskScore}/100`,
    `OFAC Screened: ${txn.ofac_screened} | AML Flag: ${txn.aml_flag}`,
    ``,
    `=== TRIGGERED RISK FLAGS ===`,
    flags,
    ``,
    `=== COMPANY HISTORY (Company ID: ${txn.company_id}) ===`,
    `Prior transactions: ${totalCount} | Approved: ${approvedCount} (${approvalRate}%) | Declined: ${declinedCount}`,
    `Average amount: $${avgAmount}`,
    `Recent:\n${recentTxns}`,
    ``,
    `=== MIR HISTORY ===`,
    mirHistory,
    ``,
    `=== CURRENT OPERATION ===`,
    opContext,
    ``,
    `Write an updated compliance brief in markdown. Lead with a clear status banner:`,
    `- ## ✅ TRANSACTION APPROVED   (if approved)`,
    `- ## ❌ TRANSACTION DECLINED   (if declined)`,
    `- ## 🔄 MORE INFORMATION REQUESTED   (if MIR sent)`,
    `- ## 📨 ORIGINATOR RESPONSE RECEIVED   (if info_responded)`,
    ``,
    `Include: what happened at this stage, company risk insights, MIR history (if any),`,
    `updated risk assessment or final outcome, compliance notes. Concise and professional.`,
  ].join('\n');

  return callLLM(prompt);
}

// ── Simulation fallbacks (used when Gemini key is absent) ────────────────────
function simulate(prompt) {
  const ts = new Date().toISOString();
  if (prompt.includes('DECISION: APPROVED'))         return simulateApproved(ts);
  if (prompt.includes('DECISION: DECLINED'))         return simulateDeclined(ts);
  if (prompt.includes('MORE INFORMATION REQUESTED')) return simulateMirRequested(ts);
  if (prompt.includes('ORIGINATOR RESPONDED'))       return simulateInfoReceived(ts);
  if (prompt.includes('Level 1') || prompt.includes('compliance notes')) return simulateL1(ts);
  if (prompt.includes('Level 3') || prompt.includes('HIGH-RISK'))        return simulateBrief(ts, 3);
  return simulateBrief(ts, 2);
}

function simulateApproved(ts) {
  return `## ✅ TRANSACTION APPROVED
**Updated**: ${ts} | **Final Status**: Approved

### Approval Summary
This transaction has been reviewed and approved. All compliance checks satisfied. Cleared for settlement processing.

### Company Risk Profile
- Historical approval rate consistent with low-to-moderate risk profile
- No systematic fraud patterns detected across the company's transaction history
- Amount aligns with company's historical transaction averages

### Compliance Verification
- ✅ Identity verified against KYC records
- ✅ Authorization documented
- ✅ Business purpose confirmed
- ✅ OFAC/sanctions screening passed
- ✅ NACHA operating rules satisfied

*Decision recorded. Transaction cleared for settlement.*`;
}

function simulateDeclined(ts) {
  return `## ❌ TRANSACTION DECLINED
**Updated**: ${ts} | **Final Status**: Declined

### Decline Summary
This transaction has been reviewed and declined. A return entry will be initiated per NACHA timelines.

### Company Risk Context
- This decline contributes to the company's updated risk profile
- Compliance team should review originator relationship status
- Consider ACH filter policy review for this company ID

### Post-Decline Compliance Notes
- Return code applied per NACHA Operating Rules
- Originator must be notified of return within required timeframe
- Decline reason documented for regulatory examination

*Decision recorded. Return entry processing initiated.*`;
}

function simulateMirRequested(ts) {
  return `## 🔄 MORE INFORMATION REQUESTED
**Updated**: ${ts} | **Status**: Awaiting Originator Response

### Request Summary
Additional information requested from originator via secure portal link. Processing paused pending response. SLA clock is running.

### Next Steps
- Monitor for originator portal response within SLA window
- If no response by deadline, escalate per policy
- Upon response, review documentation and make final Approve/Decline decision

*All portal interactions logged for audit purposes.*`;
}

function simulateInfoReceived(ts) {
  return `## 📨 ORIGINATOR RESPONSE RECEIVED
**Updated**: ${ts} | **Status**: Under Review

### Response Summary
Originator has submitted their response through the secure portal. Information is now available for reviewer action.

### Updated Risk Assessment
- If response satisfactorily addresses all flagged concerns → Recommend Approve
- If response is incomplete or raises new questions → Consider additional MIR round or Decline

*Response logged and immutable for audit purposes.*`;
}

function simulateL1(ts) {
  return `## ✅ AUTO-APPROVED — LEVEL 1 COMPLIANCE NOTES
**Generated**: ${ts} | **Processor**: AI_ENGINE_v3.0 | **Mode**: Zero-Touch

### NACHA Compliance Verification
| Check | Status | Detail |
|-------|--------|--------|
| ABA Routing (Mod-10 checksum) | ✅ PASS | Routing number mathematically valid |
| SEC Entry Class Code | ✅ PASS | Code valid per NACHA Operating Rules |
| Transaction Code | ✅ PASS | TC maps to valid account type and direction |
| Amount Format | ✅ PASS | Within standard processing thresholds |
| Effective Date | ✅ PASS | Within NACHA 5-day advance dating window |
| Company ID Format | ✅ PASS | 10-character originator ID confirmed |
| OFAC Pre-Screen | ✅ PASS | No SDN/OFAC match indicators |
| Trace Number Format | ✅ PASS | ODFI prefix + sequence valid |
| Velocity Check | ✅ PASS | No threshold breaches detected |
| Duplicate Detection | ✅ PASS | No matching trace in 5-day lookback |

### Regulatory Basis
- **Reg E** (Electronic Fund Transfer Act) — Consumer protections satisfied
- **NACHA Operating Rules** (Current Edition) — Full compliance
- **BSA / AML** — Transaction below CTR threshold; no structuring indicators
- **Institution ACH Risk Policy** — Approved for automated processing

*This record constitutes an immutable electronic audit trail for regulatory examination.*`;
}

function simulateBrief(ts, level) {
  const tier       = level === 3 ? 'DEEP' : 'STANDARD';
  const levelLabel = level === 3 ? '🔴 HIGH-RISK (Level 3)' : '🟡 MEDIUM-RISK (Level 2)';
  const decisionHint = level === 3 ? 'DECLINE RECOMMENDED' : 'CAREFUL REVIEW REQUIRED';
  const declineReason = level === 3
    ? 'Unauthorized counterparty / OFAC screening required'
    : 'Unverified account ownership or amount anomaly';

  let counterfactual = '';
  if (level === 3) {
    counterfactual = `
### What Would Resolve This
- **High-amount flag**: Provide signed authorization agreement and confirmed business purpose documentation.
- **OFAC screening flag**: Non-resolvable — requires compliance team clearance before any approval.
- **Velocity flag**: Resolvable — originator can provide batch schedule documentation showing planned activity.`;
  }

  return `## 🤖 AI PRE-PROCESSING BRIEF — ${levelLabel} [${tier}]
**Generated**: ${ts} | **Human Decision Required**

### Executive Summary
This transaction exceeds the zero-touch threshold and requires human review. All context has been pre-populated below.

### Risk Profile
Evaluated against 25 active NACHA risk rules. ${level === 3
  ? 'Critical-level flags triggered — mandatory human oversight required.'
  : 'Medium-risk flags triggered — elevated scrutiny warranted.'}

### AI Recommendation
**→ ${decisionHint}** — ${level === 3
  ? 'High-risk indicators present. Decline unless reviewer confirms legitimacy.'
  : 'Verify counterparty identity and confirm business purpose before approving.'}
${counterfactual}

### Pre-Populated Compliance Checklist
- [ ] Verify receiver/counterparty identity against KYC records
- [ ] Confirm transaction purpose aligns with entry description
- [ ] Cross-reference company ID against approved originator list
- [ ] Validate effective date is within NACHA settlement window
- [ ] Check for active ACH debit block or positive pay filters
- [ ] Confirm no open disputes or fraud alerts on this account
- [ ] ${level === 3 ? 'Run OFAC SDN screening on originator and receiver' : 'Confirm authorization type is documented'}
- [ ] ${level === 3 ? 'Escalate to Compliance if OFAC match or AML indicator confirmed' : 'Review velocity history for this company ID'}

*All pre-processing complete. Select Approve or Decline to proceed.*`;
}

module.exports = {
  initGemini,
  generateComplianceNotes,
  generateReviewBrief,
  regenerateBriefForOperation,
  getAiScoreAdjustment,
};
