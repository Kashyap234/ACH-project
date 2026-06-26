// frontend/src/pages/BulkUpload.jsx — CSV / JSON / NACHA file bulk processing
import { useState, useEffect, useRef } from 'react';
import { bulkApi } from '../api/client';

const SAMPLE_CSV = `sec_code,transaction_code,company_name,company_id,amount,transaction_type,routing_number,account_number,account_type,effective_date,entry_description,individual_name,authorization_type,originator_email
PPD,22,Acme Payroll Corp,ACMECORP01,3250.00,credit,021000021,1234567890,checking,${new Date().toISOString().split('T')[0]},PAYROLL,Jane Smith,PPD_WRITTEN,jane.smith@acmecorp.com
CCD,27,GlobalTech LLC,GTECH2024X,8500.00,debit,071000013,9876543210,checking,${new Date().toISOString().split('T')[0]},VENDORPMT,GlobalTech LLC,CCD_SIGNED,ap@globaltech.com
WEB,27,QuickShop Online,QSHOP09870,1200.00,debit,122000247,5512334455,checking,${new Date().toISOString().split('T')[0]},PURCHASE,Robert Chen,WEB_CLICK,robert.chen@email.com
PPD,27,NationalEnergy Co,NATENG0001,450.00,debit,044000037,6677889900,checking,${new Date().toISOString().split('T')[0]},UTILITY,Mary Johnson,PPD_WRITTEN,mary.johnson@nateng.com
CCD,22,TechStartup Inc,TECHST0099,12000.00,credit,021000021,3344556677,checking,${new Date().toISOString().split('T')[0]},INVESTMNT,TechStartup Inc,CCD_SIGNED,finance@techstartup.com`;

const SAMPLE_JSON = JSON.stringify([
  { sec_code:'PPD', transaction_code:'22', company_name:'Acme Corp', company_id:'ACMECORP01', amount:3250, transaction_type:'credit', routing_number:'021000021', account_number:'1234567890', account_type:'checking', effective_date: new Date().toISOString().split('T')[0], entry_description:'PAYROLL', individual_name:'Jane Smith', authorization_type:'PPD_WRITTEN', originator_email:'jane.smith@acmecorp.com' },
  { sec_code:'WEB', transaction_code:'27', company_name:'E-Commerce Ltd', company_id:'ECOML09870', amount:950, transaction_type:'debit', routing_number:'122000247', account_number:'5512334455', account_type:'checking', entry_description:'PURCHASE', individual_name:'Bob Jones', authorization_type:'WEB_CLICK', originator_email:'bob.jones@email.com' },
  { sec_code:'CCD', transaction_code:'27', company_name:'Vendor Corp', company_id:'VENDCO0001', amount:22000, transaction_type:'debit', routing_number:'071000013', account_number:'9876543210', account_type:'checking', entry_description:'VENDORPMT', individual_name:'Vendor Corp', authorization_type:'CCD_SIGNED', originator_email:'ap@vendorcorp.com' },
], null, 2);

