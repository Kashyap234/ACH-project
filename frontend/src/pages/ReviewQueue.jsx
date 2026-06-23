// frontend/src/pages/ReviewQueue.jsx
// CHANGES for MIR feature:
//   1. FINAL_STATUSES + STATUS_CONFIG extended with 'more_info_required'
//   2. ReviewModal footer: added "🔄 Request More Info" button
//   3. New MirRequestPanel component (inline form to create info request)
//   4. New '🔄 History' tab in ReviewModal showing full request/response timeline
//   5. Queue filter buttons: added 'more_info_required' filter
//   6. Resubmission badge on table rows
// All existing UI / state / submit paths are preserved exactly.
import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { transactionsApi, infoRequestsApi } from '../api/client';
import TransactionDetailModal from '../components/TransactionDetailModal';

const FRAUD_INDICATORS = [
  'VELOCITY_SPIKE','ROUND_AMOUNT','UNUSUAL_HOUR','NEW_COUNTERPARTY',
  'BLACKLIST_MATCH','DEVICE_MISMATCH','IP_ANOMALY','AMOUNT_MISMATCH',
  'DUPLICATE_PATTERN','STRUCTURING','SANCTIONS_CONCERN','ACCOUNT_PROBE',
];

const RETURN_CODES_COMMON = [
  { code:'R02', label:'R02 – Account Closed' },
  { code:'R03', label:'R03 – No Account / Unable to Locate' },
  { code:'R04', label:'R04 – Invalid Account Number' },
  { code:'R05', label:'R05 – Unauthorized Debit (Consumer)' },
  { code:'R07', label:'R07 – Authorization Revoked' },
  { code:'R08', label:'R08 – Payment Stopped' },
  { code:'R10', label:'R10 – Customer Advises Not Authorized' },
  { code:'R13', label:'R13 – Invalid ACH Routing Number' },
  { code:'R16', label:'R16 – Account Frozen' },
  { code:'R29', label:'R29 – Corporate Advises Not Authorized' },
];

const MIR_CATEGORIES = [
  { value:'IDENTITY_VERIFICATION',          label:'🪪 Identity Verification' },
  { value:'AUTHORIZATION_PROOF',            label:'✍️ Authorization Proof' },
  { value:'BUSINESS_PURPOSE_CLARIFICATION', label:'📋 Business Purpose' },
  { value:'AMOUNT_DISCREPANCY',             label:'💰 Amount Discrepancy' },
  { value:'ACCOUNT_OWNERSHIP',              label:'🏦 Account Ownership' },
  { value:'SANCTIONS_REVIEW',               label:'🚨 Sanctions Review' },
  { value:'DUPLICATE_EXPLANATION',          label:'🔁 Duplicate Explanation' },
  { value:'CUSTOM',                         label:'✏️ Custom' },
];

const defaultReview = {
  decision_reason: '',
  identity_verified: false,
  identity_verification_method: '',
  counterparty_type: 'UNKNOWN',
  account_ownership_confirmed: false,
  fraud_indicators: [],
  risk_override_reason: '',
  escalation_level: 'none',
  escalation_reason: '',
  business_purpose: '',
  authorization_reviewed: false,
  authorization_type_confirmed: '',
  customer_contacted: false,
  customer_contact_outcome: '',
  recommended_return_code: '',
  return_code_reason: '',
  reviewer_confidence: 'MEDIUM',
  additional_notes: '',
};

// Extended to include MIR status
const FINAL_STATUSES = ['approved', 'declined', 'auto_approved'];
const ACTIVE_MIR = ['more_info_required'];  // Not final — still actionable

const STATUS_CONFIG = {
  auto_approved:      { icon: '🤖', color: 'var(--accent-green)',  label: 'Auto-Approved by AI' },
  approved:           { icon: '✅', color: 'var(--accent-green)',  label: 'Approved'             },
  declined:           { icon: '🚫', color: 'var(--accent-red)',    label: 'Declined'             },
  more_info_required: { icon: '🔄', color: 'var(--accent-yellow)', label: 'More Info Required'   },
  under_review:       { icon: '⏳', color: 'var(--accent-blue)',   label: 'Under Review'         },
};

function RiskMeter({ score }) {
  const color = score >= 70 ? '#ef4444' : score >= 30 ? '#f59e0b' : '#10b981';
  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.72rem', marginBottom:4 }}>
        <span style={{ color:'var(--text-muted)' }}>Risk Score</span>
        <span style={{ color, fontWeight:700 }}>{score}/100</span>
      </div>
      <div className="risk-score-bar">
        <div className={`risk-score-fill ${score>=70?'high':score>=30?'medium':'low'}`} style={{ width:`${score}%` }} />
      </div>
    </div>
  );
}

