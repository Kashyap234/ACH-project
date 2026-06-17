const fs   = require('fs');
const path = require('path');

// ── Valid ABA routing numbers (all pass Mod-10 checksum) ─────────────────────
const VALID_ROUTING_NUMBERS = [
  '021000021','071000013','122000247','044000037','026009593',
  '021200025','022000020','031000053','111000038','231372691',
];

// ── SEC codes by risk tier ────────────────────────────────────────────────────
const SEC_L1 = [
  { code:'PPD', auth:'PPD_WRITTEN', txCodes:['22','27'] },
  { code:'CCD', auth:'CCD_SIGNED',  txCodes:['22','27'] },
];

const SEC_L2 = [
  { code:'TEL', auth:'TEL_VERBAL',  txCodes:['27','22'] },
  { code:'WEB', auth:'WEB_CLICK',   txCodes:['22','27'] },
];

const SEC_L3 = [
  { code:'IAT', auth:'PPD_WRITTEN', txCodes:['22','27'] },
];

// ── Amount pools by risk tier ─────────────────────────────────────────────────
const AMOUNTS_L1 = [ 125.50, 299.99, 450.75, 89.99, 675.25 ];
const AMOUNTS_L2_MID = [ 3000.00, 4000.00, 5000.00, 7500.00, 8500.00 ];
const AMOUNTS_L3 = [ 75000.00, 100000.00, 150000.00, 200000.00 ];

// ── Companies ─────────────────────────────────────────────────────────────────
const COMPANIES = [
  { name:'Acme Payroll Corp',      id:'ACMECORP01' },
  { name:'GlobalTech LLC',         id:'GTECH2024X' },
  { name:'QuickShop Online',       id:'QSHOP09870' },
  { name:'National Energy Co',     id:'NATENG0001' },
];

const INDIVIDUALS = ['Jane Smith','Robert Chen','Mary Johnson','Ahmed Hassan'];
const DESCRIPTIONS = ['PAYROLL','VENDORPMT','PURCHASE','UTILITY'];
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
const TIER_COUNTS = { L1: 30, L2: 30, L3: 30 }; // Total 90 random + 10 Demo = 100

function buildRow(tier, index) {
  let sec, amount, ofacScreened, amlFlag, company;

  if (tier === 'DEMO_PATTERN') {
    // Exact identical pattern for Pattern Promotion demo!
    // Triggers L2 because WEB code and amount is 3500.
    sec = { code:'WEB', auth:'WEB_CLICK', txCodes:['22'] };
    amount = 3500.00;
    ofacScreened = 'true';
    amlFlag = 'false';
    company = { name:'Demo Pattern Corp', id:'DEMO1234' };
  } else if (tier === 'L1') {
    sec = pick(SEC_L1);
    amount = pick(AMOUNTS_L1).toFixed(2);
    ofacScreened = 'true';
    amlFlag = 'false';
    company = pick(COMPANIES);
  } else if (tier === 'L2') {
    sec = pick(SEC_L2);
    amount = pick(AMOUNTS_L2_MID).toFixed(2);
    ofacScreened = 'true';
    amlFlag = 'false';
    company = pick(COMPANIES);
  } else {
    sec = pick(SEC_L3);
    amount = pick(AMOUNTS_L1).toFixed(2);
    ofacScreened = 'false';
    amlFlag = 'true';
    company = pick(COMPANIES);
  }

  const individual = pick(INDIVIDUALS);
  const routing    = pick(VALID_ROUTING_NUMBERS);
  const txCode     = pick(sec.txCodes);
  const isCrdit    = txCode === '22' || txCode === '32';
  const txType     = isCrdit ? 'credit' : 'debit';
  const acctType   = pick(ACCOUNT_TYPES);
  const effDate    = dateOffset(rand(1, 4));
  const desc       = pick(DESCRIPTIONS).padEnd(10).slice(0, 10);
  const traceNum   = `${routing.slice(0, 8)}${String(index + 1).padStart(7, '0')}`;
  const odfi       = pick(VALID_ROUTING_NUMBERS);
  const indivId    = `ID${String(rand(100000, 999999))}`;
  const prenote    = 'false';
  const checkSerial = sec.checkSerial ? String(rand(1000, 9999)) : '';
  const auth        = sec.auth || '';

  return [
    sec.code, txCode, `"${company.name}"`, company.id, amount,
    txType, routing, accountNum(), acctType, effDate, `"${desc.trim()}"`,
    `"${individual}"`, indivId, auth, traceNum, prenote, odfi, '0',
    checkSerial, ofacScreened, amlFlag
  ].join(',');
}

const tierList = [];
Object.entries(TIER_COUNTS).forEach(([tier, count]) => {
  for (let i = 0; i < count; i++) tierList.push(tier);
});

// Add 10 identical Demo Pattern transactions
for(let i = 0; i < 10; i++) {
  tierList.push('DEMO_PATTERN');
}

// Shuffle
tierList.sort(() => Math.random() - 0.5);

tierList.forEach((tier, index) => {
  rows.push(buildRow(tier, index));
});

const outPath = path.join(__dirname, 'ach_demo_100.csv');
fs.writeFileSync(outPath, rows.join('\n'), 'utf8');
console.log(`✅ Generated ${rows.length - 1} demo records → ${outPath}`);
