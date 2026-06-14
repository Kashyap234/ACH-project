// frontend/src/components/TransactionDetailModal.jsx
// Reusable read-only transaction detail modal.
// Used from: AuditLog, Dashboard (recent activity), Analytics (patterns), ReviewQueue (locked view).
import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { transactionsApi } from '../api/client';

const STATUS_CONFIG = {
  auto_approved: { icon: '🤖', color: 'var(--accent-green)',  label: 'Auto-Approved (AI)'   },
  approved:      { icon: '✅', color: 'var(--accent-green)',  label: 'Approved'              },
  declined:      { icon: '🚫', color: 'var(--accent-red)',    label: 'Declined'              },
  under_review:  { icon: '⏳', color: 'var(--accent-yellow)', label: 'Under Review'          },
  pending:       { icon: '📋', color: 'var(--accent-blue)',   label: 'Pending'               },
};

const EVENT_ICONS = {
  transaction_created: '📥',
  auto_approved:       '🤖',
  ai_processed:        '🧠',
  human_approved:      '✅',
  human_declined:      '🚫',
  human_reviewed:      '👤',
  pattern_promoted:    '🚀',
  pattern_demoted:     '⬇️',
  risk_flagged:        '⚠️',
};

function Field({ label, value, color, mono }) {
  if (!value && value !== 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: '0.82rem', fontWeight: 600, color: color || 'var(--text-primary)', fontFamily: mono ? 'monospace' : 'inherit', wordBreak: 'break-all' }}>{value}</div>
    </div>
  );
}

