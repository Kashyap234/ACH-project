// frontend/src/pages/ExceptionDashboard.jsx
// Exceptions view with countdown timers, pay/return decisions, default action info
import { useState, useEffect, useCallback } from 'react';
import { exceptionsApi } from '../api/client';

function Countdown({ msRemaining, isPastDue, cutoffTime }) {
  const [ms, setMs] = useState(msRemaining);
  useEffect(() => {
    if (isPastDue) return;
    const t = setInterval(() => setMs(p => Math.max(0, p - 1000)), 1000);
    return () => clearInterval(t);
  }, [isPastDue]);

  if (isPastDue) return <span style={{ color:'var(--accent-red)', fontWeight:700, fontSize:'0.78rem' }}>⏰ PAST DUE (cutoff {cutoffTime})</span>;

  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const color = ms < 3600000 ? 'var(--accent-red)' : ms < 7200000 ? 'var(--accent-yellow)' : 'var(--accent-green)';
  return (
    <div>
      <div style={{ fontSize:'0.65rem', color:'var(--text-muted)', marginBottom:2 }}>Cutoff: {cutoffTime}</div>
      <span style={{ color, fontWeight:700, fontFamily:'monospace', fontSize:'1rem' }}>
        {h > 0 ? `${h}h ` : ''}{String(m).padStart(2,'0')}:{String(s).padStart(2,'0')}
      </span>
    </div>
  );
}

