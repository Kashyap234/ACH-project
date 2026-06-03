// frontend/src/pages/AccountManager.jsx
// Per-account ACH filter mode, allow-list whitelist, Reverse Positive Pay config
import { useState, useEffect } from 'react';
import { accountsApi } from '../api/client';

const FILTER_MODES = [
  { value:'positive_pay',       label:'✅ Positive Pay',         desc:'Flag exceptions not matching pre-set rules. Best for accounts with some variability.' },
  { value:'allow_list',         label:'🔒 ACH Allow List (Filter)', desc:'Auto-block all ACH debits except from approved Company IDs. Hands-off for predictable payments.' },
  { value:'block_all',          label:'🚫 ACH Debit Block',      desc:'Reject ALL incoming ACH debits. Use for reserve, escrow, or tax accounts.' },
  { value:'reverse_positive_pay',label:'↩ Reverse Positive Pay', desc:'All transactions presented daily for manual review. Business decides pay/return. Highest control.' },
];

const SAMPLE_CSV = `check_serial_number,issued_amount,payee_name,issue_date,memo
1001,5000.00,Office Depot,2026-05-01,Office supplies
1002,12500.00,Johnson & Partners,2026-05-10,Legal services
1003,875.50,AT&T,2026-05-15,Utility bill
1004,3200.00,Amazon Web Services,2026-05-20,Cloud hosting`;