// ── MIR Request Panel ─────────────────────────────────────────────────────────
// Shown in the modal footer area when reviewer clicks "Request More Info".
// Submits to POST /api/transactions/:id/request-info.
function MirRequestPanel({ txn, onCancel, onSubmitted }) {
  const [category,        setCategory]        = useState('');
  const [message,         setMessage]         = useState('');
  const [originatorEmail, setOriginatorEmail] = useState(txn.originator_email || '');
  const [submitting,      setSubmitting]       = useState(false);
  const [error,           setError]            = useState('');

  const handleSubmit = async () => {
    if (!category) { setError('Please select an information category.'); return; }
    if (message.trim().length < 10) { setError('Please enter a message (minimum 10 characters).'); return; }
    setError('');
    setSubmitting(true);
    try {
      const result = await infoRequestsApi.createRequest(txn.transaction_id, {
        category,
        message: message.trim(),
        originator_email: originatorEmail.trim() || undefined,
      });
      onSubmitted(result);
    } catch (e) {
      setError(e.message || 'Failed to create info request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      padding: '18px 20px',
      background: 'rgba(245,158,11,0.06)',
      border: '1px solid rgba(245,158,11,0.25)',
      borderRadius: 10,
      marginTop: 12,
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>
        <span style={{ fontSize:'1.1rem' }}>🔄</span>
        <div>
          <div style={{ fontWeight:700, fontSize:'0.92rem', color:'var(--accent-yellow)' }}>Request More Information</div>
          <div style={{ fontSize:'0.72rem', color:'var(--text-muted)' }}>
            A secure portal link will be sent to the originator. The transaction will be paused until they respond.
          </div>
        </div>
      </div>

      {txn.resubmission_count > 0 && (
        <div style={{ padding:'8px 12px', background:'rgba(59,130,246,0.08)', borderRadius:6, marginBottom:12, fontSize:'0.78rem', color:'var(--accent-blue)' }}>
          ℹ️ This is a resubmission (round {(txn.info_request_rounds||0) + 1}).
          The originator has already responded {txn.resubmission_count}× previously.
        </div>
      )}

      <div className="form-grid" style={{ gridTemplateColumns:'1fr 1fr', gap:12 }}>
        <div className="form-group" style={{ gridColumn:'1 / -1' }}>
          <label className="form-label">Information Category <span style={{ color:'var(--accent-red)' }}>*</span></label>
          <select className="form-select" value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">— Select category —</option>
            {MIR_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ gridColumn:'1 / -1' }}>
          <label className="form-label">Message to Originator <span style={{ color:'var(--accent-red)' }}>*</span></label>
          <textarea
            className="form-input"
            rows={4}
            style={{ resize:'vertical' }}
            placeholder="Clearly explain what information is needed and why, without disclosing internal risk scores or system details…"
            value={message}
            onChange={e => setMessage(e.target.value)}
          />
          <div style={{ fontSize:'0.7rem', color:'var(--text-muted)', marginTop:3 }}>
            This message will be shown directly to the originator in the portal.
          </div>
        </div>
        <div className="form-group" style={{ gridColumn:'1 / -1' }}>
          <label className="form-label">Originator Email (for portal link)</label>
          <input
            type="email"
            className="form-input"
            placeholder="originator@example.com"
            value={originatorEmail}
            onChange={e => setOriginatorEmail(e.target.value)}
          />
          <div style={{ fontSize:'0.7rem', color:'var(--text-muted)', marginTop:3 }}>
            Leave blank to use the email on record. If no email is available, the portal URL will be logged to the server console.
          </div>
        </div>
      </div>

      {error && (
        <div style={{ padding:'8px 12px', background:'rgba(239,68,68,0.1)', borderRadius:6, color:'var(--accent-red)', fontSize:'0.8rem', marginTop:8 }}>
          ⚠️ {error}
        </div>
      )}

      <div style={{ display:'flex', gap:8, marginTop:14, justifyContent:'flex-end' }}>
        <button className="btn btn-ghost" onClick={onCancel} disabled={submitting}>Cancel</button>
        <button
          className="btn btn-warning"
          onClick={handleSubmit}
          disabled={submitting}
          style={{ background:'rgba(245,158,11,0.15)', color:'var(--accent-yellow)', border:'1px solid rgba(245,158,11,0.35)', fontWeight:700 }}
        >
          {submitting ? '…Sending' : '📤 Send Info Request'}
        </button>
      </div>
    </div>
  );
}

// ── MIR Timeline Tab ──────────────────────────────────────────────────────────
// Shows the full history of info requests + responses for a transaction.
function MirTimeline({ txnId }) {
  const [rounds,  setRounds]  = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    infoRequestsApi.listRequests(txnId)
      .then(r => setRounds(r.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [txnId]);

  if (loading) return <div style={{ padding:20, textAlign:'center' }}><div className="spinner" /></div>;
  if (rounds.length === 0) return (
    <div style={{ padding:24, textAlign:'center', color:'var(--text-muted)', fontSize:'0.85rem' }}>
      No information requests have been made for this transaction.
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      {rounds.map((round, idx) => {
        const isAi = round.actor_type === 'AI_AUTOMATION';
        const isPending   = round.status === 'pending';
        const isResponded = round.status === 'responded';
        const isExpired   = round.status === 'expired';

        return (
          <div key={round.request_id || idx} style={{
            border: '1px solid var(--border)',
            borderRadius: 10,
            overflow: 'hidden',
          }}>
            {/* Request header */}
            <div style={{
              padding: '10px 16px',
              background: isAi ? 'rgba(139,92,246,0.08)' : 'rgba(59,130,246,0.06)',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
            }}>
              <div>
                <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:3 }}>
                  <span style={{ fontSize:'0.7rem', fontWeight:700, color:'var(--text-muted)' }}>Round {round.round_number}</span>
                  <span style={{
                    fontSize: '0.65rem', fontWeight:700, padding:'2px 8px', borderRadius:99,
                    background: isAi ? 'rgba(139,92,246,0.15)' : 'rgba(59,130,246,0.12)',
                    color: isAi ? 'var(--accent-purple)' : 'var(--accent-blue)',
                  }}>
                    {isAi ? '🤖 AI_AUTOMATION' : `👤 ${round.requested_by_name || round.requested_by}`}
                  </span>
                  <span style={{
                    fontSize:'0.65rem', fontWeight:700, padding:'2px 8px', borderRadius:99,
                    background: isPending ? 'rgba(245,158,11,0.12)' : isResponded ? 'rgba(16,185,129,0.12)' : 'rgba(107,114,128,0.1)',
                    color: isPending ? 'var(--accent-yellow)' : isResponded ? 'var(--accent-green)' : 'var(--text-muted)',
                  }}>
                    {isPending ? '⏳ Pending' : isResponded ? '✅ Responded' : '⏰ Expired'}
                  </span>
                </div>
                <div style={{ fontSize:'0.78rem', fontWeight:600, color:'var(--text-primary)' }}>
                  {MIR_CATEGORIES.find(c => c.value === round.category)?.label || round.category}
                </div>
              </div>
              <div style={{ fontSize:'0.68rem', color:'var(--text-muted)', textAlign:'right' }}>
                <div>{new Date(round.created_at).toLocaleDateString()}</div>
                <div>{new Date(round.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}</div>
              </div>
            </div>

            {/* Request message */}
            <div style={{ padding:'12px 16px', borderBottom: isResponded ? '1px solid var(--border)' : 'none' }}>
              <div style={{ fontSize:'0.7rem', color:'var(--text-muted)', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.05em' }}>Request</div>
              <div style={{ fontSize:'0.82rem', color:'var(--text-secondary)', lineHeight:1.5 }}>{round.message}</div>
              {round.sla_deadline_at && isPending && (
                <div style={{ marginTop:8, fontSize:'0.7rem', color:'var(--accent-yellow)' }}>
                  ⏱ Response SLA: {new Date(round.sla_deadline_at).toLocaleString()}
                  {new Date(round.sla_deadline_at) < new Date() && (
                    <span style={{ color:'var(--accent-red)', fontWeight:700, marginLeft:8 }}>⚠ OVERDUE</span>
                  )}
                </div>
              )}
            </div>

            {/* Response (if exists) */}
            {isResponded && round.response_message && (
              <div style={{ padding:'12px 16px', background:'rgba(16,185,129,0.04)' }}>
                <div style={{ fontSize:'0.7rem', color:'var(--accent-green)', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.05em' }}>
                  Originator Response · {new Date(round.responded_at).toLocaleString()}
                </div>
                <div style={{ fontSize:'0.82rem', color:'var(--text-secondary)', lineHeight:1.5 }}>{round.response_message}</div>
                {round.link_opened_at && (
                  <div style={{ fontSize:'0.68rem', color:'var(--text-muted)', marginTop:6 }}>
                    🔗 Portal link opened: {new Date(round.link_opened_at).toLocaleString()}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Review Modal (updated) ────────────────────────────────────────────────────
function ReviewModal({ txn, onClose, onDecide }) {
  const [review, setReview] = useState(defaultReview);
  const [tab, setTab]       = useState('brief');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]     = useState(null);
  const [showMirPanel, setShowMirPanel] = useState(false);
  const [mirResult,    setMirResult]    = useState(null);
  const startTime = useRef(Date.now());

  const isLocked   = FINAL_STATUSES.includes(txn.status);
  const isMir      = txn.status === 'more_info_required';
  const statusConf = STATUS_CONFIG[txn.status] || STATUS_CONFIG['under_review'];
  const isResubmission = (txn.resubmission_count || 0) > 0;

  const flags = Array.isArray(txn.risk_flags) ? txn.risk_flags : JSON.parse(txn.risk_flags || '[]');
  const set    = (k, v) => setReview(r => ({ ...r, [k]: v }));

  const submit = async (decision) => {
    setSubmitting(true);
    try {
      const time_to_decide_seconds = Math.round((Date.now() - startTime.current) / 1000);
      await transactionsApi.decide(txn.transaction_id, decision, { ...review, time_to_decide_seconds });
      setDone(decision);
      setTimeout(() => { onDecide(); onClose(); }, 2000);
    } catch (e) { alert('Error: ' + e.message); }
    finally { setSubmitting(false); }
  };

  const handleMirSubmitted = (result) => {
    setMirResult(result);
    setShowMirPanel(false);
    setTab('history');
    onDecide(); // refresh queue to show new status
  };

  // Tabs: existing + new History tab
  const tabs = [
    { id:'brief',    label:'🤖 AI Brief'    },
    { id:'identity', label:'👤 Identity'    },
    { id:'fraud',    label:'🚨 Fraud Check' },
    { id:'business', label:'📋 Business'   },
    { id:'return',   label:'↩ Return Code' },
    { id:'history',  label:'🔄 MIR History' },
  ];

  const Sel = ({ label, k, options }) => (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <select className="form-select" value={review[k]} onChange={e => set(k, e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );

  const Check = ({ label, k, hint }) => (
    <div className="form-group">
      <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', padding:'10px 14px', background:'var(--bg-primary)', borderRadius:'var(--radius-sm)', border:'1px solid var(--border)' }}>
        <input type="checkbox" checked={review[k]} onChange={e => set(k, e.target.checked)} style={{ width:16, height:16, accentColor:'var(--accent-blue)' }} />
        <div>
          <div style={{ fontSize:'0.85rem', fontWeight:500 }}>{label}</div>
          {hint && <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', marginTop:1 }}>{hint}</div>}
        </div>
      </label>
    </div>
  );

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth:760, width:'95vw' }}>
        <div className="modal-header">
          <div>
            <div style={{ display:'flex', gap:8, marginBottom:4, flexWrap:'wrap' }}>
              <span className={`risk-badge level-${txn.risk_level}`}>Level {txn.risk_level}</span>
              <span className={`status-badge ${txn.status}`}>{txn.status?.replace(/_/g,' ').toUpperCase()}</span>
              <span style={{ fontSize:'0.72rem', color:'var(--accent-cyan)', fontFamily:'monospace' }}>{txn.sec_code}</span>
              {isResubmission && (
                <span style={{ fontSize:'0.7rem', fontWeight:700, padding:'2px 10px', borderRadius:99, background:'rgba(245,158,11,0.15)', color:'var(--accent-yellow)' }}>
                  🔄 Resubmission #{txn.resubmission_count}
                </span>
              )}
              {(txn.info_request_rounds || 0) > 0 && (
                <span style={{ fontSize:'0.7rem', fontWeight:700, padding:'2px 10px', borderRadius:99, background:'rgba(139,92,246,0.12)', color:'var(--accent-purple)' }}>
                  {txn.info_request_rounds} MIR Round{txn.info_request_rounds > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <h3 style={{ fontSize:'1.05rem', fontWeight:700 }}>{txn.company_name}</h3>
            <div style={{ fontSize:'0.72rem', color:'var(--text-muted)' }}>
              {txn.transaction_id} · ${Number(txn.amount).toLocaleString()} {txn.transaction_type} · {txn.routing_number} → {txn.account_number}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">

          {/* ── LOCKED VIEW ────────────────────────────────────────── */}
          {isLocked ? (
            <>
              <div style={{
                display:'flex', alignItems:'center', gap:14, padding:'14px 18px',
                background:`${statusConf.color}15`, border:`1px solid ${statusConf.color}40`,
                borderRadius:10, marginBottom:18,
              }}>
                <div style={{ fontSize:'2.5rem' }}>{statusConf.icon}</div>
                <div>
                  <div style={{ fontWeight:700, color:statusConf.color }}>{statusConf.label}</div>
                  {txn.reviewer_name && <div style={{ fontSize:'0.78rem', color:'var(--text-muted)' }}>Reviewed by {txn.reviewer_name}</div>}
                  {txn.decision_at   && <div style={{ fontSize:'0.75rem', color:'var(--text-muted)' }}>{new Date(txn.decision_at).toLocaleString()}</div>}
                </div>
              </div>
              {txn.ai_brief && (
                <div style={{ background:'var(--bg-primary)', borderRadius:8, padding:'12px 16px', fontSize:'0.82rem' }}>
                  <ReactMarkdown>{txn.ai_brief}</ReactMarkdown>
                </div>
              )}
            </>
          ) : isMir && !showMirPanel ? (
            /* ── MIR WAITING STATE ──────────────────────────────── */
            <>
              <div style={{
                display:'flex', alignItems:'center', gap:14, padding:'14px 18px',
                background:'rgba(245,158,11,0.06)', border:'1px solid rgba(245,158,11,0.25)',
                borderRadius:10, marginBottom:18,
              }}>
                <div style={{ fontSize:'2.5rem' }}>🔄</div>
                <div>
                  <div style={{ fontWeight:700, color:'var(--accent-yellow)' }}>Waiting for Originator Response</div>
                  <div style={{ fontSize:'0.78rem', color:'var(--text-muted)', marginTop:2 }}>
                    A portal link has been sent. You can approve, decline, or request more information again once the response arrives.
                  </div>
                  {txn.last_info_request_id && (
                    <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', marginTop:4, fontFamily:'monospace' }}>
                      Last request: {txn.last_info_request_id}
                    </div>
                  )}
                </div>
              </div>
              <MirTimeline txnId={txn.transaction_id} />
            </>
          ) : done ? (
            /* ── DECISION CONFIRMED ──────────────────────────────── */
            <div style={{ textAlign:'center', padding:'40px 0' }}>
              <div style={{ fontSize:'3rem', marginBottom:12 }}>{done==='approve'?'✅':'🚫'}</div>
              <div style={{ fontSize:'1.1rem', fontWeight:700, color: done==='approve'?'var(--accent-green)':'var(--accent-red)' }}>
                Transaction {done==='approve'?'APPROVED':'DECLINED'}
              </div>
              <div style={{ fontSize:'0.8rem', color:'var(--text-muted)', marginTop:8 }}>
                Decision recorded · AI learning pipeline updating…
              </div>
            </div>
          ) : mirResult ? (
            /* ── MIR SUBMITTED CONFIRMATION ─────────────────────── */
            <div style={{ textAlign:'center', padding:'40px 0' }}>
              <div style={{ fontSize:'3rem', marginBottom:12 }}>🔄</div>
              <div style={{ fontSize:'1.1rem', fontWeight:700, color:'var(--accent-yellow)' }}>
                Info Request Sent
              </div>
              <div style={{ fontSize:'0.8rem', color:'var(--text-muted)', marginTop:8, maxWidth:360, margin:'8px auto 0' }}>
                {mirResult.email_status?.sent
                  ? `Portal link emailed to originator. Round ${mirResult.round}.`
                  : `Portal link generated (Round ${mirResult.round}). Email not sent — check server log.`
                }
              </div>
              {mirResult.requires_escalation && (
                <div style={{ marginTop:12, padding:'10px 16px', background:'rgba(239,68,68,0.1)', borderRadius:8, fontSize:'0.8rem', color:'var(--accent-red)' }}>
                  ⚠️ This transaction has exceeded the maximum MIR rounds. Supervisor escalation required.
                </div>
              )}
            </div>
          ) : (
            /* ── ACTIVE REVIEW VIEW ──────────────────────────────── */
            <>
              {isResubmission && (
                <div style={{
                  padding:'10px 14px', marginBottom:14,
                  background:'rgba(245,158,11,0.08)', border:'1px solid rgba(245,158,11,0.2)',
                  borderRadius:8, fontSize:'0.8rem', color:'var(--accent-yellow)',
                }}>
                  🔄 <strong>Resubmission #{txn.resubmission_count}</strong> — The originator has responded to your information request.
                  Review their response in the <strong>MIR History</strong> tab before deciding.
                </div>
              )}

              {/* Meta strip */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8, marginBottom:16 }}>
                {[
                  ['Amount',   `$${Number(txn.amount).toLocaleString()}`, txn.transaction_type==='debit'?'var(--accent-red)':'var(--accent-green)'],
                  ['TX Code',  txn.transaction_code||'—',                 'var(--accent-cyan)'],
                  ['ODFI',     txn.odfi_routing||'—',                     'var(--text-secondary)'],
                  ['Auth Type',txn.authorization_type||'—',               txn.authorization_type?'var(--accent-blue)':'var(--accent-yellow)'],
                ].map(([l,v,c]) => (
                  <div key={l} style={{ background:'var(--bg-primary)', borderRadius:8, padding:'8px 12px' }}>
                    <div style={{ fontSize:'0.62rem', color:'var(--text-muted)', textTransform:'uppercase' }}>{l}</div>
                    <div className="monospace" style={{ fontSize:'0.8rem', fontWeight:600, color:c }}>{v}</div>
                  </div>
                ))}
              </div>

              <RiskMeter score={txn.risk_score} />

              {/* Risk flags */}
              {flags.length > 0 && (
                <div style={{ display:'flex', gap:6, flexWrap:'wrap', margin:'12px 0' }}>
                  {flags.map(f => (
                    <span key={f.rule_code} className={`flag-pill ${f.severity}`} title={f.description}>
                      {f.severity==='critical'?'🔴':f.severity==='warning'?'🟡':'🔵'} {f.rule_name}
                    </span>
                  ))}
                </div>
              )}

              {/* Reviewer tabs */}
              <div style={{ display:'flex', gap:4, margin:'16px 0 0', flexWrap:'wrap' }}>
                {tabs.map(t => (
                  <button key={t.id} type="button"
                    className={`btn btn-sm ${tab===t.id?'btn-primary':'btn-ghost'}`}
                    style={t.id === 'history' ? { borderColor:'rgba(245,158,11,0.3)', color: tab===t.id ? undefined : 'var(--accent-yellow)' } : {}}
                    onClick={() => { setShowMirPanel(false); setTab(t.id); }}>
                    {t.label}
                  </button>
                ))}
              </div>

              <div style={{ marginTop:16 }}>
                {/* ── AI Brief tab (unchanged) ── */}
                {tab==='brief' && !showMirPanel && (
                  <div style={{ fontSize:'0.82rem', lineHeight:1.7 }}>
                    {txn.ai_brief ? <ReactMarkdown>{txn.ai_brief}</ReactMarkdown> : <span style={{ color:'var(--text-muted)' }}>No AI brief available.</span>}
                  </div>
                )}

                {/* ── MIR History tab (NEW) ── */}
                {tab==='history' && !showMirPanel && (
                  <MirTimeline txnId={txn.transaction_id} />
                )}

                {/* ── Identity tab ── */}
                {tab==='identity' && !showMirPanel && (
                  <div className="form-grid">
                    <Check label="Identity Verified" k="identity_verified" hint="Confirmed account holder identity through official channels" />
                    <Sel label="Verification Method" k="identity_verification_method" options={[
                      ['','-- Select method --'],['KYC','KYC Database Check'],['DOCUMENT','Document Review'],
                      ['PHONE','Phone Verification'],['IN_PERSON','In-Person Verification'],
                    ]} />
                    <Sel label="Counterparty Type" k="counterparty_type" options={[
                      ['UNKNOWN','Unknown'],['INDIVIDUAL','Individual / Consumer'],['BUSINESS','Business / Corporate'],
                      ['GOVERNMENT','Government Entity'],['NONPROFIT','Non-Profit'],
                    ]} />
                    <Check label="Account Ownership Confirmed" k="account_ownership_confirmed" hint="Verified bank account belongs to the named entity" />
                  </div>
                )}

                {/* ── Fraud Check tab ── */}
                {tab==='fraud' && !showMirPanel && (
                  <>
                    <div style={{ fontSize:'0.78rem', color:'var(--text-muted)', marginBottom:10 }}>
                      Select all fraud indicators observed during review:
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:6, marginBottom:14 }}>
                      {FRAUD_INDICATORS.map(fi => (
                        <label key={fi} style={{
                          display:'flex', alignItems:'center', gap:8, padding:'6px 10px',
                          background: review.fraud_indicators.includes(fi)?'rgba(239,68,68,0.08)':'var(--bg-primary)',
                          border: review.fraud_indicators.includes(fi)?'1px solid rgba(239,68,68,0.3)':'1px solid var(--border)',
                          borderRadius:6, cursor:'pointer', fontSize:'0.72rem',
                        }}>
                          <input type="checkbox"
                            checked={review.fraud_indicators.includes(fi)}
                            onChange={() => {
                              const fis = review.fraud_indicators;
                              set('fraud_indicators', fis.includes(fi) ? fis.filter(x=>x!==fi) : [...fis,fi]);
                            }}
                            style={{ accentColor:'var(--accent-red)' }} />
                          {fi.replace(/_/g,' ')}
                        </label>
                      ))}
                    </div>
                    <Sel label="Escalation Level" k="escalation_level" options={[
                      ['none','None'],['supervisor','Supervisor Review'],
                      ['compliance','Compliance Team'],['executive','Executive Escalation'],
                    ]} />
                    {review.escalation_level !== 'none' && (
                      <div className="form-group">
                        <label className="form-label">Escalation Reason</label>
                        <textarea className="form-input" rows={2} value={review.escalation_reason} onChange={e => set('escalation_reason', e.target.value)} />
                      </div>
                    )}
                  </>
                )}

                {/* ── Business tab ── */}
                {tab==='business' && !showMirPanel && (
                  <div className="form-grid">
                    <Sel label="Business Purpose" k="business_purpose" options={[
                      ['','-- Select purpose --'],['PAYROLL','Payroll / Compensation'],
                      ['VENDOR_PAYMENT','Vendor Payment'],['TAX','Tax Payment'],
                      ['LOAN','Loan / Debt Service'],['SUBSCRIPTION','Subscription / Recurring'],
                      ['REFUND','Refund / Return'],['INSURANCE','Insurance Premium'],
                      ['INVESTMENT','Investment / Transfer'],['UTILITY','Utility Payment'],
                      ['PERSONAL','Personal Transfer'],['UNKNOWN','Unknown'],
                    ]} />
                    <Sel label="Reviewer Confidence" k="reviewer_confidence" options={[
                      ['HIGH','🟢 HIGH — Certain of decision (weight: 1.0)'],
                      ['MEDIUM','🟡 MEDIUM — Reasonably confident (weight: 0.7)'],
                      ['LOW','🔴 LOW — Uncertain, flagging for follow-up (weight: 0.4)'],
                    ]} />
                    <Check label="Authorization Record Reviewed" k="authorization_reviewed" hint="Pulled and reviewed original signed/electronic auth" />
                    <Sel label="Auth Type Confirmed" k="authorization_type_confirmed" options={[
                      ['','-- Not confirmed --'],['PPD_WRITTEN','PPD Written Signed'],['WEB_CLICK','WEB Click-through'],
                      ['TEL_VERBAL','TEL Verbal (Recorded)'],['CCD_SIGNED','CCD Signed Agreement'],
                    ]} />
                    <Check label="Customer Contacted" k="customer_contacted" hint="Direct outreach to account holder" />
                    {review.customer_contacted && (
                      <Sel label="Contact Outcome" k="customer_contact_outcome" options={[
                        ['','-- Select outcome --'],['CONFIRMED','✅ Confirmed transaction'],
                        ['DENIED','🚫 Transaction denied / unauthorized'],
                        ['NO_ANSWER','📵 No answer'],['DISPUTE_FILED','⚖️ Dispute / chargeback filed'],
                      ]} />
                    )}
                    <div className="form-group full-width">
                      <label className="form-label">Additional Notes</label>
                      <textarea className="form-input" rows={3} style={{ resize:'vertical' }}
                        placeholder="Free-text notes for the audit log…"
                        value={review.additional_notes} onChange={e => set('additional_notes', e.target.value)} />
                    </div>
                  </div>
                )}

                {/* ── Return Code tab ── */}
                {tab==='return' && !showMirPanel && (
                  <>
                    <div style={{ padding:'10px 14px', background:'rgba(245,158,11,0.08)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:'var(--radius-sm)', fontSize:'0.8rem', color:'var(--accent-yellow)', marginBottom:14 }}>
                      ⚠️ Select a return code only if you are declining this entry. NACHA requires return entries to be submitted within 2 banking days (60 days for fraud returns R05/R07/R10).
                    </div>
                    <div className="form-group">
                      <label className="form-label">NACHA Return Code</label>
                      <select className="form-select" value={review.recommended_return_code} onChange={e => set('recommended_return_code', e.target.value)}>
                        <option value="">-- No return (approving) --</option>
                        {RETURN_CODES_COMMON.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
                      </select>
                    </div>
                    {review.recommended_return_code && (
                      <div className="form-group">
                        <label className="form-label">Return Code Reason</label>
                        <textarea className="form-input" rows={2} style={{ resize:'vertical' }}
                          placeholder="Explain the return reason for the audit record…"
                          value={review.return_code_reason} onChange={e => set('return_code_reason', e.target.value)} />
                      </div>
                    )}
                    <div className="form-group">
                      <label className="form-label">Decision Note (audit trail)</label>
                      <textarea className="form-input" rows={2} style={{ resize:'vertical' }}
                        value={review.decision_reason} onChange={e => set('decision_reason', e.target.value)}
                        placeholder="Required summary for regulatory audit log…" />
                    </div>
                  </>
                )}

                {/* ── MIR Panel (shown over other tabs) ── */}
                {showMirPanel && (
                  <MirRequestPanel
                    txn={txn}
                    onCancel={() => setShowMirPanel(false)}
                    onSubmitted={handleMirSubmitted}
                  />
                )}
              </div>

              {/* Reviewer confidence strip (only when not in MIR panel) */}
              {!showMirPanel && tab !== 'history' && (
                <div style={{ marginTop:12, padding:'8px 14px', background:'var(--bg-primary)', borderRadius:'var(--radius-sm)', display:'flex', gap:16, fontSize:'0.75rem', color:'var(--text-muted)', flexWrap:'wrap' }}>
                  <span>Confidence: <strong style={{ color: review.reviewer_confidence==='HIGH'?'var(--accent-green)':review.reviewer_confidence==='LOW'?'var(--accent-red)':'var(--accent-yellow)' }}>{review.reviewer_confidence}</strong> (weight: {review.reviewer_confidence==='HIGH'?'1.0':review.reviewer_confidence==='MEDIUM'?'0.7':'0.4'})</span>
                  <span>Identity: {review.identity_verified?'✅ Verified':'⚠️ Not verified'}</span>
                  <span>Fraud flags: {review.fraud_indicators.length}</span>
                  {review.escalation_level !== 'none' && <span style={{ color:'var(--accent-red)' }}>⬆ Escalated: {review.escalation_level}</span>}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Footer — action buttons ─────────────────────────────── */}
        {!isLocked && !done && !mirResult && (
          <div className="modal-footer">
            {!showMirPanel ? (
              <>
                <button className="btn btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
                {/* 🔄 MIR button — only for under_review or more_info_required (re-request) */}
                {(txn.status === 'under_review' || txn.status === 'more_info_required') && (
                  <button
                    className="btn"
                    onClick={() => { setTab('brief'); setShowMirPanel(true); }}
                    disabled={submitting}
                    style={{ background:'rgba(245,158,11,0.12)', color:'var(--accent-yellow)', border:'1px solid rgba(245,158,11,0.3)', fontWeight:700 }}
                  >
                    🔄 Request More Info
                  </button>
                )}
                <button className="btn btn-danger" onClick={() => submit('decline')} disabled={submitting || isMir}>
                  {submitting ? '…' : '🚫 Decline'}
                </button>
                <button className="btn btn-success" onClick={() => submit('approve')} disabled={submitting || isMir}>
                  {submitting ? '…' : '✅ Approve'}
                </button>
              </>
            ) : (
              // MIR panel open — footer handled inside panel
              null
            )}
          </div>
        )}
        {(isLocked || done || mirResult) && (
          <div className="modal-footer" style={{ justifyContent:'flex-end' }}>
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ReviewQueue page (updated) ────────────────────────────────────────────────
export default function ReviewQueue({ onDecision }) {
  const [searchParams] = useSearchParams();

  const [transactions, setTransactions] = useState([]);
  const [selected,     setSelected]     = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [filter,       setFilter]       = useState(searchParams.get('filter') || 'under_review');
  const [secFilter,    setSecFilter]    = useState('');

  useEffect(() => {
    const urlFilter = searchParams.get('filter') || 'under_review';
    setFilter(urlFilter);
  }, [searchParams]);

  const load = () => {
    setLoading(true);
    transactionsApi.getAll({ status: filter, limit: 100 })
      .then(r => setTransactions((r.data||[]).filter(t => !secFilter || t.sec_code === secFilter)))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [filter, secFilter]);

  const handleDecision = () => { load(); onDecision?.(); };

  return (
    <div>
      <div className="page-header">
        <h2>⚠️ Review Queue</h2>
        <p>AI-pre-processed transactions · Rich reviewer form with identity, fraud check, business purpose & return codes · MIR originator portal</p>
      </div>

      <div style={{ display:'flex', gap:8, marginBottom:20, flexWrap:'wrap', alignItems:'center' }}>
        {[
          ['under_review',       '⏳ Pending'],
          ['more_info_required', '🔄 Awaiting Info'],
          ['approved',           '✅ Approved'],
          ['declined',           '🚫 Declined'],
          ['auto_approved',      '🤖 Auto-Approved'],
        ].map(([v,l]) => (
          <button key={v} className={`btn btn-sm ${filter===v?'btn-primary':'btn-ghost'}`}
            style={v==='more_info_required' && filter!==v ? { borderColor:'rgba(245,158,11,0.3)', color:'var(--accent-yellow)' } : {}}
            onClick={() => setFilter(v)}>{l}</button>
        ))}
        <select className="form-select" style={{ width:'auto', padding:'6px 12px', fontSize:'0.8rem', marginLeft:8 }}
          value={secFilter} onChange={e => setSecFilter(e.target.value)}>
          <option value="">All SEC Codes</option>
          {['PPD','CCD','WEB','TEL','IAT','CTX','ARC','BOC'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="btn btn-ghost btn-sm" style={{ marginLeft:'auto' }} onClick={load}>↻ Refresh</button>
      </div>

      {loading
        ? <div className="loading-center"><div className="spinner" /><p>Loading…</p></div>
        : transactions.length === 0
          ? <div className="empty-state"><div className="empty-icon">{filter==='under_review'?'🎉':'📭'}</div><p>{filter==='under_review'?'Queue clear — AI handled everything!':'No transactions.'}</p></div>
          : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Transaction ID</th><th>Company</th><th>SEC</th><th>TC</th>
                    <th>Amount</th><th>RDFI Routing</th><th>Level</th><th>Score</th>
                    <th>Auth</th><th>Flags</th><th>Status</th><th>Reviewed By</th><th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map(txn => {
                    const flags = Array.isArray(txn.risk_flags) ? txn.risk_flags : JSON.parse(txn.risk_flags||'[]');
                    const isMirRow = txn.status === 'more_info_required';
                    const isResubRow = (txn.resubmission_count || 0) > 0;
                    return (
                      <tr key={txn.transaction_id}
                        onClick={() => setSelected(txn)}
                        style={{ cursor:'pointer', background: isMirRow ? 'rgba(245,158,11,0.04)' : undefined }}
                        title={FINAL_STATUSES.includes(txn.status) ? 'Click to view details (read-only)' : 'Click to review'}>
                        <td className="monospace" style={{ color:'var(--accent-cyan)', fontSize:'0.72rem' }}>
                          {txn.transaction_id}
                          {isResubRow && (
                            <div style={{ fontSize:'0.6rem', color:'var(--accent-yellow)', marginTop:2 }}>🔄 Resub #{txn.resubmission_count}</div>
                          )}
                        </td>
                        <td style={{ fontWeight:500, fontSize:'0.82rem' }}>{txn.company_name}</td>
                        <td><span style={{ fontWeight:700, color:'var(--accent-blue)', fontFamily:'monospace' }}>{txn.sec_code}</span></td>
                        <td className="monospace" style={{ fontSize:'0.78rem', color:'var(--text-secondary)' }}>{txn.transaction_code||'—'}</td>
                        <td style={{ fontWeight:700, color: txn.transaction_type==='debit'?'var(--accent-red)':'var(--accent-green)' }}>
                          {txn.transaction_type==='debit'?'-':'+'}${Number(txn.amount).toLocaleString()}
                        </td>
                        <td className="monospace" style={{ fontSize:'0.72rem', color:'var(--text-muted)' }}>{txn.routing_number||txn.rdfi_routing||'—'}</td>
                        <td><span className={`risk-badge level-${txn.risk_level}`}>L{txn.risk_level}</span></td>
                        <td style={{ fontWeight:700, color: txn.risk_score>=70?'var(--accent-red)':txn.risk_score>=30?'var(--accent-yellow)':'var(--accent-green)' }}>{txn.risk_score}</td>
                        <td><span style={{ fontSize:'0.65rem', color: txn.authorization_type?'var(--accent-green)':'var(--accent-yellow)' }}>{txn.authorization_type||'⚠ None'}</span></td>
                        <td>
                          {flags.slice(0,2).map(f => <span key={f.rule_code} className={`flag-pill ${f.severity}`} style={{ fontSize:'0.62rem', marginRight:3 }}>{f.rule_code}</span>)}
                          {flags.length>2&&<span style={{ fontSize:'0.65rem', color:'var(--text-muted)' }}>+{flags.length-2}</span>}
                        </td>
                        <td>
                          <span className={`status-badge ${txn.status}`} style={{ fontSize:'0.65rem' }}>
                            {FINAL_STATUSES.includes(txn.status) ? '🔒 ' : ''}{txn.status?.replace(/_/g,' ')}
                          </span>
                        </td>
                        <td style={{ fontSize:'0.72rem' }}>
                          {txn.reviewer_name ? (
                            <span className="reviewer-badge">👤 {txn.reviewer_name}</span>
                          ) : txn.status === 'auto_approved' ? (
                            <span style={{ fontSize:'0.68rem', color:'var(--accent-purple)' }}>🤖 AI</span>
                          ) : txn.status === 'more_info_required' ? (
                            <span style={{ fontSize:'0.68rem', color:'var(--accent-yellow)' }}>⏳ Waiting</span>
                          ) : '—'}
                        </td>
                        <td style={{ fontSize:'0.72rem', color:'var(--text-muted)' }}>{new Date(txn.created_at).toLocaleDateString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
      }

      {selected && <ReviewModal txn={selected} onClose={() => setSelected(null)} onDecide={handleDecision} />}
    </div>
  );
}