function ExceptionRow({ exc, onDecide }) {
  const [deciding, setDeciding] = useState(null);
  const flags = Array.isArray(exc.risk_flags) ? exc.risk_flags : JSON.parse(exc.risk_flags || '[]');

  const decide = async (decision) => {
    setDeciding(decision);
    await onDecide(exc.transaction_id, decision);
    setDeciding(null);
  };

  return (
    <tr style={{ background: exc.is_past_due ? 'rgba(239,68,68,0.04)' : undefined }}>
      <td>
        <div style={{ fontSize:'0.72rem', fontFamily:'monospace', color:'var(--accent-cyan)' }}>{exc.transaction_id}</div>
        <div style={{ fontSize:'0.68rem', color:'var(--text-muted)' }}>{exc.sec_code} · {exc.filter_mode?.replace(/_/g,' ')}</div>
      </td>
      <td>
        <div style={{ fontWeight:500, fontSize:'0.82rem' }}>{exc.company_name}</div>
        <div style={{ fontSize:'0.7rem', color:'var(--text-muted)' }}>{exc.company_id}</div>
      </td>
      <td>
        <div style={{ fontWeight:700, color: exc.transaction_type==='debit'?'var(--accent-red)':'var(--accent-green)', fontSize:'0.9rem' }}>
          {exc.transaction_type==='debit'?'-':'+'}${Number(exc.amount).toLocaleString()}
        </div>
      </td>
      <td><span className={`risk-badge level-${exc.risk_level}`}>L{exc.risk_level}</span></td>
      <td>
        {flags.slice(0,2).map(f => (
          <span key={f.rule_code} className={`flag-pill ${f.severity}`} style={{ fontSize:'0.62rem', marginRight:3, display:'inline-flex' }}>
            {f.rule_code}
          </span>
        ))}
        {flags.length > 2 && <span style={{ fontSize:'0.65rem', color:'var(--text-muted)' }}>+{flags.length-2}</span>}
      </td>
      <td>
        <Countdown msRemaining={exc.ms_remaining} isPastDue={exc.is_past_due} cutoffTime={exc.cutoff_time} />
      </td>
      <td>
        <div style={{ fontSize:'0.72rem', color:'var(--text-muted)' }}>
          Default: <strong style={{ color: exc.default_action==='pay'?'var(--accent-green)':'var(--accent-red)' }}>
            {exc.default_action?.toUpperCase()}
          </strong>
        </div>
      </td>
      <td>
        <div style={{ display:'flex', gap:6 }}>
          <button className="btn btn-success btn-sm" style={{ fontSize:'0.72rem', padding:'5px 12px' }}
            onClick={() => decide('pay')} disabled={deciding !== null}>
            {deciding==='pay' ? '…' : '✅ Pay'}
          </button>
          <button className="btn btn-danger btn-sm" style={{ fontSize:'0.72rem', padding:'5px 12px' }}
            onClick={() => decide('return')} disabled={deciding !== null}>
            {deciding==='return' ? '…' : '↩ Return'}
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function ExceptionDashboard({ onDecision }) {
  const [data,      setData]      = useState({ data:[], summary:{} });
  const [loading,   setLoading]   = useState(true);
  const [applying,  setApplying]  = useState(false);
  const [lastUpdate,setLastUpdate]= useState(null);

  const load = useCallback(() => {
    setLoading(true);
    exceptionsApi.getAll()
      .then(r => { setData(r); setLastUpdate(new Date()); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  const decide = async (txnId, decision) => {
    await exceptionsApi.decide(txnId, decision);
    load(); onDecision?.();
  };

  const applyDefaults = async () => {
    setApplying(true);
    const res = await exceptionsApi.applyDefaults().catch(e => ({ message: e.message }));
    alert(res.message);
    load(); onDecision?.();
    setApplying(false);
  };

  const { data: exceptions = [], summary = {} } = data;
  const pastDue = exceptions.filter(e => e.is_past_due);
  const urgent  = exceptions.filter(e => !e.is_past_due && e.ms_remaining < 3600000);
  const safe    = exceptions.filter(e => !e.is_past_due && e.ms_remaining >= 3600000);

  return (
    <div>
      <div className="page-header">
        <h2>⚡ Exception Dashboard</h2>
        <p>All transactions requiring a Pay or Return decision before their account cutoff deadline · Auto-refreshes every 30s</p>
      </div>

      {/* Summary KPI strip */}
      <div className="stats-grid" style={{ marginBottom:20 }}>
        {[
          { label:'Total Exceptions', value: summary.total||0,    color:'--accent-blue',   icon:'📋' },
          { label:'Past Due',         value: summary.past_due||0, color:'--accent-red',    icon:'⏰' },
          { label:'Urgent (<1hr)',    value: summary.urgent||0,   color:'--accent-yellow', icon:'⚠️' },
          { label:'Safe (>1hr)',      value: summary.safe||0,     color:'--accent-green',  icon:'✅' },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ '--accent-color': `var(${s.color})` }}>
            <div className="stat-label">{s.label}</div>
            <div className="stat-value" style={{ color:`var(${s.color})` }}>{s.value}</div>
            <div className="stat-icon">{s.icon}</div>
          </div>
        ))}
      </div>

      {/* Explanation banner */}
      <div className="card" style={{ marginBottom:20, borderColor:'rgba(59,130,246,0.2)', background:'rgba(59,130,246,0.05)' }}>
        <div style={{ display:'flex', gap:12, alignItems:'flex-start', fontSize:'0.82rem', color:'var(--text-secondary)' }}>
          <div style={{ fontSize:'1.5rem' }}>ℹ️</div>
          <div>
            <strong style={{ color:'var(--text-primary)' }}>How Positive Pay Exceptions Work</strong>
            <p style={{ marginTop:4 }}>Each account has a <strong>cutoff time</strong> (typically 12:00 PM – 3:00 PM). If you don't make a Pay/Return decision before the deadline, the system applies the account's pre-configured <strong>Default Action</strong>. For Reverse Positive Pay accounts, ALL incoming transactions appear here — not just flagged ones.</p>
          </div>
        </div>
      </div>

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div style={{ fontSize:'0.8rem', color:'var(--text-muted)' }}>
          Last updated: {lastUpdate?.toLocaleTimeString() || '—'}
        </div>
        <div style={{ display:'flex', gap:8 }}>
          {pastDue.length > 0 && (
            <button className="btn btn-danger btn-sm" onClick={applyDefaults} disabled={applying}>
              {applying ? '…' : `⏰ Apply ${pastDue.length} Defaults Now`}
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>↻ Refresh</button>
        </div>
      </div>

      {/* Past Due */}
      {pastDue.length > 0 && (
        <div style={{ marginBottom:16 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
            <div style={{ width:10, height:10, borderRadius:'50%', background:'var(--accent-red)', boxShadow:'0 0 8px var(--accent-red)' }} />
            <span style={{ fontWeight:700, color:'var(--accent-red)', fontSize:'0.875rem' }}>PAST DUE — Default action will be applied</span>
          </div>
          <div className="table-wrapper">
            <table>
              <thead><tr><th>Transaction</th><th>Company</th><th>Amount</th><th>Risk</th><th>Flags</th><th>Deadline</th><th>Default</th><th>Action</th></tr></thead>
              <tbody>{pastDue.map(e => <ExceptionRow key={e.exception_id} exc={e} onDecide={decide} />)}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* Urgent */}
      {urgent.length > 0 && (
        <div style={{ marginBottom:16 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
            <div style={{ width:10, height:10, borderRadius:'50%', background:'var(--accent-yellow)' }} />
            <span style={{ fontWeight:700, color:'var(--accent-yellow)', fontSize:'0.875rem' }}>URGENT — Less than 1 hour remaining</span>
          </div>
          <div className="table-wrapper">
            <table>
              <thead><tr><th>Transaction</th><th>Company</th><th>Amount</th><th>Risk</th><th>Flags</th><th>Deadline</th><th>Default</th><th>Action</th></tr></thead>
              <tbody>{urgent.map(e => <ExceptionRow key={e.exception_id} exc={e} onDecide={decide} />)}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* Safe */}
      {safe.length > 0 && (
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
            <div style={{ width:10, height:10, borderRadius:'50%', background:'var(--accent-green)' }} />
            <span style={{ fontWeight:700, color:'var(--accent-green)', fontSize:'0.875rem' }}>PENDING — Time remaining for review</span>
          </div>
          <div className="table-wrapper">
            <table>
              <thead><tr><th>Transaction</th><th>Company</th><th>Amount</th><th>Risk</th><th>Flags</th><th>Countdown</th><th>Default</th><th>Action</th></tr></thead>
              <tbody>{safe.map(e => <ExceptionRow key={e.exception_id} exc={e} onDecide={decide} />)}</tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && exceptions.length === 0 && (
        <div className="empty-state"><div className="empty-icon">🎉</div><p>No exceptions right now — all items reviewed or no pending transactions.</p></div>
      )}
    </div>
  );
}
