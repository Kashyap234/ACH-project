// generate_demo_dataset.js — Generates 70-record ACH CSV designed explicitly for AI demos
// Includes specific clusters to demonstrate:
// - Pattern Promotion (L2 -> L1)
// - Increase AI Confidence
// - Decrease AI Confidence (Pattern Demotion)

const fs   = require('fs');
const path = require('path');

// ── Valid ABA routing numbers ────────────────────────────────────────────────
const VALID_ROUTING_NUMBERS = [
  '021000021','071000013','122000247','044000037','026009593',
  '021200025','022000020','031000053','111000038','231372691'
];

const INDIVIDUALS = [
  'Jane Smith','Robert Chen','Mary Johnson','Ahmed Hassan','Sarah Williams',
  'David Lee','Emma Brown','Carlos Rodriguez','Priya Patel','James Wilson'
];

const DESCRIPTIONS = ['PAYROLL','VENDORPMT','PURCHASE','UTILITY','SALARY'];
const ACCOUNT_TYPES = ['checking', 'savings'];

// ── Helpers ───────────────────────────────────────────────────────────────────
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}
function accountNum() { return String(rand(1000000000, 9999999999)); }

// ── CSV Headers ───────────────────────────────────────────────────────────────
const HEADERS = [
  'sec_code','transaction_code','company_name','company_id','amount',
  'transaction_type','routing_number','account_number','account_type',
  'effective_date','entry_description','individual_name','individual_id_number',
  'authorization_type','trace_number','prenote','odfi_routing',
  'addenda_indicator','check_serial_number',
  'ofac_screened','aml_flag'
];

const rows = [HEADERS.join(',')];
let globalIndex = 0;

function generateRow(params) {
  const routing = params.routing || pick(VALID_ROUTING_NUMBERS);
  const txCode = params.txCode || '27';
  const isCrdit = txCode === '22' || txCode === '32';
  const txType = params.txType || (isCrdit ? 'credit' : 'debit');
  const traceNum = `${routing.slice(0, 8)}${String(++globalIndex).padStart(7, '0')}`;
  
  return [
    params.sec_code,
    txCode,
    `"${params.company_name}"`,
    params.company_id,
    params.amount.toFixed(2),
    txType,
    routing,
    params.accountNum || accountNum(),
    params.accountType || pick(ACCOUNT_TYPES),
    params.effective_date || dateOffset(rand(1, 4)),
    `"${(params.desc || pick(DESCRIPTIONS)).trim().slice(0, 10)}"`,
    `"${params.individual_name || pick(INDIVIDUALS)}"`,
    params.individual_id_number || `ID${String(rand(100000, 999999))}`,
    params.auth || '',
    traceNum,
    params.prenote || 'false',
    params.odfi || pick(VALID_ROUTING_NUMBERS),
    '0',
    params.checkSerial || '',
    params.ofacScreened || 'true',
    params.amlFlag || 'false'
  ].join(',');
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. DEMO PATTERN: ACME WEB CORP (L2) 
// Purpose: Demonstrate Pattern Promotion and Increase AI Confidence
// We generate 10 identical pattern transactions.
// User will approve the first 5 to promote. The 6th will be kept pending to decline later.
// ──────────────────────────────────────────────────────────────────────────────
for(let i=0; i<10; i++) {
  rows.push(generateRow({
    sec_code: 'WEB', // L2 inherently
    company_name: 'Acme Web Corp',
    company_id: 'ACMEWEB001',
    amount: 12500.00, // $10k-50k range = L2
    txCode: '27',
    accountType: 'checking',
    auth: 'WEB_CLICK',
    ofacScreened: 'true',
    amlFlag: 'false',
    desc: 'SUBSCRIP'
  }));
}

// ──────────────────────────────────────────────────────────────────────────────
// 2. DEMO PATTERN: DEMO HIGH RISK INC (L3)
// Purpose: Demonstrate standard L3 review and Decrease AI Confidence immediately
// ──────────────────────────────────────────────────────────────────────────────
for(let i=0; i<10; i++) {
  rows.push(generateRow({
    sec_code: 'IAT', // L3 inherently
    company_name: 'Demo High Risk Inc',
    company_id: 'HIGHRISK01',
    amount: 65000.00, // >$50k = L3
    txCode: '27',
    accountType: 'checking',
    auth: 'PPD_WRITTEN',
    ofacScreened: 'false', // Unscreened OFAC = L3
    amlFlag: 'true', // AML Flag = L3
    desc: 'TRANSFER'
  }));
}

// ──────────────────────────────────────────────────────────────────────────────
// 3. FILLER TRANSACTIONS (50 Random L1, L2, L3)
// ──────────────────────────────────────────────────────────────────────────────
const RANDOM_COMPANIES = [
  { name:'Local Bakery LLC', id:'BAKERY001' },
  { name:'Metro City Bank', id:'METRO000BC' },
  { name:'HealthPlus Insurance', id:'HLTHPLUS01' }
];

for(let i=0; i<50; i++) {
  const r = Math.random();
  const company = pick(RANDOM_COMPANIES);
  
  if (r < 0.5) {
    // 50% L1 (Safe, low amounts)
    rows.push(generateRow({
      sec_code: pick(['PPD', 'CCD']),
      company_name: company.name,
      company_id: company.id,
      amount: pick([125.50, 450.75, 89.99, 1099.00]),
      ofacScreened: 'true',
      amlFlag: 'false'
    }));
  } else if (r < 0.8) {
    // 30% L2 (TEL/WEB or amounts $10k-$50k)
    rows.push(generateRow({
      sec_code: pick(['TEL', 'WEB']),
      company_name: company.name,
      company_id: company.id,
      amount: pick([3000.00, 15000.00, 22000.00]),
      ofacScreened: 'true',
      amlFlag: 'false'
    }));
  } else {
    // 20% L3 (IAT, or huge amount, or flags)
    rows.push(generateRow({
      sec_code: 'IAT',
      company_name: company.name,
      company_id: company.id,
      amount: pick([75000.00, 100000.00]),
      ofacScreened: 'false',
      amlFlag: 'true'
    }));
  }
}

// ── Write file ────────────────────────────────────────────────────────────────
const outPath = path.join(__dirname, 'ach_transactions_demo_70.csv');
fs.writeFileSync(outPath, rows.join('\n'), 'utf8');
console.log(`✅ Generated ${rows.length - 1} demo records -> ${outPath}`);
