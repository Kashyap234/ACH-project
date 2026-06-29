// backend/database/seed.js — Full NACHA rules + return code lookup (Firestore async)
const { queryOne, insert, getTable } = require('./db');

// ── NACHA Risk Rules ────────────────────────────────────────────────────────
// learned_weight is null on first seed; calibrationService.js updates it weekly.
const RISK_RULES = [
  // AMOUNT
  { rule_code:'AMT_001', rule_name:'Exceeds $50K Threshold',         rule_category:'amount',       description:'Transaction >$50,000 requires Level 3 enhanced scrutiny per NACHA WEB/CCD rules.',       condition_logic:{ field:'amount', operator:'>', value:50000 },               flag_level:3, weight:2.5, learned_weight:null },
  { rule_code:'AMT_002', rule_name:'High-Value ($10K–$50K)',          rule_category:'amount',       description:'Transaction $10K–$50K triggers standard Level 2 review.',                                condition_logic:{ field:'amount', operator:'between', value:[10000,50000] }, flag_level:2, weight:1.5, learned_weight:null },
  { rule_code:'AMT_003', rule_name:'Round Dollar Amount',             rule_category:'amount',       description:'Exact round $100 multiples are a known fraud structuring indicator.',                    condition_logic:{ field:'amount', operator:'is_round', value:true },         flag_level:2, weight:1.0, learned_weight:null },
  { rule_code:'AMT_004', rule_name:'Micro-Transaction (<$1)',         rule_category:'amount',       description:'Sub-dollar amounts may indicate account probing or pre-notification test.',              condition_logic:{ field:'amount', operator:'<', value:1 },                   flag_level:1, weight:0.5, learned_weight:null },
  // SEC CODE
  { rule_code:'SEC_001', rule_name:'IAT — International ACH',        rule_category:'compliance',   description:'IAT requires OFAC screening, 7 mandatory addenda, and Bank Secrecy Act compliance.',   condition_logic:{ field:'sec_code', operator:'===', value:'IAT' },           flag_level:3, weight:2.5, learned_weight:null },
  { rule_code:'SEC_002', rule_name:'TEL Entry — Phone Initiated',     rule_category:'compliance',   description:'TEL requires recorded verbal auth or written notice before debit.',                     condition_logic:{ field:'sec_code', operator:'===', value:'TEL' },           flag_level:2, weight:1.2, learned_weight:null },
  { rule_code:'SEC_003', rule_name:'WEB Entry — Internet Initiated',  rule_category:'compliance',   description:'WEB requires annual audit, commercially reasonable fraud detection, account validation.',condition_logic:{ field:'sec_code', operator:'===', value:'WEB' },           flag_level:2, weight:1.0, learned_weight:null },
  { rule_code:'SEC_004', rule_name:'CTX Entry — Corporate Trade',     rule_category:'compliance',   description:'CTX entries carry addenda and require ANSI ASC X12 or UN/EDIFACT format.',             condition_logic:{ field:'sec_code', operator:'===', value:'CTX' },           flag_level:2, weight:0.8, learned_weight:null },
  // TRANSACTION CODE / ACCOUNT TYPE
  { rule_code:'TXC_001', rule_name:'GL Account Debit (TC 47)',        rule_category:'account',      description:'General Ledger debit (TC=47) requires internal authorization.',                        condition_logic:{ field:'transaction_code', operator:'===', value:'47' },    flag_level:2, weight:1.2, learned_weight:null },
  { rule_code:'TXC_002', rule_name:'Loan Account Credit (TC 52)',     rule_category:'account',      description:'Loan account credit (TC=52) requires lender confirmation.',                             condition_logic:{ field:'transaction_code', operator:'===', value:'52' },    flag_level:2, weight:1.0, learned_weight:null },
  { rule_code:'TXC_003', rule_name:'Pre-Notification Entry',          rule_category:'compliance',   description:'Zero-dollar pre-note (TC=23/28/33/38) must precede first live entry by 3+ banking days.',condition_logic:{ field:'prenote', operator:'===', value:true },            flag_level:1, weight:0.3, learned_weight:null },
  // ROUTING
  { rule_code:'RTN_001', rule_name:'Invalid Routing Number (Mod-10)', rule_category:'account',      description:'Routing number fails ABA Mod-10 checksum validation — entry must be rejected.',        condition_logic:{ field:'routing_number', operator:'invalid_rtn', value:true },flag_level:3, weight:3.5, learned_weight:null },
  { rule_code:'RTN_002', rule_name:'RDFI Routing Mismatch',           rule_category:'account',      description:'RDFI routing digits in trace number do not match receiving DFI routing.',              condition_logic:{ field:'rdfi_trace_mismatch', operator:'===', value:true }, flag_level:3, weight:2.0, learned_weight:null },
  // OFAC / SANCTIONS
  { rule_code:'OFC_001', rule_name:'OFAC Screening Required',         rule_category:'sanctions',    description:'IAT or high-value transaction requires OFAC SDN list screening before processing.',    condition_logic:{ field:'ofac_screened', operator:'===', value:false },     flag_level:3, weight:3.0, learned_weight:null },
  { rule_code:'OFC_002', rule_name:'OFAC Potential Hit',              rule_category:'sanctions',    description:'Transaction counterparty may match OFAC Specially Designated Nationals (SDN) list.',  condition_logic:{ field:'ofac_result', operator:'===', value:'hit' },        flag_level:3, weight:5.0, learned_weight:null },
  // TIMING
  { rule_code:'TMG_001', rule_name:'Off-Hours Submission',            rule_category:'pattern',      description:'Submission outside 08:00–20:00 local time — potential anomaly.',                       condition_logic:{ field:'created_hour', operator:'outside', value:[8,20] },  flag_level:2, weight:0.8, learned_weight:null },
  { rule_code:'TMG_002', rule_name:'Future-Dated >5 Banking Days',    rule_category:'compliance',   description:'Effective date >5 banking days ahead — NACHA limits advance effective dating.',        condition_logic:{ field:'days_ahead', operator:'>', value:5 },               flag_level:2, weight:0.9, learned_weight:null },
  { rule_code:'TMG_003', rule_name:'Past Effective Date',             rule_category:'compliance',   description:'Effective date is in the past — entry will be rejected by ACH Operator.',             condition_logic:{ field:'days_ahead', operator:'<', value:0 },               flag_level:3, weight:2.0, learned_weight:null },
  // VELOCITY
  { rule_code:'VEL_001', rule_name:'Daily Volume >5 Entries',         rule_category:'velocity',     description:'Company submitted >5 ACH entries today — velocity monitoring triggered.',              condition_logic:{ field:'company_daily_count', operator:'>', value:5 },      flag_level:2, weight:1.5, learned_weight:null },
  { rule_code:'VEL_002', rule_name:'Duplicate Trace Number',          rule_category:'velocity',     description:'Trace number matches an entry submitted in the past 5 business days.',                condition_logic:{ field:'duplicate_trace', operator:'===', value:true },     flag_level:3, weight:4.0, learned_weight:null },
  // POSITIVE PAY
  { rule_code:'PP_001',  rule_name:'Check Positive Pay Mismatch',     rule_category:'positive_pay', description:'Presented check amount differs from issued check register amount.',                   condition_logic:{ field:'positive_pay_mismatch', operator:'===', value:true },flag_level:3, weight:3.0, learned_weight:null },
  { rule_code:'PP_002',  rule_name:'ACH Debit Block Active',          rule_category:'positive_pay', description:'Account has ACH debit block — this company ID is not on the allow list.',            condition_logic:{ field:'ach_block_active', operator:'===', value:true },    flag_level:3, weight:3.5, learned_weight:null },
  { rule_code:'PP_003',  rule_name:'Stale-Dated Check (>90 days)',    rule_category:'positive_pay', description:'Check issue date is more than 90 days ago — bank may refuse payment.',               condition_logic:{ field:'check_stale', operator:'===', value:true },         flag_level:2, weight:1.5, learned_weight:null },
  // COMPLIANCE
  { rule_code:'CMP_001', rule_name:'AML / BSA Flag',                  rule_category:'compliance',   description:'Transaction characteristics match Anti-Money Laundering pattern (BSA requirement).',  condition_logic:{ field:'aml_flag', operator:'===', value:true },            flag_level:3, weight:3.5, learned_weight:null },
  { rule_code:'CMP_002', rule_name:'Missing Authorization Record',    rule_category:'compliance',   description:'No authorization type recorded — NACHA requires documented authorization for all debits.',condition_logic:{ field:'authorization_type', operator:'===', value:null }, flag_level:2, weight:1.5, learned_weight:null },
  { rule_code:'CMP_003', rule_name:'New Originator Relationship',     rule_category:'compliance',   description:'First ACH entry from this Company ID — require enhanced due diligence.',             condition_logic:{ field:'new_originator', operator:'===', value:true },      flag_level:2, weight:1.0, learned_weight:null },
];