function RiskMeter({ score }) {
  const color = score >= 70 ? '#ef4444' : score >= 30 ? '#f59e0b' : '#10b981';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', marginBottom: 4 }}>
        <span style={{ color: 'var(--text-muted)' }}>Risk Score</span>
        <span style={{ color, fontWeight: 700 }}>{score}/100</span>
      </div>
      <div style={{ background: 'var(--bg-primary)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
        <div style={{ width: `${score}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  );
}

export default function TransactionDetailModal({ transactionId, onClose }) {
  const [txn,     setTxn]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [tab,     setTab]     = useState('overview');

  useEffect(() => {
    if (!transactionId) return;
    setLoading(true);
    setError(null);
    transactionsApi.getById(transactionId)
      .then(res => setTxn(res.data))
      .catch(e  => setError(e.message))
      .finally(() => setLoading(false));
  }, [transactionId]);

  if (!transactionId) return null;

  const statusConf = txn ? (STATUS_CONFIG[txn.status] || STATUS_CONFIG.pending) : null;
  const flags      = txn ? (Array.isArray(txn.risk_flags) ? txn.risk_flags : JSON.parse(txn.risk_flags || '[]')) : [];
  const auditLogs  = txn?.audit_logs || [];
  const hasAiBrief = !!(txn?.ai_brief || txn?.compliance_notes);

  const tabs = [
    { id: 'overview',  label: '📋 Overview'    },
    { id: 'ai',        label: '🤖 AI Brief',    dot: hasAiBrief },
    { id: 'flags',     label: `⚠️ Flags (${flags.length})` },
    { id: 'audit',     label: `📜 Audit (${auditLogs.length})` },
  ];

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 800, width: '95vw' }}>

        {/* Header */}
        <div className="modal-header">
          <div>
            {txn && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: '1.1rem' }}>{statusConf.icon}</span>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: statusConf.color, background: `${statusConf.color}20`, padding: '2px 10px', borderRadius: 99 }}>
                  {statusConf.label}
                </span>
                <span className={`risk-badge level-${txn.risk_level}`}>Level {txn.risk_level}</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--accent-cyan)', fontFamily: 'monospace' }}>{txn.sec_code}</span>
              </div>
            )}
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>
              {txn?.company_name || transactionId}
            </h3>
            {txn && (
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
                {txn.transaction_id} · {txn.sec_code} · {txn.routing_number} → {txn.account_number}
              </div>
            )}
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {loading && (
            <div className="loading-center" style={{ padding: '40px 0' }}>
              <div className="spinner" />
              <p>Loading transaction…</p>
            </div>
          )}

          {error && (
            <div style={{ padding: '20px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, color: 'var(--accent-red)', fontSize: '0.85rem' }}>
              ❌ Failed to load: {error}
            </div>
          )}

          {txn && (
            <>
              {/* Status banner for final states */}
              {['approved', 'declined', 'auto_approved'].includes(txn.status) && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                  background: `${statusConf.color}15`, border: `1px solid ${statusConf.color}40`,
                  borderRadius: 10, marginBottom: 16,
                }}>
                  <span style={{ fontSize: '1.5rem' }}>{statusConf.icon}</span>
                  <div>
                    <div style={{ fontWeight: 700, color: statusConf.color, fontSize: '0.9rem' }}>
                      {statusConf.label}
                    </div>
                    {txn.reviewer_name && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
                        Decided by <strong style={{ color: 'var(--text-secondary)' }}>{txn.reviewer_name}</strong>
                        {txn.reviewer_role && <span> ({txn.reviewer_role})</span>}
                        {txn.decision_at && <span> · {new Date(txn.decision_at).toLocaleString()}</span>}
                      </div>
                    )}
                    {txn.status === 'auto_approved' && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
                        🤖 Zero-touch AI processing · Risk Score: {txn.risk_score}/100
                      </div>
                    )}
                    {txn.reviewer_notes && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4, fontStyle: 'italic' }}>
                        "{txn.reviewer_notes}"
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Tabs */}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 16 }}>
                {tabs.map(t => (
                  <button key={t.id} type="button"
                    className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setTab(t.id)}
                    style={{ position: 'relative' }}>
                    {t.label}
                    {t.dot && tab !== t.id && (
                      <span style={{ position: 'absolute', top: 4, right: 4, width: 6, height: 6, background: 'var(--accent-green)', borderRadius: '50%' }} />
                    )}
                  </button>
                ))}
              </div>

              {/* ── OVERVIEW TAB ─────────────────────────────────── */}
              {tab === 'overview' && (
                <>
                  <RiskMeter score={txn.risk_score} />

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 16 }}>
                    <div style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '10px 14px' }}>
                      <Field label="Amount" value={`${txn.transaction_type === 'debit' ? '-' : '+'}$${Number(txn.amount).toLocaleString()}`}
                        color={txn.transaction_type === 'debit' ? 'var(--accent-red)' : 'var(--accent-green)'} />
                    </div>
                    <div style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '10px 14px' }}>
                      <Field label="SEC Code" value={txn.sec_code} color="var(--accent-cyan)" mono />
                    </div>
                    <div style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '10px 14px' }}>
                      <Field label="Transaction Code" value={txn.transaction_code || '—'} color="var(--text-secondary)" mono />
                    </div>
                    <div style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '10px 14px' }}>
                      <Field label="Routing Number" value={txn.routing_number || txn.rdfi_routing} mono />
                    </div>
                    <div style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '10px 14px' }}>
                      <Field label="Account Number" value={txn.account_number} mono />
                    </div>
                    <div style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '10px 14px' }}>
                      <Field label="Effective Date" value={txn.effective_date} />
                    </div>
                    <div style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '10px 14px' }}>
                      <Field label="Authorization Type" value={txn.authorization_type || '—'} color={txn.authorization_type ? 'var(--accent-blue)' : 'var(--accent-yellow)'} />
                    </div>
                    <div style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '10px 14px' }}>
                      <Field label="Company ID" value={txn.company_id} mono />
                    </div>
                    <div style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '10px 14px' }}>
                      <Field label="Trace Number" value={txn.trace_number || '—'} mono />
                    </div>
                    <div style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '10px 14px' }}>
                      <Field label="OFAC Screened" value={txn.ofac_screened ? '✅ Yes' : '⚠️ No'} color={txn.ofac_screened ? 'var(--accent-green)' : 'var(--accent-yellow)'} />
                    </div>
                    <div style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '10px 14px' }}>
                      <Field label="AML Flag" value={txn.aml_flag ? '🔴 Flagged' : '🟢 Clear'} color={txn.aml_flag ? 'var(--accent-red)' : 'var(--accent-green)'} />
                    </div>
                    <div style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '10px 14px' }}>
                      <Field label="Entry Description" value={txn.entry_description || txn.company_entry_description || '—'} />
                    </div>
                  </div>

                  {txn.return_reason_code && (
                    <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, fontSize: '0.82rem', color: 'var(--accent-red)' }}>
                      ↩ Return Code: <strong>{txn.return_reason_code}</strong>
                      {txn.return_code_info && <span> — {txn.return_code_info.description}</span>}
                    </div>
                  )}
                </>
              )}

              {/* ── AI BRIEF TAB ─────────────────────────────────── */}
              {tab === 'ai' && (
                hasAiBrief ? (
                  <div className="ai-brief-panel">
                    <div className="ai-brief-content">
                      <ReactMarkdown>{txn.ai_brief || txn.compliance_notes}</ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  <div className="empty-state" style={{ padding: '30px 0' }}>
                    <div className="empty-icon">🤖</div>
                    <p>No AI brief available for this transaction.</p>
                  </div>
                )
              )}

              {/* ── FLAGS TAB ────────────────────────────────────── */}
              {tab === 'flags' && (
                flags.length === 0 ? (
                  <div className="empty-state" style={{ padding: '30px 0' }}>
                    <div className="empty-icon">✅</div>
                    <p>No risk flags triggered — clean transaction.</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {flags.map(f => (
                      <div key={f.rule_code} style={{
                        display: 'flex', gap: 12, alignItems: 'flex-start',
                        padding: '12px 14px', borderRadius: 8, background: 'var(--bg-primary)',
                        borderLeft: `3px solid ${f.severity === 'critical' ? 'var(--accent-red)' : f.severity === 'warning' ? 'var(--accent-yellow)' : 'var(--accent-blue)'}`,
                      }}>
                        <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>
                          {f.severity === 'critical' ? '🔴' : f.severity === 'warning' ? '🟡' : '🔵'}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--accent-cyan)', fontWeight: 700 }}>{f.rule_code}</span>
                            <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{f.rule_name}</span>
                            <span className={`flag-pill ${f.severity}`} style={{ fontSize: '0.65rem' }}>{f.severity?.toUpperCase()}</span>
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>{f.description}</div>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                            Category: {f.category} · Weight: {f.weight}x · Flag Level: L{f.flag_level}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}

              {/* ── AUDIT TRAIL TAB ──────────────────────────────── */}
              {tab === 'audit' && (
                auditLogs.length === 0 ? (
                  <div className="empty-state" style={{ padding: '30px 0' }}>
                    <div className="empty-icon">📋</div>
                    <p>No audit events yet.</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {auditLogs.map((log, i) => (
                      <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 14px', background: 'var(--bg-primary)', borderRadius: 8 }}>
                        <div style={{ fontSize: '1.2rem', flexShrink: 0 }}>{EVENT_ICONS[log.event_type] || '📌'}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-primary)' }}>{log.event_summary}</div>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2 }}>
                            {log.actor && <span>{log.actor} · </span>}
                            {new Date(log.created_at).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}
            </>
          )}
        </div>

        <div className="modal-footer" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
