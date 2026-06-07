// generate_transactions.js — Generates 200-record ACH CSV with mixed L1/L2/L3 risk categories
// Risk level logic (from riskEngine.js):
//   L1: riskScore < 30  AND  maxFlagLevel < 2  (no L2/L3 rules triggered)
//   L2: riskScore 30–69 OR maxFlagLevel == 2   (but no L3 rules)
//   L3: riskScore >= 70 OR maxFlagLevel == 3
//
// Key L3 rules that MUST be avoided for L1/L2:
//   OFC_001 — ofac_screened === false       → flag_level 3, weight 3.0
//   SEC_001 — sec_code === 'IAT'            → flag_level 3, weight 2.5
//   AMT_001 — amount > 50000               → flag_level 3, weight 2.5
//   RTN_001 — invalid routing (mod-10 fail) → flag_level 3, weight 3.5
//   CMP_001 — aml_flag === true            → flag_level 3, weight 3.5
//   TMG_003 — past effective date           → flag_level 3, weight 2.0
//
// L2 triggers (OK for L2, must avoid for L1):
//   AMT_002 — amount between $10K–$50K     → flag_level 2, weight 1.5
//   AMT_003 — round dollar amount          → flag_level 2, weight 1.0
//   SEC_002 — sec_code === 'TEL'           → flag_level 2, weight 1.2
//   SEC_003 — sec_code === 'WEB'           → flag_level 2, weight 1.0
//   SEC_004 — sec_code === 'CTX'           → flag_level 2, weight 0.8
//   CMP_002 — authorization_type === null  → flag_level 2, weight 1.5

const fs   = require('fs');
const path = require('path');

// ── Valid ABA routing numbers (all pass Mod-10 checksum) ─────────────────────
const VALID_ROUTING_NUMBERS = [
  '021000021','071000013','122000247','044000037','026009593',
  '021200025','022000020','031000053','111000038','231372691',
  '021300077','042000013','063100277','091000022','325272021',
  '031100157','096017418','124303120','084003997','101000187',
];

// ── SEC codes by risk tier ────────────────────────────────────────────────────
// L1-safe: PPD, CCD, ARC, BOC, POP, CIE, MTE, POS, RCK (no inherent L2/L3 sec flag)
// L2-only: TEL (L2), WEB (L2), CTX (L2)
// L3-only: IAT (L3)

const SEC_L1 = [
  { code:'PPD', auth:'PPD_WRITTEN', txCodes:['22','27'] },
  { code:'CCD', auth:'CCD_SIGNED',  txCodes:['22','27'] },
  { code:'ARC', auth:null,          txCodes:['27'],      checkSerial:true },
  { code:'BOC', auth:null,          txCodes:['27'],      checkSerial:true },
  { code:'POP', auth:null,          txCodes:['27'],      checkSerial:true },
  { code:'CIE', auth:'WEB_CLICK',   txCodes:['22'] },
  { code:'MTE', auth:null,          txCodes:['22','27'] },
  { code:'POS', auth:'WEB_CLICK',   txCodes:['27'] },
  { code:'RCK', auth:null,          txCodes:['27'],      checkSerial:true },
];

const SEC_L2 = [
  { code:'TEL', auth:'TEL_VERBAL',  txCodes:['27','22'] },
  { code:'WEB', auth:'WEB_CLICK',   txCodes:['22','27'] },
  { code:'CTX', auth:'CCD_SIGNED',  txCodes:['22','27'] },
];

const SEC_L3 = [
  { code:'IAT', auth:'PPD_WRITTEN', txCodes:['22','27'] },
];

// ── Amount pools by risk tier ─────────────────────────────────────────────────
// L1: < $10K, not round-100-dollar multiples (avoid AMT_002 and AMT_003)
const AMOUNTS_L1 = [
  125.50, 299.99, 450.75, 89.99, 675.25, 1099.00, 1800.50, 3499.99,
  7250.00, 4500.00, 2750.00, 1350.00, 550.00, 875.25, 3299.99, 5750.50,
  6850.75, 9250.25, 2199.99, 8750.50,
];

