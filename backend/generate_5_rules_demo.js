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
  'aml_flag', 'issued_check_date'
];

const rows = [HEADERS.join(',')];

// Helper to build a generic safe row with overrides
function buildRow(overrides) {
  const def = {
    sec_code: 'PPD',
    company_name: 'Safe Corp',
    company_id: 'SAFE000123',
    amount: '150.00',
    transaction_type: 'debit',
    routing_number: '021000021',
    account_number: '123456789',
    effective_date: dateOffset(1),
    trace_number: '02100002' + String(Math.floor(Math.random() * 10000000)).padStart(7, '0'),
    aml_flag: 'false',
    issued_check_date: ''
  };
  const row = { ...def, ...overrides };
  return HEADERS.map(h => `"${row[h] || ''}"`).join(',');
}

// 1. VEL_001 (Daily Volume > 5)
// Add 5 safe records for HIGHVOL_CORP
for (let i = 0; i < 5; i++) {
  rows.push(buildRow({ company_name: 'High Volume Corp', company_id: 'HIGHVOL001' }));
}
// Add 6th record for HIGHVOL_CORP to trigger VEL_001
rows.push(buildRow({ company_name: 'High Volume Corp', company_id: 'HIGHVOL001' }));

// 2. TMG_002 (Future-Dated > 5 Banking Days)
// Trigger: effective_date > 5 days from now (set to +10 days)
rows.push(buildRow({
  company_name: 'Future Date Corp', 
  company_id: 'FUTURE0001',
  effective_date: dateOffset(10)
}));

// 3. VEL_002 (Duplicate Trace Number)
// Add Base record
const dupTrace = '021000029999999';
rows.push(buildRow({ company_name: 'Base Trace Corp', trace_number: dupTrace }));
// Add Duplicate record
rows.push(buildRow({ company_name: 'Duplicate Trace Corp', trace_number: dupTrace }));

// 4. CMP_001 (AML / BSA Flag)
// Trigger: aml_flag = true
rows.push(buildRow({
  company_name: 'AML Flagged Corp',
  company_id: 'AML0000123',
  aml_flag: 'true'
}));

// 5. PP_003 (Stale-Dated Check > 90 days)
// Trigger: issued_check_date > 90 days ago (set to 100 days ago)
rows.push(buildRow({
  company_name: 'Stale Check Corp',
  company_id: 'STALE00123',
  issued_check_date: dateOffset(-100)
}));

const outPath = path.join(__dirname, 'ach_5_rules_demo.csv');
fs.writeFileSync(outPath, rows.join('\n'), 'utf8');
console.log(`✅ Generated ${rows.length - 1} records → ${outPath}`);
