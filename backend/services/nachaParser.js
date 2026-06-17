// backend/services/nachaParser.js — Parse NACHA fixed-width ACH files
// Standard NACHA record layout: 94 chars per line

const { v4: uuidv4 } = require('uuid');

const TRANSACTION_CODES = {
  '22': { account_type: 'checking', transaction_type: 'credit',  description: 'Automated Deposit — Checking' },
  '23': { account_type: 'checking', transaction_type: 'credit',  description: 'Pre-Note — Checking Credit',   prenote: true },
  '27': { account_type: 'checking', transaction_type: 'debit',   description: 'Automated Payment — Checking' },
  '28': { account_type: 'checking', transaction_type: 'debit',   description: 'Pre-Note — Checking Debit',    prenote: true },
  '32': { account_type: 'savings',  transaction_type: 'credit',  description: 'Automated Deposit — Savings' },
  '33': { account_type: 'savings',  transaction_type: 'credit',  description: 'Pre-Note — Savings Credit',    prenote: true },
  '37': { account_type: 'savings',  transaction_type: 'debit',   description: 'Automated Payment — Savings' },
  '38': { account_type: 'savings',  transaction_type: 'debit',   description: 'Pre-Note — Savings Debit',     prenote: true },
  '42': { account_type: 'gl',       transaction_type: 'credit',  description: 'GL Account Credit' },
  '47': { account_type: 'gl',       transaction_type: 'debit',   description: 'GL Account Debit' },
  '52': { account_type: 'loan',     transaction_type: 'credit',  description: 'Loan Account Credit' },
  '55': { account_type: 'loan',     transaction_type: 'debit',   description: 'Loan Account Debit' },
};

// ── Parse raw NACHA file text → array of transactions ───────────────────────
function parseNachaFile(fileText) {
  const lines = fileText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim().length > 0);
  const transactions = [];
  const errors = [];
  const warnings = [];

  let fileHeader = null, batchHeader = null;
  let lastEntry = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].padEnd(94, ' ');
    const type = line[0];

    try {
      switch (type) {
        case '1': // File Header
          fileHeader = {
            immediate_destination:  line.slice(3, 13).trim(),
            immediate_origin:       line.slice(13, 23).trim(),
            file_creation_date:     formatNachaDate(line.slice(23, 29)),
            file_creation_time:     line.slice(29, 33).trim(),
            file_id_modifier:       line.slice(33, 34).trim(),
          };
          break;

        case '5': // Batch Header
          batchHeader = {
            service_class_code:        line.slice(1, 4).trim(),
            company_name:              line.slice(4, 20).trim(),
            company_discretionary_data:line.slice(20, 40).trim(),
            company_id:                line.slice(40, 50).trim(),
            sec_code:                  line.slice(50, 53).trim(),
            company_entry_description: line.slice(53, 63).trim(),
            company_descriptive_date:  line.slice(63, 69).trim(),
            effective_entry_date:      formatNachaDate(line.slice(69, 75)),
            originator_status_code:    line.slice(78, 79).trim(),
            odfi_routing:              line.slice(79, 87).trim(),
            batch_number:              line.slice(87, 94).trim(),
          };
          break;

        case '6': // Entry Detail
          const txCode = line.slice(1, 3).trim();
          const txMeta = TRANSACTION_CODES[txCode] || { account_type: 'checking', transaction_type: 'debit' };
          const rdfi   = line.slice(3, 11).trim();
          const checkD = line.slice(11, 12).trim();
          const rawAmt = parseInt(line.slice(29, 39).trim() || '0', 10);

          lastEntry = {
            transaction_id:        `TXN-${uuidv4().slice(0, 8).toUpperCase()}`,

            // Batch/file context
            ...(fileHeader  || {}),
            ...(batchHeader || {}),

            // Entry fields
            transaction_code:      txCode,
            account_type:          txMeta.account_type,
            transaction_type:      txMeta.transaction_type,
            prenote:               txMeta.prenote || false,
            rdfi_routing:          rdfi + checkD,
            routing_number:        rdfi + checkD,
            check_digit:           checkD,
            dfi_account_number:    line.slice(12, 29).trim(),
            account_number:        line.slice(12, 29).trim(),
            amount:                rawAmt / 100,
            individual_id_number:  line.slice(39, 54).trim(),
            individual_name:       line.slice(54, 76).trim(),
            discretionary_data:    line.slice(76, 78).trim(),
            addenda_record_indicator: line.slice(78, 79).trim(),
            trace_number:          line.slice(79, 94).trim(),
            entry_description:     batchHeader?.company_entry_description || '',

            // Derived
            effective_date:        batchHeader?.effective_entry_date || new Date().toISOString().split('T')[0],
            // Ensure company_name is always set (fallback chain)
            company_name:          (batchHeader?.company_name || '').trim() || line.slice(54, 76).trim() || 'Unknown',
            originator:            'NACHA_FILE_IMPORT',
            is_positive_pay:       false,
            ofac_screened:         false,
            ofac_result:           'pending',
            aml_flag:              false,
          };

          // Validate routing
          if (!/^\d{9}$/.test(lastEntry.routing_number)) {
            warnings.push({ line: i + 1, trace: lastEntry.trace_number, msg: `Invalid routing number: ${lastEntry.routing_number}` });
          }

          transactions.push(lastEntry);
          break;

        case '7': // Addenda
          if (lastEntry) {
            lastEntry.addenda_type_code      = line.slice(1, 3).trim();
            lastEntry.payment_related_info   = line.slice(3, 83).trim();
            lastEntry.addenda_sequence_number= line.slice(83, 87).trim();
            lastEntry.has_addenda            = true;
          }
          break;

        case '8': // Batch Control — validate
          if (batchHeader) {
            const batchEntryCount  = parseInt(line.slice(4, 10).trim() || '0', 10);
            const declaredDebit    = parseInt(line.slice(20, 32).trim() || '0', 10) / 100;
            const declaredCredit   = parseInt(line.slice(32, 44).trim() || '0', 10) / 100;
            const batchTxns        = transactions.filter(t => t.batch_number === batchHeader.batch_number);
            const actualDebit      = batchTxns.filter(t => t.transaction_type === 'debit').reduce((a, t) => a + t.amount, 0);
            const actualCredit     = batchTxns.filter(t => t.transaction_type === 'credit').reduce((a, t) => a + t.amount, 0);
            if (Math.abs(declaredDebit - actualDebit) > 0.01) {
              warnings.push({ line: i+1, msg: `Batch ${batchHeader.batch_number}: Debit total mismatch. Expected $${declaredDebit.toFixed(2)}, got $${actualDebit.toFixed(2)}` });
            }
          }
          batchHeader = null; lastEntry = null;
          break;

        case '9': break; // File Control — skip
      }
    } catch (e) {
      errors.push({ line: i + 1, msg: `Parse error: ${e.message}` });
    }
  }

  return { transactions, errors, warnings, count: transactions.length };
}

