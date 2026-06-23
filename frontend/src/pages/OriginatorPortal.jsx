// frontend/src/pages/OriginatorPortal.jsx
// Public, token-scoped page for ACH transaction originators to respond to
// More Information Required (MIR) requests.
//
// Security design:
//   - No JWT or internal auth — accessed via one-time portal token in the URL
//   - No sidebar, no admin nav — completely separate from internal frontend layout
//   - Only safe, masked transaction data is shown (no risk scores, no internal flags)
//   - All data fetched via portalApi (separate axios instance, no Authorization header)
//   - Token validation and expiry enforced server-side
//
// Route: /portal/:token  (registered in App.jsx outside the authenticated layout)
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { portalApi } from '../api/client';

// ── Minimal brand styles (inlined — portal has no access to admin CSS vars) ──
const PORTAL_COLORS = {
  bg:       '#0f1117',
  card:     '#1a1d27',
  border:   'rgba(255,255,255,0.08)',
  text:     '#e2e8f0',
  muted:    '#94a3b8',
  accent:   '#3b82f6',
  yellow:   '#f59e0b',
  green:    '#10b981',
  red:      '#ef4444',
};

const S = {
  page: {
    minHeight: '100vh',
    background: PORTAL_COLORS.bg,
    color: PORTAL_COLORS.text,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '24px 16px 60px',
  },
  container: {
    width: '100%',
    maxWidth: 620,
  },
  header: {
    textAlign: 'center',
    marginBottom: 32,
    paddingTop: 12,
  },
  logo: {
    fontSize: '2.4rem',
    marginBottom: 8,
  },
  title: {
    fontSize: '1.25rem',
    fontWeight: 700,
    color: PORTAL_COLORS.text,
    margin: 0,
  },
  subtitle: {
    fontSize: '0.82rem',
    color: PORTAL_COLORS.muted,
    marginTop: 6,
  },
  card: {
    background: PORTAL_COLORS.card,
    border: `1px solid ${PORTAL_COLORS.border}`,
    borderRadius: 12,
    padding: '20px 24px',
    marginBottom: 16,
  },
  label: {
    fontSize: '0.7rem',
    color: PORTAL_COLORS.muted,
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    marginBottom: 4,
    display: 'block',
  },
  value: {
    fontSize: '0.92rem',
    fontWeight: 600,
    color: PORTAL_COLORS.text,
  },
  sectionTitle: {
    fontSize: '0.78rem',
    fontWeight: 700,
    color: PORTAL_COLORS.muted,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: 12,
  },
  textarea: {
    width: '100%',
    minHeight: 120,
    background: '#0f1117',
    border: `1px solid ${PORTAL_COLORS.border}`,
    borderRadius: 8,
    color: PORTAL_COLORS.text,
    fontSize: '0.88rem',
    lineHeight: 1.6,
    padding: '12px 14px',
    resize: 'vertical',
    boxSizing: 'border-box',
    outline: 'none',
    fontFamily: 'inherit',
  },
  btn: {
    display: 'block',
    width: '100%',
    padding: '14px',
    background: PORTAL_COLORS.accent,
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: '0.95rem',
    fontWeight: 700,
    cursor: 'pointer',
    marginTop: 16,
    letterSpacing: '0.02em',
  },
  btnDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  errorBox: {
    background: 'rgba(239,68,68,0.1)',
    border: `1px solid rgba(239,68,68,0.3)`,
    borderRadius: 8,
    padding: '12px 16px',
    color: PORTAL_COLORS.red,
    fontSize: '0.85rem',
    marginBottom: 16,
  },
  successBox: {
    background: 'rgba(16,185,129,0.1)',
    border: `1px solid rgba(16,185,129,0.3)`,
    borderRadius: 12,
    padding: '28px 24px',
    textAlign: 'center',
    marginBottom: 16,
  },
  categoryBadge: {
    display: 'inline-block',
    padding: '4px 12px',
    borderRadius: 99,
    background: 'rgba(245,158,11,0.15)',
    color: PORTAL_COLORS.yellow,
    fontSize: '0.78rem',
    fontWeight: 700,
    marginBottom: 12,
  },
};