function JobCard({ job, onRefresh }) {
  const pct = job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0;
  const color = job.status === 'completed' ? 'var(--accent-green)' : job.status === 'failed' ? 'var(--accent-red)' : 'var(--accent-blue)';

  return (
    <div className="card" style={{ borderColor: `${color}30`, marginBottom: 16 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 12 }}>
        <div>
          <span className="monospace" style={{ color:'var(--accent-cyan)', fontSize:'0.85rem', fontWeight:700 }}>{job.job_id}</span>
          <span style={{ marginLeft:10, fontSize:'0.75rem', color:'var(--text-muted)' }}>{new Date(job.created_at).toLocaleString()}</span>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <span style={{ fontSize:'0.75rem', fontWeight:700, color, background:`${color}15`, padding:'3px 10px', borderRadius:99 }}>
            {job.status.toUpperCase()}
          </span>
          {job.status === 'running' && <button className="btn btn-ghost btn-sm" onClick={onRefresh}>↻</button>}
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom:12 }}>
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.72rem', marginBottom:4, color:'var(--text-muted)' }}>
          <span>Progress: {job.processed || 0} / {job.total}</span>
          <span>{pct}%</span>
        </div>
        <div style={{ background:'var(--bg-primary)', borderRadius:99, height:8, overflow:'hidden' }}>
          <div style={{ width:`${pct}%`, height:'100%', background: color, transition:'width 0.5s ease', borderRadius:99 }} />
        </div>
      </div>

      {/* Stats */}
      <div style={{ display:'flex', gap:16 }}>
        {[
          { label:'Total', v: job.total, c:'var(--text-primary)' },
          { label:'Auto-Approved', v: job.auto_approved||0, c:'var(--accent-green)' },
          { label:'Flagged', v: job.flagged||0, c:'var(--accent-yellow)' },
          { label:'Errors', v: job.errors||0, c:'var(--accent-red)' },
        ].map(s => (
          <div key={s.label} style={{ textAlign:'center' }}>
            <div style={{ fontSize:'1.2rem', fontWeight:700, color:s.c }}>{s.v}</div>
            <div style={{ fontSize:'0.65rem', color:'var(--text-muted)', textTransform:'uppercase' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Parse warnings */}
      {(job.parse_warnings||[]).length > 0 && (
        <div style={{ marginTop:10, padding:'8px 12px', background:'rgba(245,158,11,0.08)', borderRadius:'var(--radius-sm)', border:'1px solid rgba(245,158,11,0.2)' }}>
          <div style={{ fontSize:'0.72rem', color:'var(--accent-yellow)', fontWeight:700, marginBottom:4 }}>⚠ Parse Warnings</div>
          {job.parse_warnings.slice(0,3).map((w,i) => <div key={i} style={{ fontSize:'0.7rem', color:'var(--text-secondary)' }}>Line {w.line}: {w.msg}</div>)}
        </div>
      )}

      {/* Results table */}
      {(job.results||[]).length > 0 && (
        <div className="table-wrapper" style={{ marginTop:12, maxHeight:200, overflowY:'auto' }}>
          <table>
            <thead><tr><th>ID</th><th>Company</th><th>Amount</th><th>Level</th><th>Score</th><th>Status</th></tr></thead>
            <tbody>
              {job.results.map((r,i) => (
                <tr key={i}>
                  <td className="monospace" style={{ fontSize:'0.7rem', color:'var(--accent-cyan)' }}>{r.transaction_id || '—'}</td>
                  <td style={{ fontSize:'0.78rem' }}>{r.company_name || r.error || '—'}</td>
                  <td style={{ fontSize:'0.78rem' }}>{r.amount ? `$${r.amount.toLocaleString()}` : '—'}</td>
                  <td>{r.risk_level ? <span className={`risk-badge level-${r.risk_level}`}>L{r.risk_level}</span> : '—'}</td>
                  <td style={{ fontSize:'0.78rem', color: r.risk_score >= 70 ? 'var(--accent-red)' : r.risk_score >= 30 ? 'var(--accent-yellow)' : 'var(--accent-green)' }}>{r.risk_score ?? '—'}</td>
                  <td><span className={`status-badge ${r.status||'error'}`} style={{ fontSize:'0.65rem' }}>{r.status||'error'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function BulkUpload({ onComplete }) {
  const [format, setFormat]       = useState('csv');
  const [content, setContent]     = useState('');
  const [batchSize, setBatchSize] = useState(10);
  const [loading, setLoading]     = useState(false);
  const [jobs, setJobs]           = useState([]);
  const [error, setError]         = useState('');
  const fileRef = useRef();

  const loadJobs = () => bulkApi.listJobs().then(r => setJobs(r.data || [])).catch(() => {});
  useEffect(() => { loadJobs(); }, []);

  const handleFileRead = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setContent(ev.target.result);
    reader.readAsText(file);
  };

  const applySample = () => setContent(format === 'csv' ? SAMPLE_CSV : SAMPLE_JSON);

  const handleUpload = async () => {
    if (!content.trim()) { setError('Paste or upload content first.'); return; }
    setError(''); setLoading(true);
    try {
      let payload;
      if (format === 'json') {
        const parsed = JSON.parse(content);
        payload = { transactions: Array.isArray(parsed) ? parsed : [parsed], batch_size: batchSize, format: 'json' };
      } else if (format === 'csv') {
        payload = { csv_text: content, batch_size: batchSize, format: 'csv' };
      } else {
        payload = { nacha_text: content, batch_size: batchSize, format: 'nacha' };
      }
      const res = await bulkApi.upload(payload);
      setContent('');
      setJobs(j => [{ job_id: res.job_id, total: res.total, processed:0, auto_approved:0, flagged:0, errors:0, status:'queued', created_at: new Date().toISOString(), results:[], parse_errors: res.parse_errors||[], parse_warnings: res.parse_warnings||[] }, ...j]);
      onComplete?.();
      // Poll live
      const jobId = res.job_id;
      const poll = setInterval(async () => {
        try {
          const status = await bulkApi.getJob(jobId);
          setJobs(j => j.map(job => job.job_id === jobId ? status.data : job));
          if (['completed','failed'].includes(status.data?.status)) { clearInterval(poll); onComplete?.(); }
        } catch { clearInterval(poll); }
      }, 1500);
    } catch (e) {
      setError(e.message.includes('JSON') ? 'Invalid JSON format. Check syntax.' : e.message);
    } finally { setLoading(false); }
  };

  const refreshJob = async (jobId) => {
    const status = await bulkApi.getJob(jobId).catch(() => null);
    if (status) setJobs(j => j.map(job => job.job_id === jobId ? status.data : job));
  };

  return (
    <div>
      <div className="page-header">
        <h2>📦 Bulk Transaction Upload</h2>
        <p>Upload CSV, JSON, or raw NACHA .ach files — processed in configurable batches with per-entry AI triage</p>
      </div>

      {/* Format Selector */}
      <div className="card" style={{ marginBottom:20 }}>
        <div className="card-title">Select Format & Batch Size</div>
        <div style={{ display:'flex', gap:10, marginTop:12, flexWrap:'wrap', alignItems:'center' }}>
          {[['csv','📄 CSV File'],['json','🔷 JSON Array'],['nacha','🏦 NACHA .ach File']].map(([val,label]) => (
            <button key={val} className={`btn btn-sm ${format===val?'btn-primary':'btn-ghost'}`} onClick={() => { setFormat(val); setContent(''); }}>{label}</button>
          ))}
          <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
            <label style={{ fontSize:'0.8rem', color:'var(--text-secondary)' }}>Batch size:</label>
            {[5,10,25,50].map(n => (
              <button key={n} className={`btn btn-sm ${batchSize===n?'btn-primary':'btn-ghost'}`} onClick={() => setBatchSize(n)}>{n}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Upload Area */}
      <div className="card" style={{ marginBottom:20 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
          <div className="card-title">
            {format==='csv'&&'📄 Paste or Upload CSV'} {format==='json'&&'🔷 Paste JSON Array'} {format==='nacha'&&'🏦 Paste NACHA File Content'}
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button className="btn btn-ghost btn-sm" onClick={applySample}>Load Sample</button>
            <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>📁 Choose File</button>
          </div>
        </div>
        <input ref={fileRef} type="file" accept={format==='nacha'?'.ach,.txt':format==='csv'?'.csv':'.json'} style={{ display:'none' }} onChange={handleFileRead} />

        {/* Format hint */}
        <div style={{ marginBottom:10, padding:'8px 12px', background:'var(--bg-primary)', borderRadius:'var(--radius-sm)', fontSize:'0.75rem', color:'var(--text-muted)' }}>
          {format==='csv' && <>CSV must have a header row. Required columns: <code>company_name, company_id, amount, routing_number, account_number</code>. Optional: <code>sec_code, transaction_code, authorization_type, account_type, effective_date, individual_name, originator_email</code>. Include <code>originator_email</code> so the bot can send MIR portal links during auto-approval workflows.</>}
          {format==='json' && <>Provide a JSON array of transaction objects. Same field names as the NACHA single-entry form.</>}
          {format==='nacha' && <>Paste the full NACHA fixed-width file content (94-character records). Supports File Header (1), Batch Header (5), Entry Detail (6), Addenda (7), Batch Control (8), File Control (9).</>}
        </div>

        <textarea
          className="form-input"
          rows={12}
          style={{ fontFamily:'monospace', fontSize:'0.75rem', resize:'vertical', letterSpacing:'0.02em' }}
          placeholder={format==='nacha'
            ? '101 021000021 1022630440604221200A094101MY BANK               NACHA DEMO FILE        \n...'
            : format==='csv' ? 'sec_code,company_name,company_id,amount,routing_number,account_number,...\nPPD,Acme Corp,ACME000001,3250.00,021000021,1234567890,...'
            : '[{"sec_code":"PPD","company_name":"Acme","amount":3250,...}]'}
          value={content}
          onChange={e => { setContent(e.target.value); setError(''); }}
        />

        {error && <div style={{ marginTop:8, color:'var(--accent-red)', fontSize:'0.8rem' }}>❌ {error}</div>}

        <div style={{ marginTop:14, display:'flex', gap:10, alignItems:'center' }}>
          <button className="btn btn-primary btn-lg" onClick={handleUpload} disabled={loading || !content.trim()}>
            {loading ? <><div className="spinner" style={{width:18,height:18,borderWidth:2}}/>Uploading…</> : `🚀 Upload & Process (batch size: ${batchSize})`}
          </button>
          <button className="btn btn-ghost" onClick={() => setContent('')} disabled={!content}>Clear</button>
          <span style={{ fontSize:'0.75rem', color:'var(--text-muted)', marginLeft:'auto' }}>
            {content ? `${content.split('\n').filter(l=>l.trim()).length} lines detected` : 'No content'}
          </span>
        </div>
      </div>

      {/* Jobs */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <h3 style={{ fontSize:'1rem', fontWeight:700 }}>Batch Jobs</h3>
        <button className="btn btn-ghost btn-sm" onClick={loadJobs}>↻ Refresh</button>
      </div>
      {jobs.length === 0
        ? <div className="empty-state"><div className="empty-icon">📭</div><p>No batch jobs yet. Upload a file to get started.</p></div>
        : jobs.map(j => <JobCard key={j.job_id} job={j} onRefresh={() => refreshJob(j.job_id)} />)
      }
    </div>
  );
}
