// backend/routes/bulk.js — Bulk upload + batch processing engine (Firestore async)
const express = require('express');
const router  = express.Router();
const { v4: uuidv4 }  = require('uuid');
const { insert, update, queryOne, queryAll } = require('../database/db');
const { scoreTransaction }       = require('../services/riskEngine');
const { generateComplianceNotes, generateReviewBrief } = require('../services/aiTriage');
const { checkPatternMatch }      = require('../services/learningPipeline');
const { parseNachaFile, parseCsvTransactions } = require('../services/nachaParser');

// ── In-memory job store (keyed by jobId) ────────────────────────────────────
const jobStore = {};

// ── POST /api/bulk/upload — Receive raw transactions array ──────────────────
router.post('/upload', async (req, res) => {
  try {
    const { transactions, format = 'json', batch_size = 10, nacha_text, csv_text } = req.body;
    
    let rawTxns = [];
    let parseErrors = [];
    let parseWarnings = [];

    if (format === 'nacha' && nacha_text) {
      const parsed = parseNachaFile(nacha_text);
      rawTxns      = parsed.transactions;
      parseErrors  = parsed.errors;
      parseWarnings= parsed.warnings;
    } else if (format === 'csv' && csv_text) {
      const parsed = parseCsvTransactions(csv_text);
      rawTxns      = parsed.transactions;
      parseErrors  = parsed.errors;
    } else if (Array.isArray(transactions) && transactions.length > 0) {
      rawTxns = transactions;
    } else {
      return res.status(400).json({ success: false, error: 'Provide transactions[], csv_text, or nacha_text with matching format field' });
    }

    if (rawTxns.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid transactions to process', parse_errors: parseErrors });
    }

    const jobId = `JOB-${uuidv4().slice(0, 8).toUpperCase()}`;
    const job   = {
      job_id:           jobId,
      total:            rawTxns.length,
      batch_size:       Math.min(parseInt(batch_size) || 10, 50),
      processed:        0,
      auto_approved:    0,
      flagged:          0,
      errors:           0,
      status:           'queued',
      format,
      parse_errors:     parseErrors,
      parse_warnings:   parseWarnings,
      results:          [],
      created_at:       new Date().toISOString(),
    };
    jobStore[jobId] = { ...job, rawTxns };

    await insert('batch_jobs', {
      job_id: jobId, total: rawTxns.length, batch_size: job.batch_size,
      format, status: 'queued', parse_errors: parseErrors, parse_warnings: parseWarnings
    });

    res.json({
      success: true,
      message: `Bulk job created: ${rawTxns.length} transactions in ${Math.ceil(rawTxns.length / job.batch_size)} batches`,
      job_id:  jobId,
      total:   rawTxns.length,
      batches: Math.ceil(rawTxns.length / job.batch_size),
      parse_errors:   parseErrors,
      parse_warnings: parseWarnings
    });

    // Start processing asynchronously
    processBatch(jobId).catch(e => {
      console.error(`[Bulk] Job ${jobId} failed:`, e);
      if (jobStore[jobId]) jobStore[jobId].status = 'failed';
    });

  } catch (e) {
    console.error('[POST /bulk/upload]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/bulk/jobs/:jobId — Poll job status ─────────────────────────────
router.get('/jobs/:jobId', (req, res) => {
  const job = jobStore[req.params.jobId];
  if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
  const { rawTxns, ...safe } = job;
  res.json({ success: true, data: safe });
});

// ── GET /api/bulk/jobs — List all jobs ──────────────────────────────────────
router.get('/jobs', async (req, res) => {
  try {
    const jobs = await queryAll('batch_jobs', null, { orderBy: 'created_at', desc: true, limit: 20 });
    const merged = jobs.map(j => {
      const live = jobStore[j.job_id];
      return live ? { ...j, ...safeJob(live) } : j;
    });
    res.json({ success: true, data: merged });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Core batch processor ─────────────────────────────────────────────────────
async function processBatch(jobId) {
  const job = jobStore[jobId];
  if (!job) return;
  if (!job.rawTxns || job.rawTxns.length === 0) {
    job.status = 'completed';
    job.completed_at = new Date().toISOString();
    return;
  }
  job.status = 'running';
  job.started_at = new Date().toISOString();
  await update('batch_jobs', j => j.job_id === jobId, () => ({ status: 'running', started_at: job.started_at }));

  const { rawTxns, batch_size } = job;
  const batches = [];
  for (let i = 0; i < rawTxns.length; i += batch_size) {
    batches.push(rawTxns.slice(i, i + batch_size));
  }

  const batchTraceNumbers = new Set();
  const batchCompanyCounts = {};

  for (let bIdx = 0; bIdx < batches.length; bIdx++) {
    const batch = batches[bIdx];
    console.log(`[Bulk] Job ${jobId} — Processing batch ${bIdx + 1}/${batches.length} (${batch.length} txns)`);

    for (const raw of batch) {
      try {
        const txn = normalizeTxn(raw);

        if (!txn.amount || txn.amount <= 0) {
          throw new Error(`Invalid or zero amount for record: ${txn.company_name || txn.transaction_id}`);
        }
        if (!txn.company_name || txn.company_name === 'Unknown') {
          txn.company_name = txn.individual_name || txn.company_id || 'Unknown';
        }

        const isDbDuplicate = txn.trace_number ? !!(await queryOne('transactions', t => t.trace_number === txn.trace_number)) : false;
        const duplicate_trace = isDbDuplicate || batchTraceNumbers.has(txn.trace_number);
        if (txn.trace_number) batchTraceNumbers.add(txn.trace_number);
        
        const todayStr = new Date().toISOString().split('T')[0];
        const dbCount = (await queryAll('transactions', t => t.company_id === txn.company_id && t.effective_date === todayStr)).length;
        batchCompanyCounts[txn.company_id] = (batchCompanyCounts[txn.company_id] || 0) + 1;
        const company_daily_count = dbCount + batchCompanyCounts[txn.company_id];
        
        const check_stale = txn.issued_check_date ? (new Date() - new Date(txn.issued_check_date)) > 90 * 24 * 60 * 60 * 1000 : false;
        
        const ctx = { 
          duplicate_trace, 
          company_daily_count, 
          check_stale,
          ach_block_active: txn.ach_block_active || false,
          rdfi_trace_mismatch: txn.rdfi_trace_mismatch || false,
          new_originator: txn.new_originator || false
        };
        const riskResult = await scoreTransaction(txn, ctx);
        const match = await checkPatternMatch(txn, riskResult.riskFlags);
        let effectiveLevel = riskResult.riskLevel;
        if (match && riskResult.riskLevel > 1) effectiveLevel = 1;

        let complianceNotes = null, aiBrief = null, aiRecommendation = null, aiConfidence = null, status;

        if (effectiveLevel === 1) {
          complianceNotes = await generateComplianceNotes(txn, riskResult);
          status = 'auto_approved';
          job.auto_approved++;
        } else {
          const brief = await generateReviewBrief(txn, riskResult);
          aiBrief = brief.brief; aiRecommendation = brief.recommendation; aiConfidence = brief.confidence;
          status = 'under_review';
          job.flagged++;
        }

        await insert('transactions', {
          ...txn, risk_level: effectiveLevel, risk_score: riskResult.riskScore,
          risk_flags: riskResult.riskFlags, ai_brief: aiBrief,
          compliance_notes: complianceNotes, ai_recommendation: aiRecommendation,
          ai_confidence: aiConfidence, status
        });

        await insert('audit_logs', {
          transaction_id: txn.transaction_id,
          event_type:     effectiveLevel === 1 ? 'auto_approved' : 'ai_processed',
          event_summary:  `[BULK ${jobId}] ${effectiveLevel === 1 ? 'Auto-approved' : `Level ${effectiveLevel} flagged`}: ${txn.company_name} $${txn.amount}`,
          event_data:     { job_id: jobId, risk_level: effectiveLevel, risk_score: riskResult.riskScore },
          actor:          'AI', severity: 'info'
        });

        job.results.push({ transaction_id: txn.transaction_id, status, risk_level: effectiveLevel, risk_score: riskResult.riskScore, amount: txn.amount, company_name: txn.company_name });
        job.processed++;

      } catch (e) {
        console.error(`[Bulk] Transaction error (job ${jobId}):`, e.message, e.stack ? e.stack.split('\n')[1] : '');
        job.errors++;
        job.processed++;
        job.results.push({ error: e.message, raw_id: raw.transaction_id || raw.trace_number || 'unknown' });
      }
    }

    if (bIdx < batches.length - 1) await sleep(300);
  }

  job.status        = 'completed';
  job.completed_at  = new Date().toISOString();
  await update('batch_jobs', j => j.job_id === jobId, () => ({
    status: 'completed', completed_at: job.completed_at,
    processed: job.processed, auto_approved: job.auto_approved,
    flagged: job.flagged, errors: job.errors
  }));
  console.log(`[Bulk] Job ${jobId} completed: ${job.auto_approved} auto-approved, ${job.flagged} flagged, ${job.errors} errors`);
}

// ── Normalize raw transaction to expected shape ──────────────────────────────
function normalizeTxn(raw) {
  const id = raw.transaction_id || `TXN-${uuidv4().slice(0, 8).toUpperCase()}`;
  return {
    transaction_id:             id,
    sec_code:                   (raw.sec_code || 'PPD').toUpperCase(),
    company_name:                raw.company_name || raw.individual_name || 'Unknown',
    company_id:                  raw.company_id || 'UNKNOWN000',
    amount:                      parseFloat(raw.amount) || 0,
    transaction_type:            raw.transaction_type || 'debit',
    account_number:              raw.account_number || raw.dfi_account_number || '',
    routing_number:              raw.routing_number || raw.rdfi_routing || '',
    rdfi_routing:                raw.rdfi_routing || raw.routing_number || '',
    effective_date:              raw.effective_date || raw.effective_entry_date || new Date().toISOString().split('T')[0],
    entry_description:           (raw.entry_description || raw.company_entry_description || '').slice(0, 10),
    individual_name:             raw.individual_name || '',
    individual_id_number:        raw.individual_id_number || '',
    trace_number:                raw.trace_number || '',
    transaction_code:            raw.transaction_code || '',
    account_type:                raw.account_type || 'checking',
    service_class_code:          raw.service_class_code || '200',
    batch_number:                raw.batch_number || '',
    odfi_routing:                raw.odfi_routing || '',
    company_descriptive_date:    raw.company_descriptive_date || '',
    company_discretionary_data:  raw.company_discretionary_data || '',
    company_entry_description:   raw.company_entry_description || '',
    originator_status_code:      raw.originator_status_code || '',
    file_id_modifier:            raw.file_id_modifier || '',
    immediate_origin:            raw.immediate_origin || '',
    immediate_destination:       raw.immediate_destination || '',
    addenda_record_indicator:    raw.addenda_record_indicator || '0',
    addenda_type_code:           raw.addenda_type_code || null,
    payment_related_info:        raw.payment_related_info || null,
    discretionary_data:          raw.discretionary_data || '',
    prenote:                     raw.prenote || false,
    authorization_type:          raw.authorization_type || null,
    ofac_screened:               raw.ofac_screened || false,
    ofac_result:                 raw.ofac_result || 'pending',
    aml_flag:                    raw.aml_flag || false,
    is_positive_pay:             raw.is_positive_pay || false,
    check_serial_number:         raw.check_serial_number || raw.check_number || null,
    payee_name:                  raw.payee_name || null,
    issued_check_amount:         raw.issued_check_amount || null,
    issued_check_date:           raw.issued_check_date || null,
    iso_destination_country_code: raw.iso_destination_country_code || null,
    originator_street:           raw.originator_street || null,
    originator_city:             raw.originator_city || null,
    originator_country:          raw.originator_country || null,
    receiver_country:            raw.receiver_country || null,
    originator:                  raw.originator || 'BULK_IMPORT',
  };
}

function safeJob(job) {
  const { rawTxns, ...safe } = job;
  return safe;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = router;