const CATEGORY_LABELS = {
  IDENTITY_VERIFICATION:          '🪪 Identity Verification',
  AUTHORIZATION_PROOF:            '✍️ Authorization Proof',
  BUSINESS_PURPOSE_CLARIFICATION: '📋 Business Purpose',
  AMOUNT_DISCREPANCY:             '💰 Amount Discrepancy',
  ACCOUNT_OWNERSHIP:              '🏦 Account Ownership',
  SANCTIONS_REVIEW:               '🚨 Compliance Review',
  DUPLICATE_EXPLANATION:          '🔁 Duplicate Explanation',
  CUSTOM:                         '📝 Information Request',
};

function LoadingScreen() {
  return (
    <div style={{ ...S.page, justifyContent:'center' }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontSize:'2rem', marginBottom:16 }}>🔄</div>
        <div style={{ color: PORTAL_COLORS.muted, fontSize:'0.9rem' }}>Loading your request…</div>
      </div>
    </div>
  );
}

function ErrorScreen({ message, icon = '⚠️' }) {
  return (
    <div style={{ ...S.page }}>
      <div style={S.container}>
        <div style={S.header}>
          <div style={S.logo}>🏦</div>
          <h1 style={S.title}>ACH Payment Portal</h1>
        </div>
        <div style={{ ...S.card, borderColor:'rgba(239,68,68,0.25)', textAlign:'center' }}>
          <div style={{ fontSize:'2.5rem', marginBottom:12 }}>{icon}</div>
          <div style={{ fontWeight:700, color: PORTAL_COLORS.red, marginBottom:8 }}>Unable to Load Request</div>
          <div style={{ fontSize:'0.85rem', color: PORTAL_COLORS.muted, lineHeight:1.6 }}>{message}</div>
        </div>
        <div style={{ ...S.card, fontSize:'0.8rem', color: PORTAL_COLORS.muted, lineHeight:1.7 }}>
          <strong style={{ color: PORTAL_COLORS.text }}>Need help?</strong><br />
          If you believe this is an error, please contact your bank or financial institution directly using the contact information on your account statement.
        </div>
      </div>
    </div>
  );
}

function SuccessScreen({ resubmissionCount }) {
  return (
    <div style={S.page}>
      <div style={S.container}>
        <div style={S.header}>
          <div style={S.logo}>🏦</div>
          <h1 style={S.title}>ACH Payment Portal</h1>
        </div>
        <div style={S.successBox}>
          <div style={{ fontSize:'3rem', marginBottom:12 }}>✅</div>
          <div style={{ fontSize:'1.1rem', fontWeight:700, color: PORTAL_COLORS.green, marginBottom:8 }}>
            Response Submitted
          </div>
          <div style={{ fontSize:'0.85rem', color: PORTAL_COLORS.muted, lineHeight:1.6, maxWidth:400, margin:'0 auto' }}>
            Thank you. Your response has been securely submitted to the bank for review.
            {resubmissionCount > 1 ? ' A reviewer will be in touch if any additional information is needed.' : ' You will be contacted if further information is required.'}
          </div>
        </div>
        <div style={{ ...S.card, fontSize:'0.8rem', color: PORTAL_COLORS.muted, lineHeight:1.7 }}>
          <strong style={{ color: PORTAL_COLORS.text }}>What happens next?</strong><br />
          A bank representative will review your response. If approved, your ACH transaction will be processed.
          If further information is needed, you may receive another secure link via email.
          Do not reply to automated emails — use the secure links provided.
        </div>
      </div>
    </div>
  );
}