// L2: $10K–$50K range (triggers AMT_002), or moderate amounts with TEL/WEB/CTX
const AMOUNTS_L2_HIGH = [
  10000.00, 12000.00, 15000.00, 18000.00, 20000.00,
  22000.00, 25000.00, 28000.00, 35000.00, 45000.00,
];
const AMOUNTS_L2_MID = [
  3000.00, 4000.00, 5000.00, 7500.00, 8500.00,
  9000.00, 2000.00, 6500.00, 1500.00, 4200.00,
];

// L3: > $50K or very high round amounts
const AMOUNTS_L3 = [
  50001.00, 75000.00, 100000.00, 150000.00, 200000.00,
  99999.00, 60000.00, 85000.00, 120000.00, 250000.00,
];

// ── Companies ─────────────────────────────────────────────────────────────────
const COMPANIES = [
  { name:'Acme Payroll Corp',      id:'ACMECORP01' },
  { name:'GlobalTech LLC',         id:'GTECH2024X' },
  { name:'QuickShop Online',       id:'QSHOP09870' },
  { name:'National Energy Co',     id:'NATENG0001' },
  { name:'TechStartup Inc',        id:'TECHST0099' },
  { name:'Metro City Bank',        id:'METRO000BC' },
  { name:'HealthPlus Insurance',   id:'HLTHPLUS01' },
  { name:'Amazon Marketplace',     id:'AMZNMKT001' },
  { name:'State Tax Authority',    id:'STATETAX01' },
  { name:'Premium Mortgage LLC',   id:'PREMTG0001' },
  { name:'AutoLoan Financial',     id:'AUTOLOAN01' },
  { name:'SolarPower Systems',     id:'SLRPWR0001' },
  { name:'Apex Manufacturing',     id:'APEXMFG001' },
  { name:'CloudServices Pro',      id:'CLDSVCS001' },
  { name:'RetailChain Inc',        id:'RTLCHN0001' },
  { name:'First National Credit',  id:'FRSTCRD001' },
  { name:'PayDay Advance Co',      id:'PAYDAY0001' },
  { name:'University Bursar',      id:'UNIVBRS001' },
  { name:'Medical Group Partners', id:'MEDGRP0001' },
  { name:'CrossBorder Transfers',  id:'XBRDRTRF01' },
  { name:'Atlantic Trading Co',    id:'ATLNTRD001' },
  { name:'Suburban Landlord LLC',  id:'RNTPROP001' },
  { name:'Food Delivery Rapid',    id:'FOODDLV001' },
  { name:'Charitable Foundation',  id:'CHARITY001' },
  { name:'Government Benefits',    id:'GOVTBEN001' },
];

const INDIVIDUALS = [
  'Jane Smith','Robert Chen','Mary Johnson','Ahmed Hassan','Sarah Williams',
  'David Lee','Emma Brown','Carlos Rodriguez','Priya Patel','James Wilson',
  'Lisa Anderson','Michael Taylor','Fatima Al-Farsi','Kevin Martinez','Nancy Kim',
  'Christopher Davis','Olga Petrov','Marcus Thompson','Yuki Tanaka','Alexandra Ross',
  'Benjamin Clark','Mei-Ling Wu','George Harris','Isabel Santos','Patrick Murphy',
  'Samantha Brooks','Raj Sharma','Diane Foster','Omar Abdullah','Claire Dubois',
];

const DESCRIPTIONS = [
  'PAYROLL','VENDORPMT','PURCHASE','UTILITY','MORTGAGE','AUTOLOAN','TAXPMNT',
  'INSURNCE','TRANSFER','SALARY','REFUND','SUBSCRIP','DONATION','TUITION',
  'RENTPMT','DIVIDEND','INTEREST','MEDICAL','GOVTBNFT','INVOICEP',
];

const ACCOUNT_TYPES = ['checking', 'savings', 'checking', 'checking', 'savings'];

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
  'ofac_screened','aml_flag',   // ← NEW: explicit risk control columns
];

const rows = [HEADERS.join(',')];

// ── Distribution: 67 L1, 67 L2, 66 L3 (≈ even split of 200 total) ────────────
const TIER_COUNTS = { L1: 67, L2: 67, L3: 66 };