// ── Default threshold config (calibrated weekly by calibrationService.js) ────
const THRESHOLD_CONFIG = [
  { _doc_key:'SCORE_L2_MIN',       key:'SCORE_L2_MIN',       value:40, description:'L1→L2 transition score (calibrated weekly)' },
  { _doc_key:'L2_L3_THRESHOLD',    key:'L2_L3_THRESHOLD',    value:60, description:'L2→L3 transition score (calibrated weekly)' },
  { _doc_key:'SCORE_L3_MIN',       key:'SCORE_L3_MIN',       value:70, description:'L1→L3 direct jump score (calibrated weekly)' },
  { _doc_key:'BOUNDARY_ZONE_PTS',  key:'BOUNDARY_ZONE_PTS',  value: 4, description:'±pts around each level boundary considered a soft zone' },
  { _doc_key:'AUTO_APPROVE_CAP',   key:'AUTO_APPROVE_CAP',   value:30, description:'Maximum score allowed for Level 1 auto-approval' },
];

// ── Per-SEC-code threshold multipliers (loaded by riskEngine.js, updated via admin) ──
// Lower multiplier → lower effective thresholds → stricter treatment for that SEC code
const SEC_CODE_CONFIG = [
  { _doc_key:'IAT', sec_code:'IAT', multiplier:0.78, description:'International ACH — strictest thresholds (OFAC, cross-border)' },
  { _doc_key:'TEL', sec_code:'TEL', multiplier:0.82, description:'Telephone-initiated — high fraud risk' },
  { _doc_key:'WEB', sec_code:'WEB', multiplier:0.88, description:'Internet-initiated — moderate-high risk' },
  { _doc_key:'CTX', sec_code:'CTX', multiplier:0.92, description:'Corporate trade exchange' },
  { _doc_key:'CCD', sec_code:'CCD', multiplier:1.00, description:'Corporate credit/debit — baseline' },
  { _doc_key:'PPD', sec_code:'PPD', multiplier:1.10, description:'Prearranged payment — most lenient (established relationships)' },
];

