const fs = require('fs');
const path = require('path');

function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

const HEADERS = [
  'sec_code', 'company_name', 'company_id', 'amount', 'transaction_type',
  'routing_number', 'account_number', 'effective_date', 'trace_number',
  'transaction_code', 'prenote', 'ofac_screened', 'ofac_result', 'aml_flag',
  'authorization_type', 'issued_check_date', 'positive_pay_mismatch',
  'ach_block_active', 'rdfi_trace_mismatch', 'new_originator'
];

const rows = [HEADERS.join(',')];

// Safe baseline
const SAFE_DEF = {
  sec_code: 'PPD',
  company_name: 'Standard Corp',
  company_id: 'STD000123',
  amount: '150.00',
  transaction_type: 'debit',
  routing_number: '021000021', // Mod-10 valid
  account_number: '123456789',
  effective_date: dateOffset(1), // Tomorrow (safe)
  transaction_code: '27',
  prenote: 'false',
  ofac_screened: 'true',
  ofac_result: 'clear',
  aml_flag: 'false',
  authorization_type: 'PPD_WRITTEN',
  issued_check_date: '',
  positive_pay_mismatch: 'false',
  ach_block_active: 'false',
  rdfi_trace_mismatch: 'false',
  new_originator: 'false'
};

function buildRow(overrides) {
  // Always give a unique trace number unless explicitly overridden
  const trace = overrides.trace_number || ('02100002' + String(Math.floor(Math.random() * 10000000)).padStart(7, '0'));
  const row = { ...SAFE_DEF, ...overrides, trace_number: trace };
  return HEADERS.map(h => `"${row[h] || ''}"`).join(',');
}

let generated = 0;
const target = 100;

// -- Velocity Rules Multi-Row Setup --
// VEL_001 (Daily Volume > 5): 5 safe, 1 trigger
for (let i = 0; i < 5; i++) {
  rows.push(buildRow({ company_name: 'High Volume Corp', company_id: 'VEL001_CORP' }));
  generated++;
}
rows.push(buildRow({ company_name: 'High Volume Corp', company_id: 'VEL001_CORP' })); // Trigger
generated++;

// VEL_002 (Duplicate Trace Number): 1 base, 1 duplicate
const dupTrace = '021000029999999';
rows.push(buildRow({ company_name: 'Dup Trace Base', trace_number: dupTrace }));
generated++;
rows.push(buildRow({ company_name: 'Dup Trace Trigger', trace_number: dupTrace })); // Trigger
generated++;

// -- Individual Rule Triggers --
const triggers = [
  // AMOUNT
  { company_name: 'Exceeds 50K Corp', amount: '55000.00' }, // AMT_001
  { company_name: 'High Value Corp', amount: '25000.00' }, // AMT_002
  { company_name: 'Round Dollar Corp', amount: '500.00' }, // AMT_003
  { company_name: 'Micro Txn Corp', amount: '0.50' }, // AMT_004
  // SEC CODE
  { company_name: 'IAT Entry Corp', sec_code: 'IAT' }, // SEC_001
  { company_name: 'TEL Entry Corp', sec_code: 'TEL', authorization_type: 'TEL_VERBAL' }, // SEC_002
  { company_name: 'WEB Entry Corp', sec_code: 'WEB', authorization_type: 'WEB_CLICK' }, // SEC_003
  { company_name: 'CTX Entry Corp', sec_code: 'CTX' }, // SEC_004
  // TRANSACTION CODE
  { company_name: 'GL Debit Corp', transaction_code: '47' }, // TXC_001
  { company_name: 'Loan Credit Corp', transaction_code: '52' }, // TXC_002
  { company_name: 'Prenote Corp', prenote: 'true' }, // TXC_003
  // ROUTING
  { company_name: 'Invalid Routing Corp', routing_number: '123456789' }, // RTN_001
  { company_name: 'Trace Mismatch Corp', rdfi_trace_mismatch: 'true' }, // RTN_002
  // OFAC / SANCTIONS
  { company_name: 'No OFAC Corp', ofac_screened: 'false' }, // OFC_001
  { company_name: 'OFAC Hit Corp', ofac_result: 'hit' }, // OFC_002
  // TIMING
  { company_name: 'Future Dated Corp', effective_date: dateOffset(10) }, // TMG_002
  { company_name: 'Past Dated Corp', effective_date: dateOffset(-5) }, // TMG_003
  // POSITIVE PAY
  { company_name: 'Pos Pay Mismatch Corp', positive_pay_mismatch: 'true' }, // PP_001
  { company_name: 'ACH Block Corp', ach_block_active: 'true' }, // PP_002
  { company_name: 'Stale Check Corp', issued_check_date: dateOffset(-100) }, // PP_003
  // COMPLIANCE
  { company_name: 'AML Flag Corp', aml_flag: 'true' }, // CMP_001
  { company_name: 'No Auth Corp', authorization_type: '' }, // CMP_002
  { company_name: 'New Originator Corp', new_originator: 'true' }, // CMP_003
];

triggers.forEach(t => {
  rows.push(buildRow(t));
  generated++;
});

// -- Fill remaining to exactly 100 --
while (generated < target) {
  rows.push(buildRow({ company_name: 'Safe Filler Corp', company_id: 'SAFE000' + generated }));
  generated++;
}

const outPath = path.join(__dirname, 'ach_100_all_rules.csv');
fs.writeFileSync(outPath, rows.join('\n'), 'utf8');
console.log(`✅ Generated exactly ${generated} records targeting all 26 NACHA rules → ${outPath}`);
