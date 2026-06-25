const fs   = require('fs');
const path = require('path');

const VALID_ROUTING_NUMBERS = [
  '021000021','071000013','122000247','044000037','026009593'
];

const SEC_L1 = [{ code:'PPD', auth:'PPD_WRITTEN', txCodes:['27'] }];
const SEC_L2 = [{ code:'WEB', auth:'WEB_CLICK',   txCodes:['27'] }];
const SEC_L3 = [{ code:'IAT', auth:'PPD_WRITTEN', txCodes:['27'] }];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}
function accountNum() { return String(rand(1000000000, 9999999999)); }

const HEADERS = [
  'sec_code','transaction_code','company_name','company_id','amount',
  'transaction_type','routing_number','account_number','account_type',
  'effective_date','entry_description','individual_name','individual_id_number',
  'authorization_type','trace_number','prenote','odfi_routing',
  'addenda_indicator','check_serial_number',
  'ofac_screened','aml_flag'
];

function buildRow(tier, index, isDemoPattern = false) {
  let sec, amount, company, ofacScreened, amlFlag, desc;

  if (isDemoPattern) {
    // Exact pattern for demo: WEB, Debit, $6000 (Medium bucket), Checking
    sec = { code:'WEB', auth:'WEB_CLICK', txCodes:['27'] };
    amount = '6000.00';
    company = { name: 'Pattern Demo Corp', id: 'DEMOPAT001' };
    ofacScreened = 'true';
    amlFlag = 'false';
    desc = 'SUBSCRIP';
  } else if (tier === 'L1') {
    sec = pick(SEC_L1);
    amount = (rand(100, 9999) + 0.99).toFixed(2);
    company = { name: 'Normal L1 Corp', id: 'L1CORP0001' };
    ofacScreened = 'true';
    amlFlag = 'false';
    desc = 'PAYROLL';
  } else if (tier === 'L2') {
    sec = pick(SEC_L2);
    amount = (rand(15000, 45000) + 0.50).toFixed(2);
    company = { name: 'Medium L2 Corp', id: 'L2CORP0001' };
    ofacScreened = 'true';
    amlFlag = 'false';
    desc = 'VENDOR';
  } else {
    // L3: high risk, > 50k
    sec = pick(SEC_L1);
    amount = (rand(55000, 99000) + 0.25).toFixed(2);
    company = { name: 'High Risk L3 Corp', id: 'L3CORP0001' };
    ofacScreened = 'false';
    amlFlag = 'true';
    desc = 'TRANSFER';
  }

  const individual = 'Demo User';
  const routing    = pick(VALID_ROUTING_NUMBERS);
  const txCode     = sec.txCodes[0];
  const txType     = 'debit';
  const acctType   = 'checking';
  const effDate    = dateOffset(rand(1, 4));
  const traceNum   = `${routing.slice(0, 8)}${String(index + 1).padStart(7, '0')}`;
  const indivId    = `ID${String(rand(100000, 999999))}`;
  
  return [
    sec.code, txCode, `"${company.name}"`, company.id, amount,
    txType, routing, accountNum(), acctType, effDate,
    `"${desc}"`, `"${individual}"`, indivId, sec.auth || '',
    traceNum, 'false', pick(VALID_ROUTING_NUMBERS), '0', '',
    ofacScreened, amlFlag
  ];
}

const rowsMain = [HEADERS.join(',')];
let globalIndex = 0;

// 1. Generate 10 Demo Pattern records (we will use 6 in main, 4 in auto-approve CSV)
for (let i = 0; i < 6; i++) rowsMain.push(buildRow('L2', globalIndex++, true).join(','));

// 2. Mix of L1, L2, L3
for (let i = 0; i < 22; i++) rowsMain.push(buildRow('L1', globalIndex++).join(','));
for (let i = 0; i < 21; i++) rowsMain.push(buildRow('L2', globalIndex++).join(','));
for (let i = 0; i < 21; i++) rowsMain.push(buildRow('L3', globalIndex++).join(','));

const rowsAutoApprove = [HEADERS.join(',')];
for (let i = 0; i < 4; i++) rowsAutoApprove.push(buildRow('L2', globalIndex++, true).join(','));

fs.writeFileSync(path.join(__dirname, 'ach_demo_main_70.csv'), rowsMain.join('\n'), 'utf8');
fs.writeFileSync(path.join(__dirname, 'ach_demo_auto_approve.csv'), rowsAutoApprove.join('\n'), 'utf8');

console.log('✅ Generated ach_demo_main_70.csv with 70 records.');
console.log('✅ Generated ach_demo_auto_approve.csv with 4 identical pattern records for Phase 2 of demo.');
