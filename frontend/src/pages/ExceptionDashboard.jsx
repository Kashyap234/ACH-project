// frontend/src/pages/ExceptionDashboard.jsx
// CHANGE: Extended to also show overdue MIR (More Information Required) SLA timeouts.
// The positive pay exception logic is preserved exactly.
// A new "🔄 Pending Info Requests" section is added below the existing exception table,
// showing any info requests that have passed their SLA deadline without a response.
import { useState, useEffect, useCallback } from 'react';
import { exceptionsApi, infoRequestsApi, transactionsApi } from '../api/client';

// ── Existing Countdown component (unchanged) ──────────────────────────────────
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

// ── MIR SLA Countdown ─────────────────────────────────────────────────────────
function MirCountdown({ msRemaining, isOverdue, slaDeadline }) {
  const [ms, setMs] = useState(msRemaining);
  useEffect(() => {
    if (isOverdue) return;
    const t = setInterval(() => setMs(p => Math.max(0, p - 1000)), 1000);
    return () => clearInterval(t);
  }, [isOverdue]);

  if (isOverdue) return (
    <div>
      <div style={{ color:'var(--accent-red)', fontWeight:700, fontSize:'0.78rem' }}>⏰ SLA OVERDUE</div>
      <div style={{ fontSize:'0.65rem', color:'var(--text-muted)' }}>Due: {slaDeadline}</div>
    </div>
  );

  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const color = ms < 3600000 ? 'var(--accent-red)' : ms < 7200000 ? 'var(--accent-yellow)' : 'var(--accent-green)';
  return (
    <div>
      <div style={{ fontSize:'0.65rem', color:'var(--text-muted)', marginBottom:2 }}>SLA: {slaDeadline}</div>
      <span style={{ color, fontWeight:700, fontFamily:'monospace', fontSize:'1rem' }}>
        {h > 0 ? `${h}h ` : ''}{String(m).padStart(2,'0')}:{String(s).padStart(2,'0')}
      </span>
    </div>
  );
}

// ── Existing ExceptionRow (unchanged) ─────────────────────────────────────────
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