// ── Parse NACHA 6-digit date YYMMDD → YYYY-MM-DD ────────────────────────────
function formatNachaDate(str) {
  if (!str || str.trim().length < 6) return new Date().toISOString().split('T')[0];
  const s = str.trim();
  const yy = s.slice(0, 2), mm = s.slice(2, 4), dd = s.slice(4, 6);
  const year = parseInt(yy) > 50 ? `19${yy}` : `20${yy}`;
  return `${year}-${mm}-${dd}`;
}

// ── Parse CSV text → array of transactions ──────────────────────────────────
function parseCsvTransactions(csvText) {
  // Normalise line endings (handles Windows \r\n and Mac \r)
  const lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return { transactions: [], errors: ['CSV must have a header row and at least one data row'], count: 0 };

  const headers = lines[0].split(',').map(h => h.trim().replace(/\r/g, '').toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, ''));
  const transactions = [];
  const errors = [];

  for (let i = 1; i < lines.length; i++) {
    try {
      const rawLine = lines[i].replace(/\r/g, '');
      if (!rawLine.trim()) continue; // skip blank lines
      const vals   = parseCsvLine(rawLine);
      const row    = {};
      headers.forEach((h, idx) => { row[h] = (vals[idx] || '').trim().replace(/\r/g, ''); });

      const amount = parseFloat(row.amount || row.dollar_amount || '0');
      if (isNaN(amount) || amount <= 0) {
        errors.push({ line: i + 1, msg: `Invalid amount: "${row.amount}"` });
        continue;
      }

      const txn = {
        transaction_id:      `TXN-${uuidv4().slice(0, 8).toUpperCase()}`,
        sec_code:            (row.sec_code || row.entry_class || 'PPD').toUpperCase(),
        company_name:        row.company_name || row.originator_name || row.individual_name || 'Unknown',
        company_id:          row.company_id || row.company_identification || 'UNKNOWN000',
        amount,
        transaction_type:    (row.transaction_type || row.type || 'debit').toLowerCase(),
        account_number:      row.account_number || row.dfi_account_number || '',
        routing_number:      (row.routing_number || row.rdfi_routing || '').replace(/\D/g, ''),
        effective_date:      row.effective_date || row.effective_entry_date || new Date().toISOString().split('T')[0],
        entry_description:   (row.entry_description || row.description || '').slice(0, 10),
        individual_name:     row.individual_name || row.receiver_name || '',
        individual_id_number:row.individual_id || row.individual_id_number || '',
        transaction_code:    row.transaction_code || '',
        account_type:        (row.account_type || 'checking').toLowerCase(),
        trace_number:        row.trace_number || '',
        odfi_routing:        row.odfi_routing || '',
        company_entry_description: row.company_entry_description || '',
        authorization_type:  row.authorization_type || null,
        addenda_record_indicator: row.addenda_indicator || '0',
        prenote:             row.prenote === 'true' || row.prenote === '1',
        is_positive_pay:     row.positive_pay === 'true' || row.positive_pay === '1',
        check_serial_number: row.check_number || row.check_serial_number || null,
        payee_name:          row.payee_name || null,
        ofac_screened:       row.ofac_screened === 'true' || row.ofac_screened === '1',
        ofac_result:         row.ofac_result || 'pending',
        aml_flag:            row.aml_flag === 'true' || row.aml_flag === '1',
        originator:          'CSV_IMPORT',

        // IAT fields if present
        iso_destination_country_code: row.country_code || row.iso_destination_country_code || null,
        originator_country:  row.originator_country || null,
        receiver_country:    row.receiver_country || null,
        foreign_exchange_indicator: row.fx_indicator || null,

        // Advanced Risk Context fields
        positive_pay_mismatch: row.positive_pay_mismatch === 'true' || row.positive_pay_mismatch === '1',
        ach_block_active:      row.ach_block_active === 'true' || row.ach_block_active === '1',
        rdfi_trace_mismatch:   row.rdfi_trace_mismatch === 'true' || row.rdfi_trace_mismatch === '1',
        new_originator:        row.new_originator === 'true' || row.new_originator === '1',
      };
      transactions.push(txn);
    } catch (e) {
      errors.push({ line: i + 1, msg: e.message });
    }
  }

  return { transactions, errors, count: transactions.length };
}

function parseCsvLine(line) {
  const results = [];
  let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { results.push(cur); cur = ''; }
    else { cur += ch; }
  }
  results.push(cur);
  return results;
}

module.exports = { parseNachaFile, parseCsvTransactions };