function AccountCard({ account, onRefresh }) {
  const [editing,   setEditing]   = useState(false);
  const [form,      setForm]      = useState({ ...account });
  const [newCoId,   setNewCoId]   = useState('');
  const [newCoName, setNewCoName] = useState('');
  const [newMaxAmt, setNewMaxAmt] = useState('');
  const [saving,    setSaving]    = useState(false);
  const [addingCo,  setAddingCo]  = useState(false);

  const save = async () => {
    setSaving(true);
    await accountsApi.update(account.account_id, form).catch(e => alert(e.message));
    setSaving(false); setEditing(false); onRefresh();
  };

  const addCompany = async () => {
    if (!newCoId.trim()) return;
    setAddingCo(true);
    await accountsApi.addToWhitelist(account.account_id, { company_id: newCoId.trim(), company_name: newCoName.trim(), max_amount: newMaxAmt || null });
    setNewCoId(''); setNewCoName(''); setNewMaxAmt('');
    setAddingCo(false); onRefresh();
  };

  const removeCompany = async (cid) => {
    if (!confirm(`Remove ${cid} from allow list?`)) return;
    await accountsApi.removeFromWhitelist(account.account_id, cid);
    onRefresh();
  };

  const mode = FILTER_MODES.find(m => m.value === account.filter_mode) || FILTER_MODES[0];
  const modeColor = {
    positive_pay:'var(--accent-blue)', allow_list:'var(--accent-green)',
    block_all:'var(--accent-red)', reverse_positive_pay:'var(--accent-purple)'
  }[account.filter_mode] || 'var(--accent-blue)';

  return (
    <div className="card" style={{ marginBottom:16, borderColor:`${modeColor}25` }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16 }}>
        <div>
          <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:4 }}>
            <div style={{ fontWeight:700, fontSize:'1rem' }}>{account.account_name}</div>
            <span className="monospace" style={{ fontSize:'0.72rem', color:'var(--text-muted)' }}>{account.account_number}</span>
            <span style={{ fontSize:'0.7rem', fontWeight:700, color:modeColor, background:`${modeColor}15`, padding:'2px 10px', borderRadius:99, border:`1px solid ${modeColor}30` }}>
              {mode.label}
            </span>
          </div>
          <div style={{ fontSize:'0.78rem', color:'var(--text-secondary)' }}>{mode.desc}</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setEditing(!editing)}>
          {editing ? '✕ Cancel' : '⚙️ Configure'}
        </button>
      </div>

      {/* Config summary */}
      {!editing && (
        <div style={{ display:'flex', gap:16, fontSize:'0.78rem', flexWrap:'wrap' }}>
          <span>Cutoff: <strong style={{ color:'var(--accent-cyan)' }}>{account.cutoff_time}</strong></span>
          <span>Default: <strong style={{ color:account.default_action==='pay'?'var(--accent-green)':'var(--accent-red)' }}>{account.default_action?.toUpperCase()}</strong></span>
          <span>Max daily debit: <strong>${(account.max_daily_debit||0).toLocaleString()}</strong></span>
          <span>Debit block: <strong style={{ color:account.debit_block?'var(--accent-red)':'var(--accent-green)' }}>{account.debit_block?'ON':'OFF'}</strong></span>
        </div>
      )}

      {/* Edit form */}
      {editing && (
        <div style={{ marginTop:12, borderTop:'1px solid var(--border)', paddingTop:16 }}>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Filter Mode</label>
              <select className="form-select" value={form.filter_mode} onChange={e => setForm(f => ({ ...f, filter_mode:e.target.value }))}>
                {FILTER_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Cutoff Time</label>
              <input className="form-input" type="time" value={form.cutoff_time} onChange={e => setForm(f => ({ ...f, cutoff_time:e.target.value }))} />
              <span className="form-hint">Deadline for pay/return decisions (local time)</span>
            </div>
            <div className="form-group">
              <label className="form-label">Default Action (if no decision by cutoff)</label>
              <select className="form-select" value={form.default_action} onChange={e => setForm(f => ({ ...f, default_action:e.target.value }))}>
                <option value="return">RETURN (reject) — recommended for most accounts</option>
                <option value="pay">PAY (allow) — use for Reverse Positive Pay</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Max Daily Debit ($)</label>
              <input className="form-input" type="number" value={form.max_daily_debit} onChange={e => setForm(f => ({ ...f, max_daily_debit:+e.target.value }))} />
            </div>
          </div>
          <div style={{ display:'flex', gap:8, marginTop:14 }}>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving?'Saving…':'💾 Save Config'}</button>
          </div>
        </div>
      )}

      {/* Allow List — only for allow_list mode */}
      {(account.filter_mode === 'allow_list' || account.filter_mode === 'positive_pay') && (
        <div style={{ marginTop:16, borderTop:'1px solid var(--border)', paddingTop:14 }}>
          <div style={{ fontWeight:600, fontSize:'0.8rem', color:'var(--text-secondary)', marginBottom:10 }}>
            🔒 Authorized Company IDs (Allow List) — {(account.authorized_company_ids||[]).length} companies
          </div>
          {(account.authorized_company_ids||[]).length > 0 ? (
            <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:12 }}>
              {account.authorized_company_ids.map(cid => (
                <span key={cid} style={{ display:'inline-flex', alignItems:'center', gap:6, background:'rgba(16,185,129,0.1)', color:'var(--accent-green)', padding:'3px 10px', borderRadius:99, fontSize:'0.75rem', fontFamily:'monospace', border:'1px solid rgba(16,185,129,0.2)' }}>
                  {cid}
                  <button onClick={() => removeCompany(cid)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--accent-red)', fontSize:'0.8rem', padding:0 }}>✕</button>
                </span>
              ))}
            </div>
          ) : (
            <div style={{ fontSize:'0.78rem', color:'var(--text-muted)', marginBottom:10 }}>
              ⚠️ No companies on allow list. {account.filter_mode==='allow_list'?'ALL ACH debits will be blocked.':'All ACH debits will be flagged as exceptions.'}
            </div>
          )}
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <input className="form-input" style={{ width:160 }} placeholder="Company ID (10 chars)" value={newCoId} onChange={e => setNewCoId(e.target.value.toUpperCase())} maxLength={10} />
            <input className="form-input" style={{ width:180 }} placeholder="Company Name" value={newCoName} onChange={e => setNewCoName(e.target.value)} />
            <input className="form-input" style={{ width:120 }} type="number" placeholder="Max $ (optional)" value={newMaxAmt} onChange={e => setNewMaxAmt(e.target.value)} />
            <button className="btn btn-primary btn-sm" onClick={addCompany} disabled={addingCo || !newCoId.trim()}>
              {addingCo ? '…' : '+ Add'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AccountManager() {
  const [accounts, setAccounts] = useState([]);
  const [loading,  setLoading]  = useState(true);

  const load = () => {
    setLoading(true);
    accountsApi.getAll().then(r => setAccounts(r.data||[])).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="page-header">
        <h2>🏦 Account ACH Filter Settings</h2>
        <p>Configure per-account fraud protection mode: Positive Pay · ACH Allow List · Debit Block · Reverse Positive Pay</p>
      </div>

      {/* Mode explanation */}
      <div className="card" style={{ marginBottom:24 }}>
        <div className="card-title">🛡️ Protection Modes Explained</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:12, marginTop:12 }}>
          {FILTER_MODES.map(m => {
            const c = { positive_pay:'var(--accent-blue)', allow_list:'var(--accent-green)', block_all:'var(--accent-red)', reverse_positive_pay:'var(--accent-purple)' }[m.value];
            return (
              <div key={m.value} style={{ padding:'12px 14px', background:'var(--bg-primary)', borderRadius:8, border:`1px solid ${c}25` }}>
                <div style={{ fontWeight:700, color:c, fontSize:'0.82rem', marginBottom:4 }}>{m.label}</div>
                <div style={{ fontSize:'0.72rem', color:'var(--text-secondary)', lineHeight:1.5 }}>{m.desc}</div>
              </div>
            );
          })}
        </div>
      </div>

      {loading
        ? <div className="loading-center"><div className="spinner" /></div>
        : accounts.map(a => <AccountCard key={a.account_id} account={a} onRefresh={load} />)
      }
    </div>
  );
}
