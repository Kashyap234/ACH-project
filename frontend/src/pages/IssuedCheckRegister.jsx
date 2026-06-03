// frontend/src/pages/IssuedCheckRegister.jsx
// Check Positive Pay — issued check register, payee matching, exception detection
import { useState, useEffect } from 'react';
import { checkRegisterApi, accountsApi } from '../api/client';

const MATCH_COLORS = {
  FULL_MATCH:     { color:'var(--accent-green)', bg:'rgba(16,185,129,0.1)',  icon:'✅' },
  AMOUNT_MISMATCH:{ color:'var(--accent-red)',   bg:'rgba(239,68,68,0.1)',   icon:'💰' },
  PAYEE_MISMATCH: { color:'var(--accent-red)',   bg:'rgba(239,68,68,0.1)',   icon:'👤' },
  STALE_DATED:    { color:'var(--accent-yellow)',bg:'rgba(245,158,11,0.1)', icon:'📅' },
  SERIAL_NOT_FOUND:{ color:'var(--accent-red)',  bg:'rgba(239,68,68,0.1)',  icon:'❓' },
  exception:      { color:'var(--accent-red)',   bg:'rgba(239,68,68,0.08)', icon:'⚠️' },
};

const SAMPLE_CSV = `check_serial_number,issued_amount,payee_name,issue_date,memo
1001,5000.00,Office Depot,2026-05-01,Office supplies
1002,12500.00,Johnson & Partners,2026-05-10,Legal services
1003,875.50,AT&T Telecom,2026-05-15,Utility bill
1004,3200.00,Amazon Web Services,2026-05-20,Cloud hosting
1005,22000.00,Global Vendor LLC,2026-05-22,Consulting Q2`;