export default function OriginatorPortal() {
  const { token } = useParams();
  const [state,     setState]     = useState('loading');  // loading | ready | submitted | error | expired | already_responded
  const [data,      setData]      = useState(null);
  const [errorMsg,  setErrorMsg]  = useState('');
  const [response,  setResponse]  = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [resubCount,  setResubCount]  = useState(0);

  useEffect(() => {
    if (!token) { setState('error'); setErrorMsg('No portal token provided in the URL.'); return; }

    portalApi.getRequest(token)
      .then(res => {
        setData(res.data);
        setState('ready');
      })
      .catch(err => {
        const msg = err.message || '';
        if (msg.toLowerCase().includes('expired')) { setState('expired'); }
        else if (msg.toLowerCase().includes('already been responded')) { setState('already_responded'); }
        else { setState('error'); setErrorMsg(msg || 'Unable to load your request. The link may be invalid or expired.'); }
      });
  }, [token]);

  const handleSubmit = async () => {
    if (response.trim().length < 5) {
      setSubmitError('Please enter a response (minimum 5 characters).');
      return;
    }
    setSubmitError('');
    setSubmitting(true);
    try {
      const result = await portalApi.respond(token, { response_message: response.trim() });
      setResubCount(result.resubmission_count || 1);
      setState('submitted');
    } catch (e) {
      setSubmitError(e.message || 'Failed to submit your response. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render states ─────────────────────────────────────────────────────────
  if (state === 'loading') return <LoadingScreen />;
  if (state === 'submitted') return <SuccessScreen resubmissionCount={resubCount} />;
  if (state === 'expired') return (
    <ErrorScreen
      icon="⏰"
      message="This portal link has expired. If you still need to provide information, please contact your bank to request a new link."
    />
  );
  if (state === 'already_responded') return (
    <ErrorScreen
      icon="✅"
      message="This request has already been responded to. No further action is needed on your part. The bank will be in touch if additional information is required."
    />
  );
  if (state === 'error' || !data) return <ErrorScreen icon="⚠️" message={errorMsg} />;

  const txn       = data.transaction;
  const category  = CATEGORY_LABELS[data.category] || data.category;
  const expiresAt = new Date(data.token_expires_at);
  const isNearExpiry = (expiresAt - new Date()) < 24 * 60 * 60 * 1000;

  return (
    <div style={S.page}>
      <div style={S.container}>

        {/* Header */}
        <div style={S.header}>
          <div style={S.logo}>🏦</div>
          <h1 style={S.title}>ACH Payment Portal</h1>
          <p style={S.subtitle}>Secure originator response portal · Your information is transmitted encrypted</p>
        </div>

        {/* Expiry warning */}
        {isNearExpiry && (
          <div style={{ ...S.card, borderColor:'rgba(239,68,68,0.3)', background:'rgba(239,68,68,0.06)', marginBottom:16 }}>
            <div style={{ display:'flex', gap:10, alignItems:'center', fontSize:'0.82rem', color: PORTAL_COLORS.red }}>
              <span style={{ fontSize:'1.2rem' }}>⏰</span>
              <span>This link expires soon: <strong>{expiresAt.toLocaleString()}</strong>. Please respond before then.</span>
            </div>
          </div>
        )}

        {/* Transaction summary */}
        <div style={S.card}>
          <div style={S.sectionTitle}>Transaction Summary</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px 20px' }}>
            <div>
              <span style={S.label}>Company / Originator</span>
              <span style={S.value}>{txn.company_name}</span>
            </div>
            <div>
              <span style={S.label}>Amount</span>
              <span style={{ ...S.value, color: txn.transaction_type === 'debit' ? PORTAL_COLORS.red : PORTAL_COLORS.green }}>
                {txn.transaction_type === 'debit' ? '-' : '+'}
                ${Number(txn.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div>
              <span style={S.label}>Account (masked)</span>
              <span style={{ ...S.value, fontFamily:'monospace', letterSpacing:'0.05em' }}>{txn.account_number_masked}</span>
            </div>
            <div>
              <span style={S.label}>Routing (masked)</span>
              <span style={{ ...S.value, fontFamily:'monospace', letterSpacing:'0.05em' }}>{txn.routing_number_masked}</span>
            </div>
            <div>
              <span style={S.label}>Effective Date</span>
              <span style={S.value}>{txn.effective_date || '—'}</span>
            </div>
            <div>
              <span style={S.label}>SEC Code</span>
              <span style={{ ...S.value, fontFamily:'monospace' }}>{txn.sec_code}</span>
            </div>
          </div>
        </div>

        {/* Information request */}
        <div style={{ ...S.card, borderColor:'rgba(245,158,11,0.25)', background:'rgba(245,158,11,0.04)' }}>
          <div style={S.sectionTitle}>Information Required</div>
          <div style={S.categoryBadge}>{category}</div>
          {data.round_number > 1 && (
            <div style={{ fontSize:'0.72rem', color: PORTAL_COLORS.muted, marginBottom:10 }}>
              Request #{data.round_number} · Ref: {data.request_id}
            </div>
          )}
          <div style={{ fontSize:'0.9rem', color: PORTAL_COLORS.text, lineHeight:1.7, whiteSpace:'pre-wrap' }}>
            {data.message}
          </div>
          {data.requested_fields && data.requested_fields.length > 0 && (
            <div style={{ marginTop:14 }}>
              <div style={{ fontSize:'0.72rem', color: PORTAL_COLORS.muted, marginBottom:6, fontWeight:600 }}>Specifically requested:</div>
              <ul style={{ margin:0, paddingLeft:18, color: PORTAL_COLORS.muted, fontSize:'0.82rem', lineHeight:1.8 }}>
                {data.requested_fields.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
          )}
        </div>

        {/* Response form */}
        <div style={S.card}>
          <div style={S.sectionTitle}>Your Response</div>
          <div style={{ fontSize:'0.78rem', color: PORTAL_COLORS.muted, marginBottom:12, lineHeight:1.6 }}>
            Please provide a clear and complete response to the question above.
            Include any reference numbers, dates, or other relevant details that will help the reviewer.
          </div>
          <textarea
            style={{ ...S.textarea, borderColor: submitError ? 'rgba(239,68,68,0.4)' : S.textarea.border }}
            placeholder="Type your response here…"
            value={response}
            onChange={e => { setResponse(e.target.value); if (submitError) setSubmitError(''); }}
            disabled={submitting}
          />
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.7rem', color: PORTAL_COLORS.muted, marginTop:4 }}>
            <span>{response.trim().length} characters</span>
            {response.trim().length > 0 && response.trim().length < 5 && (
              <span style={{ color: PORTAL_COLORS.yellow }}>Minimum 5 characters required</span>
            )}
          </div>

          {submitError && (
            <div style={{ ...S.errorBox, marginTop:12, marginBottom:0 }}>⚠️ {submitError}</div>
          )}

          <button
            style={{ ...S.btn, ...(submitting || response.trim().length < 5 ? S.btnDisabled : {}) }}
            onClick={handleSubmit}
            disabled={submitting || response.trim().length < 5}
          >
            {submitting ? '⏳ Submitting…' : '📤 Submit Response'}
          </button>
        </div>

        {/* Security notice */}
        <div style={{ ...S.card, fontSize:'0.75rem', color: PORTAL_COLORS.muted, lineHeight:1.7 }}>
          <strong style={{ color: PORTAL_COLORS.text, display:'block', marginBottom:4 }}>🔒 Security Notice</strong>
          This is a secure, single-use link generated specifically for this transaction.
          Do not share this link with anyone. Your bank will never ask for passwords or
          full account numbers through this portal. If you have concerns about this request,
          contact your bank directly using the number on your account statement.
          <div style={{ marginTop:8, fontFamily:'monospace', fontSize:'0.7rem', color:'rgba(148,163,184,0.5)' }}>
            Ref: {data.request_id} · Expires: {expiresAt.toLocaleDateString()}
          </div>
        </div>
      </div>
    </div>
  );
}