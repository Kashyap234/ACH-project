// frontend/src/pages/ReviewQueue.jsx — Rich human review with enhanced learning
import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { transactionsApi } from '../api/client';

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

function ReviewModal({ txn, onClose, onDecide }) {
  const [review, setReview] = useState(defaultReview);
  const [tab, setTab]       = useState('brief');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]     = useState(null);
  const startTime = useRef(Date.now());

  const flags = Array.isArray(txn.risk_flags) ? txn.risk_flags : JSON.parse(txn.risk_flags || '[]');
  const set = (k, v) => setReview(r => ({ ...r, [k]: v }));
  const toggleFI = (fi) => set('fraud_indicators', review.fraud_indicators.includes(fi) ? review.fraud_indicators.filter(x => x !== fi) : [...review.fraud_indicators, fi]);

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

  const tabs = [
    { id:'brief',    label:'🤖 AI Brief'       },
    { id:'identity', label:'👤 Identity'        },
    { id:'fraud',    label:'🚨 Fraud Check'     },
    { id:'business', label:'📋 Business'        },
    { id:'return',   label:'↩ Return Code'      },
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
            <div style={{ display:'flex', gap:8, marginBottom:4 }}>
              <span className={`risk-badge level-${txn.risk_level}`}>Level {txn.risk_level}</span>
              <span className={`status-badge ${txn.status}`}>{txn.status?.replace('_',' ').toUpperCase()}</span>
              <span style={{ fontSize:'0.72rem', color:'var(--accent-cyan)', fontFamily:'monospace' }}>{txn.sec_code}</span>
            </div>
            <h3 style={{ fontSize:'1.05rem', fontWeight:700 }}>{txn.company_name}</h3>
            <div style={{ fontSize:'0.72rem', color:'var(--text-muted)' }}>
              {txn.transaction_id} · ${Number(txn.amount).toLocaleString()} {txn.transaction_type} · {txn.routing_number} → {txn.account_number}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {done ? (
            <div style={{ textAlign:'center', padding:'40px 0' }}>
              <div style={{ fontSize:'3rem', marginBottom:12 }}>{done==='approve'?'✅':'🚫'}</div>
              <div style={{ fontSize:'1.1rem', fontWeight:700, color: done==='approve'?'var(--accent-green)':'var(--accent-red)' }}>
                Transaction {done==='approve'?'APPROVED':'DECLINED'}
              </div>
              <div style={{ fontSize:'0.8rem', color:'var(--text-muted)', marginTop:8 }}>
                Decision recorded · AI learning pipeline updating…
              </div>
            </div>
          ) : (
            <>
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
                  <button key={t.id} type="button" className={`btn btn-sm ${tab===t.id?'btn-primary':'btn-ghost'}`} onClick={() => setTab(t.id)}>{t.label}</button>
                ))}
              </div>

              <div style={{ marginTop:14, minHeight:260 }}>
                {/* AI BRIEF */}
                {tab==='brief' && (
                  txn.ai_brief
                    ? <div className="ai-brief-panel"><div className="ai-brief-content"><ReactMarkdown>{txn.ai_brief}</ReactMarkdown></div></div>
                    : <div className="empty-state" style={{ padding:'20px 0' }}><p>No AI brief available.</p></div>
                )}

                {/* IDENTITY */}
                {tab==='identity' && (
                  <div className="form-grid">
                    <Check label="Identity Verified" k="identity_verified" hint="KYC / ID check completed" />
                    <Sel label="Verification Method" k="identity_verification_method" options={[
                      ['','-- Select method --'],['ID_CHECK','ID Document Check'],['KYC_DB','KYC Database Lookup'],
                      ['MANUAL_CALL','Manual Phone Call'],['MICRODEPOSIT','Micro-deposit Verification'],['PLAID','Plaid / Open Banking'],
                    ]} />
                    <Sel label="Counterparty Type" k="counterparty_type" options={[
                      ['UNKNOWN','Unknown'],['NEW','New Counterparty (first transaction)'],['EXISTING','Existing / Known Good'],
                      ['KNOWN_FRAUDSTER','Known Fraudster (DECLINE)'],['WATCHLIST_MATCH','Watchlist / Sanction Match'],
                    ]} />
                    <Check label="Account Ownership Confirmed" k="account_ownership_confirmed" hint="Account holder confirmed they own this account" />
                  </div>
                )}

                {/* FRAUD */}
                {tab==='fraud' && (
                  <>
                    <div style={{ marginBottom:12 }}>
                      <div className="form-label" style={{ marginBottom:8 }}>Fraud Indicators Present (select all that apply)</div>
                      <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                        {FRAUD_INDICATORS.map(fi => (
                          <button key={fi} type="button"
                            className={`btn btn-sm ${review.fraud_indicators.includes(fi)?'btn-danger':'btn-ghost'}`}
                            onClick={() => toggleFI(fi)}
                            style={{ fontSize:'0.72rem' }}>
                            {review.fraud_indicators.includes(fi)?'✓ ':''}{fi.replace(/_/g,' ')}
                          </button>
                        ))}
                      </div>
                      <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', marginTop:6 }}>
                        {review.fraud_indicators.length} selected · These feed directly into AI pattern learning
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Risk Override Reason</label>
                      <textarea className="form-input" rows={2} style={{ resize:'vertical' }}
                        placeholder="Why are you overriding the AI recommendation (if applicable)?"
                        value={review.risk_override_reason} onChange={e => set('risk_override_reason', e.target.value)} />
                    </div>
                    <Sel label="Escalation Level" k="escalation_level" options={[
                      ['none','No escalation'],['supervisor','Supervisor Review'],
                      ['compliance','Compliance Department'],['legal','Legal / BSA Officer'],
                    ]} />
                    {review.escalation_level !== 'none' && (
                      <div className="form-group">
                        <label className="form-label">Escalation Reason</label>
                        <textarea className="form-input" rows={2} style={{ resize:'vertical' }}
                          value={review.escalation_reason} onChange={e => set('escalation_reason', e.target.value)} />
                      </div>
                    )}
                  </>
                )}

                {/* BUSINESS */}
                {tab==='business' && (
                  <div className="form-grid">
                    <Sel label="Business Purpose" k="business_purpose" options={[
                      ['','-- Select purpose --'],['PAYROLL','Payroll'],['VENDOR_PAYMENT','Vendor / Supplier Payment'],
                      ['TAX','Tax Payment'],['LOAN','Loan / Credit'],['INSURANCE','Insurance Premium'],
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

                {/* RETURN CODE */}
                {tab==='return' && (
                  <>
                    <div style={{ padding:'10px 14px', background:'rgba(245,158,11,0.08)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:'var(--radius-sm)', fontSize:'0.8rem', color:'var(--accent-yellow)', marginBottom:14 }}>
                      ⚠️ Select a return code only if you are declining this entry. NACHA requires return entries to be submitted within 2 banking days (60 days for fraud returns R05/R07/R10).
                    </div>
                    <div className="form-group">
                      <label className="form-label">Recommended Return Code (if declining)</label>
                      <select className="form-select" value={review.recommended_return_code} onChange={e => set('recommended_return_code', e.target.value)}>
                        <option value="">-- None (not a return) --</option>
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
              </div>

              {/* Reviewer confidence indicator */}
              <div style={{ marginTop:12, padding:'8px 14px', background:'var(--bg-primary)', borderRadius:'var(--radius-sm)', display:'flex', gap:16, fontSize:'0.75rem', color:'var(--text-muted)' }}>
                <span>Confidence: <strong style={{ color: review.reviewer_confidence==='HIGH'?'var(--accent-green)':review.reviewer_confidence==='LOW'?'var(--accent-red)':'var(--accent-yellow)' }}>{review.reviewer_confidence}</strong> (decision weight: {review.reviewer_confidence==='HIGH'?'1.0':review.reviewer_confidence==='MEDIUM'?'0.7':'0.4'})</span>
                <span>Identity: {review.identity_verified?'✅ Verified':'⚠️ Not verified'}</span>
                <span>Fraud flags: {review.fraud_indicators.length}</span>
                {review.escalation_level !== 'none' && <span style={{ color:'var(--accent-red)' }}>⬆ Escalated: {review.escalation_level}</span>}
              </div>
            </>
          )}
        </div>

        {!done && (
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
            <button className="btn btn-danger" onClick={() => submit('decline')} disabled={submitting}>
              {submitting ? '…' : '🚫 Decline'}
            </button>
            <button className="btn btn-success" onClick={() => submit('approve')} disabled={submitting}>
              {submitting ? '…' : '✅ Approve'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ReviewQueue({ onDecision }) {
  const [transactions, setTransactions] = useState([]);
  const [selected,     setSelected]     = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [filter,       setFilter]       = useState('under_review');
  const [secFilter,    setSecFilter]    = useState('');

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
        <p>AI-pre-processed transactions · Rich reviewer form with identity, fraud check, business purpose & return codes</p>
      </div>

      <div style={{ display:'flex', gap:8, marginBottom:20, flexWrap:'wrap', alignItems:'center' }}>
        {[['under_review','⏳ Pending'],['approved','✅ Approved'],['declined','🚫 Declined'],['auto_approved','🤖 Auto-Approved']].map(([v,l]) => (
          <button key={v} className={`btn btn-sm ${filter===v?'btn-primary':'btn-ghost'}`} onClick={() => setFilter(v)}>{l}</button>
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
                    <th>Auth</th><th>Flags</th><th>Status</th><th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map(txn => {
                    const flags = Array.isArray(txn.risk_flags) ? txn.risk_flags : JSON.parse(txn.risk_flags||'[]');
                    return (
                      <tr key={txn.transaction_id} onClick={() => setSelected(txn)}>
                        <td className="monospace" style={{ color:'var(--accent-cyan)', fontSize:'0.72rem' }}>{txn.transaction_id}</td>
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
                        <td><span className={`status-badge ${txn.status}`} style={{ fontSize:'0.65rem' }}>{txn.status?.replace('_',' ')}</span></td>
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