// ── ACH Return Codes (R01–R85) ──────────────────────────────────────────────
const RETURN_CODES = [
  { code:'R01', title:'Insufficient Funds',                   category:'account',       severity:'low',      retryable:true,  description:'Available balance insufficient to cover the debit entry.' },
  { code:'R02', title:'Account Closed',                       category:'account',       severity:'medium',   retryable:false, description:'Previously active account has been closed.' },
  { code:'R03', title:'No Account / Unable to Locate',        category:'account',       severity:'medium',   retryable:false, description:'Account number does not correspond to a valid account.' },
  { code:'R04', title:'Invalid Account Number',               category:'account',       severity:'medium',   retryable:false, description:'Account number structure is not valid.' },
  { code:'R05', title:'Unauthorized Debit — Consumer Account',category:'fraud',         severity:'high',     retryable:false, description:'Individual does not authorize this ACH debit. 60-day return window.' },
  { code:'R06', title:'Returned per ODFI Request',            category:'administrative',severity:'low',      retryable:true,  description:'ODFI has requested the return of the entry.' },
  { code:'R07', title:'Authorization Revoked',                category:'fraud',         severity:'high',     retryable:false, description:'Consumer revoked authorization previously given. 60-day window.' },
  { code:'R08', title:'Payment Stopped',                      category:'account',       severity:'medium',   retryable:false, description:'Receiver placed stop payment on this entry.' },
  { code:'R09', title:'Uncollected Funds',                    category:'account',       severity:'low',      retryable:true,  description:'Sufficient balance but funds not yet collected.' },
  { code:'R10', title:'Customer Advises Not Authorized',      category:'fraud',         severity:'high',     retryable:false, description:'Receiver advises RDFI that originator not authorized. 60-day window.' },
  { code:'R11', title:'Entry Not in Accordance with Terms',   category:'fraud',         severity:'high',     retryable:false, description:'Entry does not comply with terms of authorization.' },
  { code:'R12', title:'Branch Sold to Another DFI',          category:'administrative',severity:'low',      retryable:true,  description:'Receiving branch has been sold to a different financial institution.' },
  { code:'R13', title:'Invalid ACH Routing Number',           category:'technical',     severity:'high',     retryable:false, description:'Routing number is not a valid ACH participant.' },
  { code:'R14', title:'Representative Payee Deceased',        category:'account',       severity:'medium',   retryable:false, description:'Beneficiary or account holder is deceased.' },
  { code:'R15', title:'Beneficiary or Account Deceased',      category:'account',       severity:'medium',   retryable:false, description:'Individual designated to receive funds is deceased.' },
  { code:'R16', title:'Account Frozen',                       category:'account',       severity:'medium',   retryable:false, description:'Account is frozen due to legal action or bank hold.' },
  { code:'R17', title:'Invalid DFI Account Number',           category:'technical',     severity:'medium',   retryable:false, description:'RDFI cannot process entry because account number is invalid.' },
  { code:'R20', title:'Non-Transaction Account',              category:'account',       severity:'medium',   retryable:false, description:'Entry destined to a non-transaction account.' },
  { code:'R23', title:'Credit Entry Refused by Receiver',     category:'account',       severity:'low',      retryable:false, description:'Receiver returned credit entry.' },
  { code:'R24', title:'Duplicate Entry',                      category:'technical',     severity:'medium',   retryable:false, description:'RDFI received what appears to be a duplicate entry.' },
  { code:'R29', title:'Corporate Advises Not Authorized',     category:'fraud',         severity:'high',     retryable:false, description:'Corporate receiver advises RDFI that originator not authorized.' },
  { code:'R31', title:'Permissible Return — CIE',             category:'administrative',severity:'low',      retryable:false, description:'RDFI may return CIE entry at receiver\'s discretion.' },
  { code:'R61', title:'Misrouted Return',                     category:'technical',     severity:'low',      retryable:true,  description:'Financial institution has misrouted the return.' },
  { code:'R67', title:'Duplicate Return',                     category:'technical',     severity:'low',      retryable:false, description:'ODFI received a duplicate return.' },
  { code:'R69', title:'Field Errors',                         category:'technical',     severity:'medium',   retryable:false, description:'One or more fields in entry or addenda contain invalid data.' },
  { code:'R70', title:'Permissible Return — Non-Consumer',    category:'administrative',severity:'low',      retryable:false, description:'RDFI may return a non-consumer entry.' },
  { code:'R80', title:'IAT Coding Error',                     category:'technical',     severity:'high',     retryable:false, description:'Entry is coded as IAT but does not meet IAT requirements.' },
  { code:'R81', title:'Non-Participant in IAT Program',       category:'compliance',    severity:'high',     retryable:false, description:'Foreign RDFI is not participating in the IAT program.' },
  { code:'R82', title:'Invalid Foreign RDFI Identification',  category:'technical',     severity:'high',     retryable:false, description:'The foreign RDFI identification in the IAT entry is invalid.' },
  { code:'R83', title:'Foreign RDFI Unable to Settle',        category:'technical',     severity:'high',     retryable:false, description:'Foreign RDFI is unable to settle the IAT entry.' },
  { code:'R84', title:'Entry Not Processed by Gateway',       category:'compliance',    severity:'high',     retryable:false, description:'IAT entry was not processed by gateway operator.' },
  { code:'R85', title:'Incorrectly Coded Outbound IAT',       category:'technical',     severity:'high',     retryable:false, description:'IAT entry is incorrectly coded and cannot be processed.' },
];