// ── MIR SLA Row (NEW) ─────────────────────────────────────────────────────────
// Shows an overdue info request with options to escalate (force-decline) or
// open the transaction for human review/re-request.
function MirSlaRow({ req, txn, onAction }) {
  const [acting, setActing] = useState(null);
  const slaDate = new Date(req.sla_deadline_at);
  const msLeft  = slaDate - new Date();
  const isOverdue = msLeft < 0;
  const isAi = req.actor_type === 'AI_AUTOMATION';

  const handleEscalate = async () => {
    if (!window.confirm(`Escalate and auto-decline ${txn?.company_name || req.transaction_id} due to non-response?`)) return;
    setActing('escalate');
    await onAction(req.transaction_id, 'escalate');
    setActing(null);
  };

  return (
    <tr style={{ background: isOverdue ? 'rgba(239,68,68,0.04)' : 'rgba(245,158,11,0.03)' }}>
      <td>
        <div style={{ fontSize:'0.72rem', fontFamily:'monospace', color:'var(--accent-cyan)' }}>{req.transaction_id}</div>
        <div style={{ fontSize:'0.68rem', color:'var(--text-muted)', marginTop:2 }}>
          Round {req.round_number} · {req.request_id}
        </div>
        {isAi && (
          <div style={{ fontSize:'0.6rem', color:'var(--accent-purple)', marginTop:2 }}>🤖 AI_AUTOMATION</div>
        )}
      </td>
      <td>
        <div style={{ fontWeight:500, fontSize:'0.82rem' }}>{txn?.company_name || '—'}</div>
        <div style={{ fontSize:'0.7rem', color:'var(--text-muted)' }}>
          {req.category?.replace(/_/g, ' ')}
        </div>
      </td>
      <td>
        <div style={{ fontWeight:700, fontSize:'0.9rem', color: txn?.transaction_type==='debit'?'var(--accent-red)':'var(--accent-green)' }}>
          {txn ? `${txn.transaction_type==='debit'?'-':'+'}$${Number(txn.amount).toLocaleString()}` : '—'}
        </div>
      </td>
      <td>
        <MirCountdown
          msRemaining={Math.max(0, msLeft)}
          isOverdue={isOverdue}
          slaDeadline={slaDate.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}
        />
      </td>
      <td>
        <div style={{ fontSize:'0.7rem', color:'var(--text-muted)' }}>
          Requested: {new Date(req.created_at).toLocaleDateString()}
          {req.originator_email && <div style={{ color:'var(--text-muted)' }}>{req.originator_email}</div>}
        </div>
      </td>
      <td>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          <button className="btn btn-ghost btn-sm" style={{ fontSize:'0.72rem', padding:'5px 12px' }}
            onClick={() => onAction(req.transaction_id, 'view')} disabled={acting !== null}>
            👁 Review
          </button>
          {isOverdue && (
            <button className="btn btn-danger btn-sm" style={{ fontSize:'0.72rem', padding:'5px 12px' }}
              onClick={handleEscalate} disabled={acting !== null}>
              {acting==='escalate' ? '…' : '⬆ Escalate'}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Main ExceptionDashboard component ─────────────────────────────────────────
export default function ExceptionDashboard({ onDecision }) {
  const [data,      setData]      = useState({ data:[], summary:{} });
  const [mirData,   setMirData]   = useState([]);           // NEW: overdue MIR requests
  const [loading,   setLoading]   = useState(true);
  const [applying,  setApplying]  = useState(false);
  const [lastUpdate,setLastUpdate]= useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Load existing positive pay exceptions
      const excResult = await exceptionsApi.getAll().catch(() => ({ data:[], summary:{} }));
      setData(excResult);

      // Load pending MIR requests and enrich with transaction data
      const allTxns = await transactionsApi.getAll({ status: 'more_info_required', limit: 100 })
        .then(r => r.data || []).catch(() => []);

      const mirRequests = [];
      for (const txn of allTxns) {
        const reqs = await infoRequestsApi.listRequests(txn.transaction_id)
          .then(r => r.data || []).catch(() => []);
        // Get the latest pending request for this transaction
        const pending = reqs.filter(r => r.status === 'pending').slice(-1)[0];
        if (pending) {
          mirRequests.push({ ...pending, _txn: txn });
        }
      }
      setMirData(mirRequests);
      setLastUpdate(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  const decide = async (txnId, decision) => {
    await exceptionsApi.decide(txnId, decision);
    load(); onDecision?.();
  };

  const handleMirAction = async (txnId, action) => {
    if (action === 'view') {
      // Navigate to Review Queue filtered on this transaction
      window.location.href = '/queue';
      return;
    }
    if (action === 'escalate') {
      // Auto-decline the transaction due to non-response (supervisor escalation path)
      try {
        await transactionsApi.decide(txnId, 'decline', {
          decision_reason: 'AUTO-DECLINED: Originator failed to respond to information request within SLA window.',
          reviewer_confidence: 'HIGH',
          additional_notes: 'Escalated from Exception Dashboard — MIR SLA exceeded.',
        });
        load(); onDecision?.();
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }
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

  const mirOverdue = mirData.filter(r => new Date(r.sla_deadline_at) < new Date());
  const mirPending = mirData.filter(r => new Date(r.sla_deadline_at) >= new Date());

  return (
    <div>
      <div className="page-header">
        <h2>⚡ Exception Dashboard</h2>
        <p>Positive Pay exceptions + MIR SLA monitoring · Auto-refreshes every 30s</p>
      </div>

      {/* KPI strip — extended with MIR counts */}
      <div className="stats-grid" style={{ marginBottom:20 }}>
        {[
          { label:'Exceptions',       value: summary.total||0,      color:'--accent-blue',   icon:'📋' },
          { label:'Past Due',         value: summary.past_due||0,   color:'--accent-red',    icon:'⏰' },
          { label:'Urgent (<1hr)',    value: summary.urgent||0,     color:'--accent-yellow', icon:'⚠️' },
          { label:'Safe (>1hr)',      value: summary.safe||0,       color:'--accent-green',  icon:'✅' },
          { label:'MIR Overdue',      value: mirOverdue.length,     color:'--accent-red',    icon:'🔄' },
          { label:'MIR Pending',      value: mirPending.length,     color:'--accent-yellow', icon:'📨' },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ '--accent-color': `var(${s.color})` }}>
            <div className="stat-label">{s.label}</div>
            <div className="stat-value" style={{ color:`var(${s.color})` }}>{s.value}</div>
            <div className="stat-icon">{s.icon}</div>
          </div>
        ))}
      </div>

      {/* Explanation banner (unchanged) */}
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
              {applying ? '⏳ Applying…' : `⚡ Apply Defaults (${pastDue.length} past due)`}
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>↻ Refresh</button>
        </div>
      </div>

      {/* ── Positive Pay Exceptions Table (unchanged) ── */}
      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : exceptions.length === 0 ? (
        <div className="empty-state" style={{ marginBottom:32 }}>
          <div className="empty-icon">🎉</div>
          <p>No positive pay exceptions — all transactions decided.</p>
        </div>
      ) : (
        <div className="table-wrapper" style={{ marginBottom:32 }}>
          <table>
            <thead>
              <tr>
                <th>Transaction</th><th>Company</th><th>Amount</th>
                <th>Risk</th><th>Flags</th><th>Countdown</th><th>Default</th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              {[...pastDue, ...urgent, ...safe].map(exc => (
                <ExceptionRow key={exc.exception_id} exc={exc} onDecide={decide} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── MIR SLA Monitor (NEW) ─────────────────────────────────────── */}
      <div style={{ marginTop:8 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
          <h3 style={{ fontSize:'1rem', fontWeight:700, margin:0 }}>
            🔄 More Information Required — SLA Monitor
          </h3>
          <div style={{ fontSize:'0.78rem', color:'var(--text-muted)' }}>
            {mirData.length} pending · {mirOverdue.length} overdue
          </div>
        </div>

        <div className="card" style={{ marginBottom:16, borderColor:'rgba(245,158,11,0.2)', background:'rgba(245,158,11,0.03)' }}>
          <div style={{ display:'flex', gap:12, alignItems:'flex-start', fontSize:'0.82rem', color:'var(--text-secondary)' }}>
            <div style={{ fontSize:'1.5rem' }}>🔄</div>
            <div>
              <strong style={{ color:'var(--text-primary)' }}>How MIR SLA Monitoring Works</strong>
              <p style={{ marginTop:4 }}>
                When a reviewer requests additional information from an originator, the system sets an SLA deadline (default: 48 hours).
                If the originator doesn't respond in time, the transaction appears here as overdue.
                You can escalate (auto-decline) past-SLA transactions or navigate to the Review Queue to re-issue the request or decide manually.
                Transactions requested by <strong>AI_AUTOMATION</strong> are shown with a purple badge.
              </p>
            </div>
          </div>
        </div>

        {mirData.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📭</div>
            <p>No pending information requests — all originators have responded.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Transaction</th><th>Company / Category</th><th>Amount</th>
                  <th>SLA Countdown</th><th>Requested</th><th>Action</th>
                </tr>
              </thead>
              <tbody>
                {[...mirOverdue, ...mirPending].map((req, i) => (
                  <MirSlaRow
                    key={req.request_id || i}
                    req={req}
                    txn={req._txn}
                    onAction={handleMirAction}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}