export default function IssuedCheckRegister() {
  const [accounts,  setAccounts]  = useState([]);
  const [selAcct,   setSelAcct]   = useState('ACC-001');
  const [checks,    setChecks]    = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [tab,       setTab]       = useState('register');
  const [csvText,   setCsvText]   = useState('');
  const [uploading, setUploading] = useState(false);
  const [matchForm, setMatchForm] = useState({ check_serial_number:'', amount:'', payee_name:'' });
  const [matchResult,setMatchResult]= useState(null);
  const [addForm,   setAddForm]   = useState({ check_serial_number:'', issued_amount:'', payee_name:'', issue_date:new Date().toISOString().split('T')[0], memo:'' });
  const [adding,    setAdding]    = useState(false);

  const loadAccounts = () => accountsApi.getAll().then(r => setAccounts(r.data||[])).catch(()=>{});
  const loadChecks   = () => {
    setLoading(true);
    checkRegisterApi.getAll(selAcct).then(r => setChecks(r.data||[])).catch(()=>[]).finally(()=>setLoading(false));
  };

  useEffect(() => { loadAccounts(); }, []);
  useEffect(() => { loadChecks(); }, [selAcct]);

  const handleBulkUpload = async () => {
    if (!csvText.trim()) return;
    setUploading(true);
    const res = await checkRegisterApi.bulkUpload(selAcct, csvText).catch(e => ({ success:false, error:e.message }));
    if (res.success) { alert(`✅ ${res.message}`); setCsvText(''); loadChecks(); }
    else alert(`❌ ${res.error}`);
    setUploading(false);
  };

  const handleAddSingle = async () => {
    if (!addForm.check_serial_number || !addForm.issued_amount) return alert('Serial number and amount required');
    setAdding(true);
    const res = await checkRegisterApi.addCheck(selAcct, { ...addForm, issued_amount: parseFloat(addForm.issued_amount) }).catch(e => ({ success:false, error:e.message }));
    if (res.success) { setAddForm({ check_serial_number:'', issued_amount:'', payee_name:'', issue_date:new Date().toISOString().split('T')[0], memo:'' }); loadChecks(); }
    else alert(`❌ ${res.error}`);
    setAdding(false);
  };

  const handleMatch = async () => {
    if (!matchForm.check_serial_number || !matchForm.amount) return;
    const res = await checkRegisterApi.matchCheck(selAcct, { ...matchForm, amount: parseFloat(matchForm.amount) });
    setMatchResult(res);
    loadChecks();
  };

  const voidCheck = async (checkId) => {
    const reason = prompt('Void reason:');
    if (reason === null) return;
    await checkRegisterApi.voidCheck(selAcct, checkId, reason || 'Voided');
    loadChecks();
  };

  const exceptions = checks.filter(c => c.match_result && c.match_result !== 'FULL_MATCH');
  const matched    = checks.filter(c => c.match_result === 'FULL_MATCH');
  const issued     = checks.filter(c => !c.match_result && c.status === 'issued');
  const voided     = checks.filter(c => c.status === 'voided');

  return (
    <div>
      <div className="page-header">
        <h2>✅ Check Positive Pay Register</h2>
        <p>Upload issued check register · AI matches presented checks against your file · Payee & amount mismatch detection</p>
      </div>

      {/* Account selector */}
      <div style={{ display:'flex', gap:12, marginBottom:20, alignItems:'center' }}>
        <label style={{ fontSize:'0.82rem', color:'var(--text-secondary)' }}>Account:</label>
        <select className="form-select" style={{ width:'auto', minWidth:240 }} value={selAcct} onChange={e => setSelAcct(e.target.value)}>
          {accounts.map(a => <option key={a.account_id} value={a.account_id}>{a.account_name} ({a.account_number})</option>)}
        </select>
        <button className="btn btn-ghost btn-sm" onClick={loadChecks}>↻</button>
      </div>

      {/* KPI strip */}
      <div className="stats-grid" style={{ marginBottom:20 }}>
        {[
          { label:'Total Checks',  v:checks.length,    c:'--accent-blue',   icon:'📋' },
          { label:'Exceptions',    v:exceptions.length, c:'--accent-red',   icon:'⚠️' },
          { label:'Matched',       v:matched.length,   c:'--accent-green',  icon:'✅' },
          { label:'Awaiting',      v:issued.length,    c:'--accent-yellow', icon:'⏳' },
          { label:'Voided',        v:voided.length,    c:'--text-muted',    icon:'🚫' },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ '--accent-color':`var(${s.c})` }}>
            <div className="stat-label">{s.label}</div>
            <div className="stat-value" style={{ color:`var(${s.c})`, fontSize:'1.6rem' }}>{s.v}</div>
            <div className="stat-icon">{s.icon}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:4, marginBottom:16 }}>
        {[['register','📋 Register'],['add','➕ Add Check'],['upload','📂 Bulk Upload (CSV)'],['match','🔍 Match Check']].map(([id,lbl])=>(
          <button key={id} className={`btn btn-sm ${tab===id?'btn-primary':'btn-ghost'}`} onClick={()=>setTab(id)}>{lbl}</button>
        ))}
      </div>

      {/* Register table */}
      {tab==='register' && (
        <div className="table-wrapper">
          {loading ? <div className="loading-center" style={{ padding:40 }}><div className="spinner"/></div>
          : checks.length === 0 ? <div className="empty-state"><div className="empty-icon">📭</div><p>No checks in register. Upload a CSV or add checks manually.</p></div>
          : (
            <table>
              <thead>
                <tr><th>Serial #</th><th>Issued Amount</th><th>Payee</th><th>Issue Date</th><th>Match Result</th><th>Presented Amount</th><th>Presented Payee</th><th>Status</th><th>Action</th></tr>
              </thead>
              <tbody>
                {checks.map(c => {
                  const mr = MATCH_COLORS[c.match_result] || (c.status==='voided'?{ color:'var(--text-muted)', bg:'transparent', icon:'🚫' }:{ color:'var(--text-muted)', bg:'transparent', icon:'⏳' });
                  return (
                    <tr key={c.id}>
                      <td className="monospace" style={{ fontWeight:700, color:'var(--accent-cyan)' }}>{c.check_serial_number}</td>
                      <td style={{ fontWeight:700, color:'var(--accent-green)' }}>${Number(c.issued_amount).toLocaleString('en-US',{minimumFractionDigits:2})}</td>
                      <td style={{ fontSize:'0.82rem' }}>{c.payee_name||'—'}</td>
                      <td style={{ fontSize:'0.78rem', color:'var(--text-muted)' }}>{c.issue_date}</td>
                      <td>
                        {c.match_result
                          ? <span style={{ fontSize:'0.72rem', fontWeight:700, color:mr.color, background:mr.bg, padding:'2px 8px', borderRadius:99 }}>{mr.icon} {c.match_result.replace(/_/g,' ')}</span>
                          : <span style={{ fontSize:'0.72rem', color:'var(--text-muted)' }}>⏳ Not yet presented</span>
                        }
                      </td>
                      <td style={{ fontSize:'0.82rem', color: c.presented_amount && Math.abs(c.presented_amount-c.issued_amount)>0.01 ? 'var(--accent-red)' : 'inherit' }}>
                        {c.presented_amount ? `$${Number(c.presented_amount).toLocaleString('en-US',{minimumFractionDigits:2})}` : '—'}
                      </td>
                      <td style={{ fontSize:'0.78rem', color: c.presented_payee && c.presented_payee?.toLowerCase()!==c.payee_name?.toLowerCase() ? 'var(--accent-red)' : 'inherit' }}>
                        {c.presented_payee||'—'}
                      </td>
                      <td><span className={`status-badge ${c.status==='matched'?'approved':c.status==='exception'?'under_review':c.status==='voided'?'declined':'pending'}`} style={{fontSize:'0.65rem'}}>{c.status}</span></td>
                      <td>
                        {c.status==='issued' && <button className="btn btn-ghost btn-sm" style={{ fontSize:'0.68rem', padding:'3px 8px' }} onClick={()=>voidCheck(c.id)}>Void</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Add single check */}
      {tab==='add' && (
        <div className="card">
          <div className="card-title">➕ Add Issued Check to Register</div>
          <div className="form-grid" style={{ marginTop:16 }}>
            <div className="form-group">
              <label className="form-label">Check Serial Number<span className="required">*</span></label>
              <input className="form-input" value={addForm.check_serial_number} onChange={e=>setAddForm(f=>({...f,check_serial_number:e.target.value}))} placeholder="e.g. 1001" />
            </div>
            <div className="form-group">
              <label className="form-label">Issued Amount ($)<span className="required">*</span></label>
              <input className="form-input" type="number" step="0.01" value={addForm.issued_amount} onChange={e=>setAddForm(f=>({...f,issued_amount:e.target.value}))} />
            </div>
            <div className="form-group">
              <label className="form-label">Payee Name</label>
              <input className="form-input" value={addForm.payee_name} onChange={e=>setAddForm(f=>({...f,payee_name:e.target.value}))} placeholder="Exact payee name on check" />
              <span className="form-hint">⚠️ Must match exactly — Payee Positive Pay compares this</span>
            </div>
            <div className="form-group">
              <label className="form-label">Issue Date</label>
              <input className="form-input" type="date" value={addForm.issue_date} onChange={e=>setAddForm(f=>({...f,issue_date:e.target.value}))} />
              <span className="form-hint">Checks &gt;90 days old are flagged as stale-dated</span>
            </div>
            <div className="form-group">
              <label className="form-label">Memo / Description</label>
              <input className="form-input" value={addForm.memo} onChange={e=>setAddForm(f=>({...f,memo:e.target.value}))} />
            </div>
          </div>
          <div style={{ marginTop:14 }}>
            <button className="btn btn-primary" onClick={handleAddSingle} disabled={adding}>{adding?'Adding…':'➕ Add to Register'}</button>
          </div>
        </div>
      )}

      {/* Bulk CSV upload */}
      {tab==='upload' && (
        <div className="card">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
            <div className="card-title">📂 Bulk Upload Issued Check File (CSV)</div>
            <button className="btn btn-ghost btn-sm" onClick={()=>setCsvText(SAMPLE_CSV)}>Load Sample</button>
          </div>
          <div style={{ marginBottom:10, padding:'10px 14px', background:'var(--bg-primary)', borderRadius:'var(--radius-sm)', fontSize:'0.75rem', color:'var(--text-muted)' }}>
            Required columns: <code>check_serial_number</code>, <code>issued_amount</code> · Optional: <code>payee_name</code>, <code>issue_date</code>, <code>memo</code>
          </div>
          <textarea className="form-input" rows={12} style={{ fontFamily:'monospace', fontSize:'0.75rem', resize:'vertical' }}
            placeholder="check_serial_number,issued_amount,payee_name,issue_date,memo&#10;1001,5000.00,Office Depot,2026-05-01,Supplies"
            value={csvText} onChange={e=>setCsvText(e.target.value)} />
          <div style={{ marginTop:12, display:'flex', gap:10 }}>
            <button className="btn btn-primary" onClick={handleBulkUpload} disabled={uploading||!csvText.trim()}>
              {uploading?<><div className="spinner" style={{width:18,height:18,borderWidth:2}}/>Uploading…</>:'📤 Upload to Register'}
            </button>
            <button className="btn btn-ghost" onClick={()=>setCsvText('')} disabled={!csvText}>Clear</button>
          </div>
        </div>
      )}

      {/* Match a check */}
      {tab==='match' && (
        <div className="card">
          <div className="card-title">🔍 Test Check Matching (Payee Positive Pay)</div>
          <div style={{ marginTop:14, fontSize:'0.82rem', color:'var(--text-secondary)', marginBottom:16 }}>
            Simulate a presented check to see if it matches your issued register. This replicates how the bank's Positive Pay system validates incoming checks.
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Check Serial Number<span className="required">*</span></label>
              <input className="form-input" value={matchForm.check_serial_number} onChange={e=>setMatchForm(f=>({...f,check_serial_number:e.target.value}))} placeholder="Serial number being presented" />
            </div>
            <div className="form-group">
              <label className="form-label">Presented Amount ($)<span className="required">*</span></label>
              <input className="form-input" type="number" step="0.01" value={matchForm.amount} onChange={e=>setMatchForm(f=>({...f,amount:e.target.value}))} />
            </div>
            <div className="form-group">
              <label className="form-label">Presented Payee Name</label>
              <input className="form-input" value={matchForm.payee_name} onChange={e=>setMatchForm(f=>({...f,payee_name:e.target.value}))} placeholder="Payee on presented check" />
              <span className="form-hint">Leave blank to skip payee matching</span>
            </div>
          </div>
          <button className="btn btn-primary" style={{ marginTop:14 }} onClick={handleMatch} disabled={!matchForm.check_serial_number||!matchForm.amount}>
            🔍 Match Against Register
          </button>

          {matchResult && (
            <div style={{ marginTop:20, padding:'16px 20px', background: MATCH_COLORS[matchResult.match_result]?.bg || 'rgba(59,130,246,0.08)', borderRadius:'var(--radius-md)', border:`1px solid ${MATCH_COLORS[matchResult.match_result]?.color || 'var(--accent-blue)'}30` }}>
              <div style={{ fontSize:'1.5rem', marginBottom:8 }}>{MATCH_COLORS[matchResult.match_result]?.icon}</div>
              <div style={{ fontWeight:700, color: MATCH_COLORS[matchResult.match_result]?.color, fontSize:'1.05rem', marginBottom:4 }}>
                {matchResult.match_result?.replace(/_/g,' ')}
              </div>
              <div style={{ fontSize:'0.82rem', color:'var(--text-secondary)' }}>{matchResult.details}</div>
              {matchResult.issued_check && (
                <div style={{ marginTop:12, padding:'10px 14px', background:'var(--bg-primary)', borderRadius:'var(--radius-sm)', fontSize:'0.78rem' }}>
                  <strong>Issued Record:</strong> #{matchResult.issued_check.check_serial_number} · ${matchResult.issued_check.issued_amount} · {matchResult.issued_check.payee_name} · {matchResult.issued_check.issue_date}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