function buildRow(tier, index) {
  let sec, amount, ofacScreened, amlFlag;

  if (tier === 'L1') {
    // L1: Safe SEC code, low amount (<$10K, non-round), ofac_screened=true, aml_flag=false
    sec          = pick(SEC_L1);
    amount       = pick(AMOUNTS_L1).toFixed(2);
    ofacScreened = 'true';
    amlFlag      = 'false';
  } else if (tier === 'L2') {
    // L2: TEL/WEB/CTX (L2 sec flag) OR high amount ($10K–$50K), ofac_screened=true, aml_flag=false
    // Mix: 50% use L2 sec codes + mid amount, 50% use L1 sec code + high amount
    if (Math.random() < 0.5) {
      sec    = pick(SEC_L2);
      amount = pick(AMOUNTS_L2_MID).toFixed(2);
    } else {
      sec    = pick(SEC_L1);
      amount = pick(AMOUNTS_L2_HIGH).toFixed(2);
    }
    ofacScreened = 'true';
    amlFlag      = 'false';
  } else {
    // L3: IAT code OR amount > $50K OR ofac_screened=false OR aml_flag=true
    const subtype = index % 3;
    if (subtype === 0) {
      sec          = pick(SEC_L3);        // IAT → always L3
      amount       = pick(AMOUNTS_L1).toFixed(2);
      ofacScreened = 'false';
      amlFlag      = 'false';
    } else if (subtype === 1) {
      sec          = pick(SEC_L1);
      amount       = pick(AMOUNTS_L3).toFixed(2); // > $50K → L3
      ofacScreened = 'true';
      amlFlag      = 'false';
    } else {
      sec          = pick(SEC_L2);
      amount       = pick(AMOUNTS_L2_MID).toFixed(2);
      ofacScreened = 'false';             // OFAC not screened → L3
      amlFlag      = Math.random() < 0.4 ? 'true' : 'false';
    }
  }

  const company    = pick(COMPANIES);
  const individual = pick(INDIVIDUALS);
  const routing    = pick(VALID_ROUTING_NUMBERS);
  const txCode     = pick(sec.txCodes);
  const isCrdit    = txCode === '22' || txCode === '32';
  const txType     = isCrdit ? 'credit' : 'debit';
  const acctType   = pick(ACCOUNT_TYPES);
  // Effective date: 1–4 days ahead (safe, within NACHA 5-day window)
  const effDate    = dateOffset(rand(1, 4));
  const desc       = pick(DESCRIPTIONS).padEnd(10).slice(0, 10);
  const traceNum   = `${routing.slice(0, 8)}${String(index + 1).padStart(7, '0')}`;
  const odfi       = pick(VALID_ROUTING_NUMBERS);
  const indivId    = `ID${String(rand(100000, 999999))}`;
  const prenote    = 'false'; // No prenotes to keep scoring clean
  const checkSerial = sec.checkSerial ? String(rand(1000, 9999)) : '';
  const auth        = sec.auth || '';

  return [
    sec.code,
    txCode,
    `"${company.name}"`,
    company.id,
    amount,
    txType,
    routing,
    accountNum(),
    acctType,
    effDate,
    `"${desc.trim()}"`,
    `"${individual}"`,
    indivId,
    auth,
    traceNum,
    prenote,
    odfi,
    '0',
    checkSerial,
    ofacScreened,
    amlFlag,
  ];
}

// ── Generate rows in shuffled tier order ──────────────────────────────────────
const tierList = [];
Object.entries(TIER_COUNTS).forEach(([tier, count]) => {
  for (let i = 0; i < count; i++) tierList.push(tier);
});
// Shuffle
tierList.sort(() => Math.random() - 0.5);

tierList.forEach((tier, index) => {
  rows.push(buildRow(tier, index).join(','));
});

// ── Write file ────────────────────────────────────────────────────────────────
const outPath = path.join(__dirname, 'ach_transactions_200.csv');
fs.writeFileSync(outPath, rows.join('\n'), 'utf8');
console.log(`✅ Generated ${rows.length - 1} records → ${outPath}`);
console.log('\nRisk tier distribution:');
const tierTally = { L1: 0, L2: 0, L3: 0 };
tierList.forEach(t => tierTally[t]++);
Object.entries(tierTally).forEach(([k, v]) =>
  console.log(`  ${k} : ${v} records (${Math.round(v / 2)}%)`)
);
