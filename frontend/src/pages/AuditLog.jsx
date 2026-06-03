// frontend/src/pages/AuditLog.jsx
import { useState, useEffect } from 'react';
import { analyticsApi } from '../api/client';

const EVENT_META = {
  transaction_created: { icon: '📥', color: 'var(--accent-blue)',   label: 'Created'         },
  auto_approved:       { icon: '✅', color: 'var(--accent-green)',  label: 'Auto-Approved'   },
  ai_processed:        { icon: '🤖', color: 'var(--accent-purple)', label: 'AI Processed'    },
  human_approved:      { icon: '✅', color: 'var(--accent-green)',  label: 'Human Approved'  },
  human_declined:      { icon: '❌', color: 'var(--accent-red)',    label: 'Human Declined'  },
  human_reviewed:      { icon: '👤', color: 'var(--accent-cyan)',   label: 'Human Review'    },
  pattern_promoted:    { icon: '🚀', color: 'var(--accent-green)',  label: 'Pattern Promoted'},
  pattern_demoted:     { icon: '⬇️', color: 'var(--accent-red)',    label: 'Pattern Demoted' },
  risk_flagged:        { icon: '⚠️', color: 'var(--accent-yellow)', label: 'Risk Flagged'    },
  rule_updated:        { icon: '📝', color: 'var(--accent-blue)',   label: 'Rule Updated'    },
  user_registered:     { icon: '👤', color: 'var(--accent-cyan)',   label: 'User Registered' },
  user_login:          { icon: '🔐', color: 'var(--text-muted)',    label: 'User Login'      },
};

export default function AuditLog() {
  const [logs, setLogs]     = useState([]);
  const [total, setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage]     = useState(0);
  const [filter, setFilter] = useState('');
  const LIMIT = 20;

  const load = (p = 0, f = filter) => {
    setLoading(true);
    analyticsApi.audit({ limit: LIMIT, offset: p * LIMIT })
      .then(res => {
        let data = res.data || [];
        if (f) data = data.filter(l => l.event_type === f);
        setLogs(data);
        setTotal(res.total || 0);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(0, filter); setPage(0); }, [filter]);

  const handlePage = (p) => { setPage(p); load(p, filter); };

  return (
    <div>
      <div className="page-header">
        <h2>📋 Audit Log</h2>
        <p>Immutable record of all system events — AI decisions, human reviews, and learning updates</p>
      </div>

      {/* Filter Toolbar */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:20, alignItems:'center' }}>
        <button className={`btn btn-sm ${!filter ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter('')}>All Events</button>
        {Object.entries(EVENT_META).map(([key, { icon, label }]) => (
          <button key={key} className={`btn btn-sm ${filter === key ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter(key)}>
            {icon} {label}
          </button>
        ))}
        <button className="btn btn-ghost btn-sm" style={{ marginLeft:'auto' }} onClick={() => load(page, filter)}>↻ Refresh</button>
      </div>

      {loading ? (
        <div className="loading-center"><div className="spinner" /><p>Loading audit log…</p></div>
      ) : logs.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">📭</div><p>No audit events yet. Submit a transaction to get started.</p></div>
      ) : (
        <>
          <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:20 }}>
            {logs.map((log, i) => {
              const meta = EVENT_META[log.event_type] || { icon:'📌', color:'var(--text-secondary)', label: log.event_type };
              return (
                <div key={log.id} style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:10, padding:'14px 18px', display:'flex', gap:14, alignItems:'flex-start' }}>
                  {/* Timeline dot */}
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', flexShrink:0, width:24 }}>
                    <div style={{ fontSize:'1.1rem' }}>{meta.icon}</div>
                    {i < logs.length - 1 && <div style={{ width:1, flex:1, background:'var(--border)', marginTop:6, minHeight:16 }} />}
                  </div>

                  {/* Content */}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginBottom:4 }}>
                      <span style={{ fontSize:'0.72rem', fontWeight:700, color: meta.color, background: `${meta.color}15`, padding:'2px 8px', borderRadius:99 }}>
                        {meta.label}
                      </span>
                      {/* Actor: show exact reviewer name for human decisions */}
                      {log.actor === 'AI' || log.actor === 'SYSTEM' ? (
                        <span style={{ fontSize:'0.72rem', color:'var(--accent-purple)' }}>🤖 AI System</span>
                      ) : log.actor ? (
                        <span style={{ fontSize:'0.72rem', color:'var(--accent-cyan)', display:'flex', alignItems:'center', gap:4 }}>
                          👤 <strong style={{ color:'var(--text-primary)' }}>{log.actor}</strong>
                          {log.event_data?.reviewer_role && (
                            <span style={{ fontSize:'0.65rem', background:'rgba(6,182,212,0.12)', color:'var(--accent-cyan)', padding:'1px 6px', borderRadius:99, textTransform:'uppercase', letterSpacing:'0.05em' }}>
                              {log.event_data.reviewer_role}
                            </span>
                          )}
                        </span>
                      ) : null}
                      {log.severity === 'critical' && <span style={{ fontSize:'0.68rem', color:'var(--accent-red)', fontWeight:700 }}>⚡ CRITICAL</span>}
                      {log.severity === 'warning'  && <span style={{ fontSize:'0.68rem', color:'var(--accent-yellow)', fontWeight:700 }}>⚠ WARNING</span>}
                    </div>

                    <div style={{ fontSize:'0.85rem', color:'var(--text-primary)', fontWeight:500 }}>{log.event_summary}</div>

                    {log.transaction_id && (
                      <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', marginTop:3 }}>
                        <span className="monospace">{log.transaction_id}</span>
                        {log.company_name && ` · ${log.company_name}`}
                        {log.amount && ` · $${Number(log.amount).toLocaleString()}`}
                      </div>
                    )}

                    {/* Event data */}
                    {log.event_data && Object.keys(log.event_data).length > 0 && (
                      <div style={{ marginTop:6, display:'flex', gap:8, flexWrap:'wrap' }}>
                        {Object.entries(log.event_data).slice(0,4).map(([k, v]) => (
                          <span key={k} style={{ fontSize:'0.68rem', background:'var(--bg-primary)', color:'var(--text-muted)', padding:'2px 6px', borderRadius:4 }}>
                            {k}: <span style={{ color:'var(--text-secondary)' }}>{String(v)}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Timestamp */}
                  <div style={{ fontSize:'0.7rem', color:'var(--text-muted)', flexShrink:0, textAlign:'right' }}>
                    <div>{new Date(log.created_at).toLocaleDateString()}</div>
                    <div style={{ marginTop:2 }}>{new Date(log.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' })}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontSize:'0.8rem', color:'var(--text-muted)' }}>
              Showing {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} of {total} events
            </span>
            <div style={{ display:'flex', gap:8 }}>
              <button className="btn btn-ghost btn-sm" disabled={page === 0} onClick={() => handlePage(page - 1)}>← Prev</button>
              <button className="btn btn-ghost btn-sm" disabled={(page + 1) * LIMIT >= total} onClick={() => handlePage(page + 1)}>Next →</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