async function seed() {
  // Risk rules
  const rules = await getTable('risk_rules');
  let seededRules = 0;
  for (const rule of RISK_RULES) {
    if (!rules.find(r => r.rule_code === rule.rule_code)) {
      await insert('risk_rules', { ...rule, is_active: true, trigger_count: 0 });
      seededRules++;
    }
  }
  if (seededRules > 0) console.log(`✅ Seeded ${seededRules} NACHA risk rules`);

  // Return codes
  const rcodes = await getTable('return_codes');
  let seededCodes = 0;
  for (const rc of RETURN_CODES) {
    if (!rcodes.find(r => r.code === rc.code)) {
      await insert('return_codes', rc);
      seededCodes++;
    }
  }
  if (seededCodes > 0) console.log(`✅ Seeded ${seededCodes} ACH return codes`);

  // Threshold config (default values — overwritten by calibrationService weekly)
  const threshRows = await getTable('threshold_config').catch(() => []);
  let seededThresh = 0;
  for (const tc of THRESHOLD_CONFIG) {
    if (!threshRows.find(r => (r._doc_key || r.key) === tc._doc_key)) {
      await insert('threshold_config', { ...tc, calibrated_at: null });
      seededThresh++;
    }
  }
  if (seededThresh > 0) console.log(`✅ Seeded ${seededThresh} threshold config entries`);

  // SEC code multiplier config
  const secRows = await getTable('sec_code_config').catch(() => []);
  let seededSec = 0;
  for (const sc of SEC_CODE_CONFIG) {
    if (!secRows.find(r => (r._doc_key || r.sec_code) === sc._doc_key)) {
      await insert('sec_code_config', sc);
      seededSec++;
    }
  }
  if (seededSec > 0) console.log(`✅ Seeded ${seededSec} SEC code multiplier entries`);
}

module.exports = { seed };
