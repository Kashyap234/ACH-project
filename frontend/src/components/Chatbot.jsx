// frontend/src/components/Chatbot.jsx
import { useState, useRef, useEffect, useCallback } from 'react';
import { chatbotApi } from '../api/client';
import { useAuth } from '../context/AuthContext';

// ── Pre-defined question templates ───────────────────────────────────────────
const QUICK_QUESTIONS = [
  { icon: '📊', label: 'Transaction Summary',   text: 'Give me a summary of the current transaction status across the system.' },
  { icon: '⏳', label: 'Pending Reviews',        text: 'Which transactions are currently pending review? Show me details.' },
  { icon: '🔴', label: 'High-Risk Transactions', text: 'Analyze all high-risk Level 3 transactions and explain the concerns.' },
  { icon: '✅', label: 'Auto-Approval Rate',      text: 'What is the current auto-resolution rate and how is it trending?' },
  { icon: '💰', label: 'Total Volume',            text: 'What is the total dollar volume processed so far?' },
  { icon: '🧠', label: 'AI Learning Insights',   text: 'What patterns has the AI learned? Give me insights on fraud detection.' },
  { icon: '📋', label: 'Recent Audit Activity',  text: 'Walk me through the most recent audit events in the system.' },
  { icon: '⚡', label: 'Risk Analysis',           text: 'Give me a risk analysis of the current transaction portfolio.' },
  { icon: '⏰', label: 'Exceptions Due',          text: 'Show me all pending exceptions with cutoff deadlines. Which ones are past due?' },
  { icon: '📨', label: 'MIR Status',              text: 'What are the pending More Info Required requests and which ones are overdue past SLA?' },
  { icon: '👥', label: 'User Overview',           text: 'List all system users, their roles, and whether their accounts are active.' },
  { icon: '🏦', label: 'Account Filters',         text: 'Show the current filter configuration for each account including mode, cutoff times, and whitelist status.' },
];

const ADMIN_QUICK = [
  { icon: '✅', label: 'Approve Transaction', action: 'approve_ui'      },
  { icon: '❌', label: 'Reject Transaction',  action: 'reject_ui'       },
  { icon: '➕', label: 'Create Transaction',  action: 'create'          },
  { icon: '✏️', label: 'Update Transaction',  action: 'update'          },
  { icon: '🗑️', label: 'Delete Transaction',  action: 'delete'          },
  { icon: '🔍', label: 'Read Transaction',    action: 'read'            },
  { icon: '⏰', label: 'Exceptions',          action: 'exceptions'      },
  { icon: '📨', label: 'Request Info (MIR)', action: 'request_info'    },
  { icon: '👥', label: 'Manage Users',        action: 'manage_users'    },
  { icon: '🏦', label: 'Manage Accounts',     action: 'manage_accounts' },
];

// ── Simple markdown renderer ─────────────────────────────────────────────────
function renderMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^#{1,3}\s+(.+)$/gm, '<div class="cb-md-heading">$1</div>')
    .replace(/^\|(.+)\|$/gm, (row) => {
      const cells = row.split('|').filter(c => c.trim()).map(c => '<td>' + c.trim() + '</td>').join('');
      return '<tr>' + cells + '</tr>';
    })
    .replace(/(<tr>.*<\/tr>\n?)+/g, (t) => '<table class="cb-table">' + t + '</table>')
    .replace(/^- (.+)$/gm, '<div class="cb-md-li">• $1</div>')
    .replace(/\n/g, '<br/>');
}

// ── Message Bubble ────────────────────────────────────────────────────────────
function MessageBubble({ msg }) {
  const isUser  = msg.role === 'user';
  const isError = msg.source === 'error';
  const isCrud  = msg.source === 'crud';
  const isDecision = msg.source === 'decision';

  const bubbleClass = isUser ? 'cb-bubble-user'
    : isError    ? 'cb-bubble-error'
    : 'cb-bubble-bot';

  return (
    <div className={`cb-message ${isUser ? 'cb-user' : 'cb-bot'}`}>
      {!isUser && <div className="cb-avatar"><span>🤖</span></div>}
      <div className={`cb-bubble ${bubbleClass}`}>
        {isUser
          ? <p style={{ margin: 0 }}>{msg.content}</p>
          : <div className="cb-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
        }
        <div className="cb-time">
          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          {msg.source === 'ai'       && <span className="cb-src-badge cb-badge-ai">🧠 AI</span>}
          {msg.source === 'decision' && <span className="cb-src-badge cb-badge-decision">⚡ Decision</span>}
          {msg.source === 'crud'     && <span className="cb-src-badge cb-badge-crud">🔧 CRUD</span>}
          {msg.source === 'system'   && <span className="cb-src-badge cb-badge-system">💬 System</span>}
        </div>
      </div>
      {isUser && <div className="cb-avatar cb-avatar-user"><span>👤</span></div>}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="cb-message cb-bot">
      <div className="cb-avatar"><span>🤖</span></div>
      <div className="cb-bubble cb-bubble-bot cb-typing">
        <span /><span /><span />
      </div>
    </div>
  );
}

// ── Decision Panel (Approve / Reject) ─────────────────────────────────────────
function DecisionPanel({ action, onSubmit, onCancel }) {
  const [txnId, setTxnId] = useState('');
  const [notes, setNotes] = useState('');
  const isApprove = action === 'approve';

  return (
    <div className="cb-crud-form">
      <div className="cb-crud-form-header">
        <span>{isApprove ? '✅ Approve Transaction' : '❌ Reject Transaction'}</span>
        <button className="cb-icon-btn" onClick={onCancel} style={{ background: 'rgba(0,0,0,0.1)', color: '#555' }}>✕</button>
      </div>
      <div className="cb-crud-field" style={{ marginBottom: 8 }}>
        <label>Transaction ID *</label>
        <input
          className="cb-crud-input"
          value={txnId}
          onChange={e => setTxnId(e.target.value.toUpperCase())}
          placeholder="e.g. TXN-0B671CD6"
        />
      </div>
      <div className="cb-crud-field">
        <label>Notes (optional)</label>
        <input
          className="cb-crud-input"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder={isApprove ? 'Reason for approval…' : 'Reason for rejection…'}
        />
      </div>
      <p style={{ fontSize: '0.72rem', color: '#64748b', margin: '8px 0 0' }}>
        💡 You can also type in the chat: <em>"{isApprove ? 'approve' : 'reject'} TXN-XXXXXXXX"</em>
      </p>
      <div className="cb-crud-actions">
        <button className="cb-crud-cancel" onClick={onCancel}>Cancel</button>
        <button
          className={`cb-crud-submit ${!isApprove ? 'cb-crud-submit-danger' : ''}`}
          onClick={() => { if (!txnId.trim()) { alert('Please enter a Transaction ID'); return; } onSubmit(txnId.trim(), action, notes); }}
        >
          {isApprove ? '✅ Approve' : '❌ Reject'}
        </button>
      </div>
    </div>
  );
}

// ── CRUD Form ─────────────────────────────────────────────────────────────────
function CrudForm({ action, onSubmit, onCancel, isAdmin }) {
  const [txnId,  setTxnId]  = useState('');
  const [fields, setFields] = useState({
    company_name: '', amount: '', account_number: '', routing_number: '',
    sec_code: 'PPD', transaction_type: 'debit', effective_date: '', individual_name: '',
  });

  if (!isAdmin && action !== 'read') {
    return (
      <div className="cb-crud-denied">
        <div className="cb-crud-denied-icon">🔒</div>
        <div className="cb-crud-denied-text">
          <strong>Admin Access Required</strong>
          <p>Only <strong>Admin</strong> users can {action} transactions.</p>
        </div>
        <button className="cb-crud-cancel" onClick={onCancel}>Close</button>
      </div>
    );
  }

  const set = (k, v) => setFields(f => ({ ...f, [k]: v }));
  const handleSubmit = () => {
    const id = txnId.trim().toUpperCase();
    if (action !== 'create' && !id) { alert('Please enter a Transaction ID'); return; }
    if (action === 'create' && (!fields.company_name || !fields.amount || !fields.account_number || !fields.routing_number)) {
      alert('Please fill all required fields'); return;
    }
    onSubmit(action, action === 'create' ? null : id, (action === 'create' || action === 'update') ? fields : {});
  };

  const titles = { create: '➕ Create Transaction', read: '🔍 Read Transaction', update: '✏️ Update Transaction', delete: '🗑️ Delete Transaction' };

  return (
    <div className="cb-crud-form">
      <div className="cb-crud-form-header">
        <span>{titles[action]}</span>
        <button className="cb-icon-btn" onClick={onCancel} style={{ background: 'rgba(0,0,0,0.1)', color: '#555' }}>✕</button>
      </div>
      {action !== 'create' && (
        <div className="cb-crud-field" style={{ marginBottom: 8 }}>
          <label>Transaction ID *</label>
          <input className="cb-crud-input" value={txnId} onChange={e => setTxnId(e.target.value)} placeholder="TXN-XXXXXXXX" />
        </div>
      )}
      {(action === 'create' || action === 'update') && (
        <div className="cb-crud-grid">
          <div className="cb-crud-field"><label>Company Name {action==='create'&&'*'}</label><input className="cb-crud-input" value={fields.company_name} onChange={e=>set('company_name',e.target.value)} placeholder="Acme Corp" /></div>
          <div className="cb-crud-field"><label>Amount {action==='create'&&'*'}</label><input className="cb-crud-input" type="number" value={fields.amount} onChange={e=>set('amount',e.target.value)} placeholder="1000.00" /></div>
          <div className="cb-crud-field"><label>Account # {action==='create'&&'*'}</label><input className="cb-crud-input" value={fields.account_number} onChange={e=>set('account_number',e.target.value)} placeholder="123456789" /></div>
          <div className="cb-crud-field"><label>Routing # {action==='create'&&'*'}</label><input className="cb-crud-input" value={fields.routing_number} onChange={e=>set('routing_number',e.target.value)} placeholder="021000021" /></div>
          <div className="cb-crud-field"><label>SEC Code</label>
            <select className="cb-crud-input" value={fields.sec_code} onChange={e=>set('sec_code',e.target.value)}>
              <option>PPD</option><option>CCD</option><option>WEB</option><option>IAT</option><option>TEL</option>
            </select>
          </div>
          <div className="cb-crud-field"><label>Type</label>
            <select className="cb-crud-input" value={fields.transaction_type} onChange={e=>set('transaction_type',e.target.value)}>
              <option value="debit">Debit</option><option value="credit">Credit</option>
            </select>
          </div>
          <div className="cb-crud-field"><label>Effective Date</label><input className="cb-crud-input" type="date" value={fields.effective_date} onChange={e=>set('effective_date',e.target.value)} /></div>
          <div className="cb-crud-field"><label>Individual Name</label><input className="cb-crud-input" value={fields.individual_name} onChange={e=>set('individual_name',e.target.value)} placeholder="John Doe" /></div>
        </div>
      )}
      {action === 'delete' && <div className="cb-crud-warning">⚠️ This action is <strong>permanent</strong>. Approved transactions cannot be deleted.</div>}
      <div className="cb-crud-actions">
        <button className="cb-crud-cancel" onClick={onCancel}>Cancel</button>
        <button className={`cb-crud-submit ${action==='delete'?'cb-crud-submit-danger':''}`} onClick={handleSubmit}>
          {action==='create'?'➕ Create':action==='read'?'🔍 Fetch':action==='update'?'✏️ Update':'🗑️ Delete'}
        </button>
      </div>
    </div>
  );
}

// ── Exceptions Panel ──────────────────────────────────────────────────────────
function ExceptionsPanel({ onAction, onCancel, isAdmin }) {
  const [data, setData] = useState(null);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    chatbotApi.manage('list_exceptions', {})
      .then(r => setData(r))
      .catch(() => setData({ data: [], summary: { total: 0, past_due: 0, urgent: 0, safe: 0 } }))
      .finally(() => setFetching(false));
  }, []);

  const fmtMs = ms => {
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  return (
    <div className="cb-crud-form">
      <div className="cb-crud-form-header">
        <span>⏰ Pending Exceptions</span>
        <button className="cb-icon-btn" onClick={onCancel} style={{ background: 'rgba(0,0,0,0.1)', color: '#555' }}>✕</button>
      </div>
      {fetching ? (
        <div style={{ padding: '12px', textAlign: 'center', color: '#64748b', fontSize: '0.82rem' }}>Loading exceptions…</div>
      ) : !data?.data?.length ? (
        <div style={{ padding: '12px', textAlign: 'center', color: '#22c55e', fontSize: '0.82rem' }}>✅ No pending exceptions.</div>
      ) : (
        <>
          <div style={{ fontSize: '0.7rem', color: '#64748b', paddingBottom: 6 }}>
            🔴 {data.summary.past_due} past due · 🟡 {data.summary.urgent} urgent ({'<'}1hr) · 🟢 {data.summary.safe} safe
          </div>
          <div style={{ maxHeight: 190, overflowY: 'auto' }}>
            {data.data.map(exc => (
              <div key={exc.transaction_id} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 0', borderBottom: '1px solid #f1f5f9', fontSize: '0.76rem' }}>
                <span>{exc.is_past_due ? '🔴' : exc.ms_remaining < 3600000 ? '🟡' : '🟢'}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <strong>{exc.transaction_id}</strong> · {exc.company_name} <span style={{ color: '#94a3b8' }}>${Number(exc.amount).toLocaleString()}</span>
                  <br /><span style={{ color: '#94a3b8' }}>L{exc.risk_level} · {exc.is_past_due ? 'PAST DUE' : fmtMs(exc.ms_remaining) + ' left'} · default: {exc.default_action}</span>
                </span>
                <button className="cb-crud-submit" style={{ padding: '3px 7px', fontSize: '0.68rem' }} onClick={() => onAction('exception_decide', { transaction_id: exc.transaction_id, decision: 'pay' })}>PAY</button>
                <button className="cb-crud-submit cb-crud-submit-danger" style={{ padding: '3px 7px', fontSize: '0.68rem' }} onClick={() => onAction('exception_decide', { transaction_id: exc.transaction_id, decision: 'return' })}>RETURN</button>
              </div>
            ))}
          </div>
          {isAdmin && data.summary.past_due > 0 && (
            <button className="cb-crud-submit" style={{ width: '100%', marginTop: 8 }} onClick={() => onAction('apply_defaults', {})}>
              ⏰ Apply Defaults to {data.summary.past_due} Past-Due Item{data.summary.past_due !== 1 ? 's' : ''}
            </button>
          )}
        </>
      )}
      <div className="cb-crud-actions" style={{ marginTop: 8 }}>
        <button className="cb-crud-cancel" onClick={onCancel}>Close</button>
      </div>
    </div>
  );
}

// ── MIR Info Request Panel ────────────────────────────────────────────────────
const MIR_CATS = [
  ['IDENTITY_VERIFICATION', 'Identity Verification'],
  ['AUTHORIZATION_PROOF', 'Authorization Proof'],
  ['BUSINESS_PURPOSE_CLARIFICATION', 'Business Purpose Clarification'],
  ['AMOUNT_DISCREPANCY', 'Amount Discrepancy'],
  ['ACCOUNT_OWNERSHIP', 'Account Ownership'],
  ['SANCTIONS_REVIEW', 'Sanctions Review'],
  ['DUPLICATE_EXPLANATION', 'Duplicate Explanation'],
  ['CUSTOM', 'Custom'],
];

function InfoRequestPanel({ onSubmit, onCancel }) {
  const [txnId, setTxnId] = useState('');
  const [category, setCategory] = useState('IDENTITY_VERIFICATION');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');

  return (
    <div className="cb-crud-form">
      <div className="cb-crud-form-header">
        <span>📨 Request More Information (MIR)</span>
        <button className="cb-icon-btn" onClick={onCancel} style={{ background: 'rgba(0,0,0,0.1)', color: '#555' }}>✕</button>
      </div>
      <div className="cb-crud-grid">
        <div className="cb-crud-field">
          <label>Transaction ID *</label>
          <input className="cb-crud-input" value={txnId} onChange={e => setTxnId(e.target.value.toUpperCase())} placeholder="TXN-XXXXXXXX" />
        </div>
        <div className="cb-crud-field">
          <label>Category *</label>
          <select className="cb-crud-input" value={category} onChange={e => setCategory(e.target.value)}>
            {MIR_CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="cb-crud-field" style={{ gridColumn: '1 / -1' }}>
          <label>Message to Originator * (min 10 chars)</label>
          <textarea className="cb-crud-input" value={message} onChange={e => setMessage(e.target.value)} placeholder="Describe what information is needed from the originator…" rows={3} style={{ resize: 'vertical', fontFamily: 'inherit' }} />
        </div>
        <div className="cb-crud-field" style={{ gridColumn: '1 / -1' }}>
          <label>Originator Email (optional — sends portal link)</label>
          <input className="cb-crud-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="originator@company.com" />
        </div>
      </div>
      <p style={{ fontSize: '0.72rem', color: '#64748b', margin: '6px 0 0' }}>
        💡 A secure portal link will be generated for the originator to submit their response.
      </p>
      <div className="cb-crud-actions">
        <button className="cb-crud-cancel" onClick={onCancel}>Cancel</button>
        <button className="cb-crud-submit" onClick={() => {
          if (!txnId.trim()) { alert('Transaction ID required'); return; }
          if (message.trim().length < 10) { alert('Message must be at least 10 characters'); return; }
          onSubmit('request_info', { transaction_id: txnId.trim(), category, message: message.trim(), originator_email: email.trim() || undefined });
        }}>📨 Send Request</button>
      </div>
    </div>
  );
}

// ── User Management Panel ─────────────────────────────────────────────────────
function UserManagePanel({ onAction, onCancel }) {
  const [users, setUsers] = useState(null);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    chatbotApi.manage('list_users', {})
      .then(r => setUsers(r.data || []))
      .catch(() => setUsers([]))
      .finally(() => setFetching(false));
  }, []);

  const ROLE_COLORS = { admin: '#6366f1', supervisor: '#8b5cf6', analyst: '#3b82f6', reviewer: '#22c55e' };

  return (
    <div className="cb-crud-form">
      <div className="cb-crud-form-header">
        <span>👥 User Management</span>
        <button className="cb-icon-btn" onClick={onCancel} style={{ background: 'rgba(0,0,0,0.1)', color: '#555' }}>✕</button>
      </div>
      {fetching ? (
        <div style={{ padding: '12px', textAlign: 'center', color: '#64748b', fontSize: '0.82rem' }}>Loading users…</div>
      ) : !users?.length ? (
        <div style={{ padding: '12px', textAlign: 'center', color: '#64748b', fontSize: '0.82rem' }}>No users found.</div>
      ) : (
        <div style={{ maxHeight: 230, overflowY: 'auto' }}>
          {users.map(u => (
            <div key={u.user_id} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: '0.76rem' }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong>{u.username}</strong> <span style={{ color: '#64748b' }}>({u.full_name})</span>
                <br />
                <span style={{ background: ROLE_COLORS[u.role] || '#64748b', color: '#fff', borderRadius: 3, padding: '1px 5px', fontSize: '0.65rem' }}>{u.role}</span>
                {!u.is_active && <span style={{ background: '#ef4444', color: '#fff', borderRadius: 3, padding: '1px 5px', fontSize: '0.65rem', marginLeft: 3 }}>disabled</span>}
              </span>
              <select style={{ fontSize: '0.68rem', padding: '2px 4px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff' }} value={u.role} onChange={e => onAction('update_user', { user_id: u.user_id, role: e.target.value })}>
                {['reviewer', 'analyst', 'supervisor', 'admin'].map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <button style={{ fontSize: '0.68rem', padding: '3px 6px', borderRadius: 4, border: 'none', cursor: 'pointer', background: u.is_active ? '#fef2f2' : '#f0fdf4', color: u.is_active ? '#ef4444' : '#16a34a', fontWeight: 600 }} onClick={() => onAction('update_user', { user_id: u.user_id, is_active: !u.is_active })}>
                {u.is_active ? 'Disable' : 'Enable'}
              </button>
              <button style={{ fontSize: '0.68rem', padding: '3px 6px', borderRadius: 4, border: 'none', cursor: 'pointer', background: '#fef2f2', color: '#ef4444' }} onClick={() => { if (window.confirm('Permanently delete user ' + u.username + '?')) onAction('delete_user', { user_id: u.user_id }); }}>🗑️</button>
            </div>
          ))}
        </div>
      )}
      <div className="cb-crud-actions" style={{ marginTop: 8 }}>
        <button className="cb-crud-cancel" onClick={onCancel}>Close</button>
      </div>
    </div>
  );
}

// ── Account Management Panel ──────────────────────────────────────────────────
function AccountPanel({ onAction, onCancel }) {
  const [accounts, setAccounts] = useState(null);
  const [fetching, setFetching] = useState(true);
  const [wlAcct, setWlAcct] = useState('');
  const [wlCo, setWlCo] = useState('');
  const [wlCoName, setWlCoName] = useState('');

  useEffect(() => {
    chatbotApi.manage('list_accounts', {})
      .then(r => setAccounts(r.data || []))
      .catch(() => setAccounts([]))
      .finally(() => setFetching(false));
  }, []);

  return (
    <div className="cb-crud-form">
      <div className="cb-crud-form-header">
        <span>🏦 Account Configuration</span>
        <button className="cb-icon-btn" onClick={onCancel} style={{ background: 'rgba(0,0,0,0.1)', color: '#555' }}>✕</button>
      </div>
      {fetching ? (
        <div style={{ padding: '12px', textAlign: 'center', color: '#64748b', fontSize: '0.82rem' }}>Loading accounts…</div>
      ) : !accounts?.length ? (
        <div style={{ padding: '12px', textAlign: 'center', color: '#64748b', fontSize: '0.82rem' }}>No accounts found.</div>
      ) : (
        <>
          <div style={{ maxHeight: 150, overflowY: 'auto' }}>
            {accounts.map(a => (
              <div key={a.account_id} style={{ padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: '0.76rem' }}>
                <strong>{a.account_name}</strong> <span style={{ color: '#94a3b8', fontSize: '0.68rem' }}>({a.account_id})</span>
                <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ color: '#64748b' }}>Mode:</span>
                  <select style={{ fontSize: '0.68rem', padding: '2px 4px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff' }} value={a.filter_mode} onChange={e => onAction('update_account', { account_id: a.account_id, filter_mode: e.target.value })}>
                    {['positive_pay', 'allow_list', 'block_all', 'reverse_positive_pay'].map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <span style={{ color: '#64748b' }}>Default:</span>
                  <select style={{ fontSize: '0.68rem', padding: '2px 4px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff' }} value={a.default_action} onChange={e => onAction('update_account', { account_id: a.account_id, default_action: e.target.value })}>
                    <option value="pay">Pay</option>
                    <option value="return">Return</option>
                  </select>
                  <span style={{ color: '#64748b' }}>Cutoff: {a.cutoff_time || 'N/A'}</span>
                  <span style={{ color: a.debit_block ? '#ef4444' : '#94a3b8' }}>DebitBlock: {a.debit_block ? '🔒 Yes' : 'No'}</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#475569', marginBottom: 6 }}>➕ Add to Whitelist</div>
            <div className="cb-crud-grid">
              <div className="cb-crud-field">
                <label>Account</label>
                <select className="cb-crud-input" value={wlAcct} onChange={e => setWlAcct(e.target.value)}>
                  <option value="">Select account…</option>
                  {accounts.map(a => <option key={a.account_id} value={a.account_id}>{a.account_name}</option>)}
                </select>
              </div>
              <div className="cb-crud-field">
                <label>Company ID *</label>
                <input className="cb-crud-input" value={wlCo} onChange={e => setWlCo(e.target.value)} placeholder="COMP001" />
              </div>
              <div className="cb-crud-field" style={{ gridColumn: '1 / -1' }}>
                <label>Company Name</label>
                <input className="cb-crud-input" value={wlCoName} onChange={e => setWlCoName(e.target.value)} placeholder="Acme Corp" />
              </div>
            </div>
            <button className="cb-crud-submit" style={{ width: '100%', marginTop: 4 }} onClick={() => {
              if (!wlAcct || !wlCo.trim()) { alert('Select account and enter company ID'); return; }
              onAction('whitelist_add', { account_id: wlAcct, company_id: wlCo.trim(), company_name: wlCoName.trim() });
              setWlCo(''); setWlCoName('');
            }}>➕ Add to Whitelist</button>
          </div>
        </>
      )}
      <div className="cb-crud-actions" style={{ marginTop: 8 }}>
        <button className="cb-crud-cancel" onClick={onCancel}>Close</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Chatbot Component
// ═══════════════════════════════════════════════════════════════════════════════
// ── Group sessions by recency (for sidebar labels) ───────────────────────────
function groupSessions(sessions) {
  const now   = new Date();
  const bod   = d => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
  const today = bod(now);
  const yest  = new Date(today); yest.setDate(today.getDate() - 1);
  const wk    = new Date(today); wk.setDate(today.getDate() - 7);
  const mo    = new Date(today); mo.setDate(today.getDate() - 30);
  const groups = [
    { label: 'Today',       items: [] },
    { label: 'Yesterday',   items: [] },
    { label: 'Last 7 Days', items: [] },
    { label: 'Last 30 Days',items: [] },
    { label: 'Older',       items: [] },
  ];
  sessions.forEach(s => {
    const d = new Date(s.last_message_at || s.updated_at || s.created_at);
    if      (d >= today) groups[0].items.push(s);
    else if (d >= yest)  groups[1].items.push(s);
    else if (d >= wk)    groups[2].items.push(s);
    else if (d >= mo)    groups[3].items.push(s);
    else                 groups[4].items.push(s);
  });
  return groups.filter(g => g.items.length > 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Chatbot Component
// ═══════════════════════════════════════════════════════════════════════════════
export default function Chatbot() {
  const { user } = useAuth();
  const isAdmin  = user?.role === 'admin';

  const makeWelcome = () => ({
    role: 'bot', source: 'system',
    content: '👋 **Hello! I\'m your ACH AI Assistant.**\n\nI have access to **live system data** and understand natural language. Ask me anything about transactions, risk, compliance, or trends.\n\n'
      + (user ? '🔐 Logged in as **' + user.full_name + '** (' + user.role + ')' : '')
      + (isAdmin ? '\n🔧 **Admin mode active** — full CRUD, exceptions, MIR, user & account management available.' : user ? '\n💡 You can **approve or reject** pending transactions directly in this chat!' : ''),
    timestamp: new Date().toISOString(),
  });

  const [open,             setOpen]             = useState(false);
  const [input,            setInput]            = useState('');
  const [messages,         setMessages]         = useState([makeWelcome()]);
  const [loading,          setLoading]          = useState(false);
  const [unread,           setUnread]           = useState(0);
  const [showQuick,        setShowQuick]        = useState(true);
  const [panelMode,        setPanelMode]        = useState(null);
  // Session persistence
  const [sessions,         setSessions]         = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [sessionsLoading,  setSessionsLoading]  = useState(false);
  const bottomRef  = useRef(null);
  const inputRef   = useRef(null);

  // Load sessions list whenever user logs in/out
  const loadSessions = useCallback(async () => {
    if (!user) { setSessions([]); return; }
    setSessionsLoading(true);
    try {
      const res = await chatbotApi.getSessions();
      setSessions(Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : []);
    } catch { setSessions([]); }
    finally { setSessionsLoading(false); }
  }, [user?.user_id]); // eslint-disable-line

  useEffect(() => { loadSessions(); }, [user?.user_id]); // eslint-disable-line

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, panelMode]);

  const addMsg = (role, content, source = 'ai') => {
    setMessages(prev => [...prev, { role, content, source, timestamp: new Date().toISOString() }]);
  };

  // ── Send chat message ──────────────────────────────────────────────────────
  const sendMessage = useCallback(async (text) => {
    const msg = (text || input).trim();
    if (!msg || loading) return;
    setInput('');
    setShowQuick(false);
    setPanelMode(null);

    const userMsg = { role: 'user', content: msg, source: 'user', timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      // Ensure session exists for authenticated users
      let sessId = currentSessionId;
      if (user && !sessId) {
        try {
          const sRes = await chatbotApi.createSession();
          sessId = sRes?.data?.session_id || sRes?.session_id;
          if (sessId) {
            setCurrentSessionId(sessId);
            loadSessions();
          }
        } catch { /* session creation failed — chat still works, just won't persist */ }
      }

      const history = messages.slice(-12).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
      const res = await chatbotApi.sendMessage(msg, history, sessId);
      const reply  = res.reply  || res.data?.reply  || 'No response.';
      const source = res.source || res.data?.source || 'ai';
      const botMsg = { role: 'bot', content: reply, source, timestamp: new Date().toISOString() };
      setMessages(prev => [...prev, botMsg]);
      if (!open) setUnread(u => u + 1);

      // Save both messages to server (fire-and-forget)
      if (sessId) {
        chatbotApi.saveSessionMsgs(sessId, [userMsg, botMsg])
          .then(r => {
            if (r?.title) {
              setSessions(prev => prev.map(s => s.session_id === sessId ? { ...s, title: r.title, last_message_at: botMsg.timestamp } : s));
            }
          })
          .catch(() => {});
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'bot', content: '⚠️ **Error:** ' + (e?.response?.data?.error || e.message || 'Connection failed.'), source: 'error', timestamp: new Date().toISOString() }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [input, loading, messages, open, currentSessionId, user]); // eslint-disable-line

  // ── Decision (approve/reject) via panel ────────────────────────────────────
  const handleDecision = useCallback(async (txnId, action, notes) => {
    setPanelMode(null);
    setShowQuick(false);
    const icon = action === 'approve' ? '✅' : '❌';
    addMsg('user', icon + ' ' + (action === 'approve' ? 'Approving' : 'Rejecting') + ' transaction **' + txnId + '**' + (notes ? ' — ' + notes : ''), 'user');
    setLoading(true);
    try {
      const res = await chatbotApi.decision(txnId, action, notes);
      const msg = res.message || res.data?.message || (icon + ' Transaction ' + txnId + ' has been ' + (action === 'approve' ? 'approved' : 'declined') + '.');
      addMsg('bot', msg, 'decision');
    } catch (e) {
      const errData = e?.response?.data;
      addMsg('bot', '⚠️ **' + (errData?.error || 'Error') + ':** ' + (errData?.message || e.message), 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  // ── CRUD via panel ─────────────────────────────────────────────────────────
  const handleCrud = useCallback(async (operation, txnId, data) => {
    setPanelMode(null);
    setShowQuick(false);
    addMsg('user', { create:'➕ Creating', read:'🔍 Reading', update:'✏️ Updating', delete:'🗑️ Deleting' }[operation] + ' transaction' + (txnId ? ' **' + txnId + '**' : '') + '…', 'user');
    setLoading(true);
    try {
      const res = await chatbotApi.crud(operation, txnId, data);
      const reply = res.message || res.data?.message || 'Operation completed.';
      addMsg('bot', '✅ ' + reply, 'crud');
    } catch (e) {
      const errData = e?.response?.data;
      if (errData?.error === 'Access Denied') {
        addMsg('bot', '🔒 **Access Denied** — Only **Admin** users can perform this operation.\n\nYour role: **' + (user?.role || 'Unknown') + '**', 'error');
      } else {
        addMsg('bot', '⚠️ **Error:** ' + (errData?.error || e.message), 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  // ── Manage operations (exceptions, MIR, users, accounts) ─────────────────
  const handleManage = useCallback(async (operation, data) => {
    setPanelMode(null);
    setShowQuick(false);
    const LABELS = {
      exception_decide: data?.decision === 'pay' ? '✅ Paying exception' : '❌ Returning exception',
      apply_defaults:   '⏰ Applying defaults to past-due exceptions',
      request_info:     '📨 Creating MIR request for',
      update_user:      '✏️ Updating user',
      delete_user:      '🗑️ Deleting user',
      update_account:   '✏️ Updating account',
      whitelist_add:    '➕ Adding to whitelist',
      whitelist_remove: '🗑️ Removing from whitelist',
    };
    const prefix = LABELS[operation] || '🔧 ' + operation;
    const suffix = data?.transaction_id ? ' **' + data.transaction_id + '**'
      : data?.user_id ? ' **' + data.user_id + '**'
      : data?.account_id ? ' **' + data.account_id + '**' : '…';
    addMsg('user', prefix + suffix, 'user');
    setLoading(true);
    try {
      const res = await chatbotApi.manage(operation, data);
      addMsg('bot', '✅ ' + (res.message || 'Operation completed.'), 'crud');
    } catch (e) {
      const errData = e?.response?.data;
      addMsg('bot', '⚠️ **Error:** ' + (errData?.error || e.message), 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleQuickAction = (action) => {
    if ((action === 'approve_ui' || action === 'reject_ui') && !user) {
      addMsg('bot', '🔒 **You must be logged in** to approve or reject transactions.', 'error');
      setShowQuick(false);
      return;
    }
    if (action === 'exceptions' && !user) {
      addMsg('bot', '🔒 **You must be logged in** to view exceptions.', 'error');
      setShowQuick(false);
      return;
    }
    if ((action === 'manage_users' || action === 'manage_accounts') && !isAdmin) {
      addMsg('bot', '🔒 **Admin Access Required** — Only admin users can access ' + action.replace('_', ' ') + '.\n\nYour role: **' + (user?.role || 'guest') + '**', 'error');
      setShowQuick(false);
      return;
    }
    if (action === 'request_info' && !isAdmin && user?.role !== 'supervisor') {
      addMsg('bot', '🔒 **Admin or Supervisor Required** — Only admin/supervisor can create MIR requests.\n\nYour role: **' + (user?.role || 'guest') + '**', 'error');
      setShowQuick(false);
      return;
    }
    if (!['approve_ui', 'reject_ui', 'read', 'exceptions', 'request_info', 'manage_users', 'manage_accounts'].includes(action) && !isAdmin) {
      addMsg('bot', '🔒 **Admin Access Required** — Only admin users can ' + action + ' transactions via the chatbot.\n\nYour role: **' + (user?.role || 'guest') + '**', 'error');
      setShowQuick(false);
      return;
    }
    setShowQuick(false);
    setPanelMode(action);
  };

  const handleOpen = () => {
    setOpen(true);
    setUnread(0);
    setTimeout(() => inputRef.current?.focus(), 200);
  };

  // ── New chat ───────────────────────────────────────────────────────────────
  const handleNewChat = useCallback(() => {
    setCurrentSessionId(null);
    setMessages([makeWelcome()]);
    setShowQuick(true);
    setPanelMode(null);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []); // eslint-disable-line

  // ── Load an existing session ───────────────────────────────────────────────
  const handleSelectSession = useCallback(async (sessionId) => {
    if (sessionId === currentSessionId) return;
    setCurrentSessionId(sessionId);
    setMessages([]);
    setShowQuick(false);
    setPanelMode(null);
    try {
      const res = await chatbotApi.getSessionMsgs(sessionId);
      const msgs = (res?.data || res || []).map(m => ({
        role:      m.role,
        content:   m.content,
        source:    m.source || (m.role === 'user' ? 'user' : 'ai'),
        timestamp: m.timestamp || m.created_at,
      }));
      setMessages(msgs.length > 0 ? msgs : [makeWelcome()]);
    } catch {
      setMessages([makeWelcome()]);
    }
  }, [currentSessionId]); // eslint-disable-line

  // ── Delete a session ───────────────────────────────────────────────────────
  const handleDeleteSession = useCallback(async (sessionId, e) => {
    e.stopPropagation();
    try {
      await chatbotApi.deleteSession(sessionId);
      setSessions(prev => prev.filter(s => s.session_id !== sessionId));
      if (currentSessionId === sessionId) handleNewChat();
    } catch { /* ignore */ }
  }, [currentSessionId]); // eslint-disable-line

  const sessionGroups = groupSessions(sessions);

  return (
    <>
      {/* ── FAB Button ──────────────────────────────────────────────────────── */}
      <button
        id="chatbot-trigger"
        className={`cb-fab ${open ? 'cb-fab-open' : ''}`}
        onClick={() => open ? setOpen(false) : handleOpen()}
        aria-label="Open ACH AI Chatbot"
      >
        <span className="cb-fab-icon">{open ? '✕' : '🤖'}</span>
        {!open && unread > 0 && <span className="cb-fab-badge">{unread}</span>}
        {!open && <span className="cb-fab-ring" />}
      </button>

      {/* ── Chat Window ─────────────────────────────────────────────────────── */}
      <div className={`cb-window ${open ? 'cb-window-open' : ''}`} role="dialog" aria-label="ACH AI Chatbot">

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        {user && (
          <aside className="cb-sidebar">
            <div className="cb-sidebar-top">
              <button className="cb-new-chat-btn" onClick={handleNewChat}>
                <span style={{ fontSize: '1rem' }}>✏️</span> New Chat
              </button>
            </div>

            <div className="cb-session-list">
              {sessionsLoading && (
                <div className="cb-sessions-loading">
                  <span className="cb-send-spinner" style={{ borderTopColor: '#6b7280' }} /> Loading…
                </div>
              )}

              {!sessionsLoading && sessions.length === 0 && (
                <div className="cb-sessions-empty">No conversations yet.<br />Start one below!</div>
              )}

              {sessionGroups.map(group => (
                <div key={group.label}>
                  <div className="cb-session-group-label">{group.label}</div>
                  {group.items.map(s => (
                    <div
                      key={s.session_id}
                      className={`cb-session-item ${s.session_id === currentSessionId ? 'active' : ''}`}
                      onClick={() => handleSelectSession(s.session_id)}
                    >
                      <span className="cb-session-title">{s.title || 'New Chat'}</span>
                      <button
                        className="cb-session-delete"
                        onClick={(e) => handleDeleteSession(s.session_id, e)}
                        title="Delete conversation"
                      >✕</button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </aside>
        )}

        {/* ── Main Chat Area ───────────────────────────────────────────────── */}
        <div className="cb-chat-area">

          {/* Header */}
          <div className="cb-header">
            <div className="cb-header-left">
              <div className="cb-header-avatar">🤖</div>
              <div>
                <div className="cb-header-name">ACH AI Assistant</div>
                <div className="cb-header-status">
                  <span className="cb-online-dot" />
                  Live Data · Context-Aware{isAdmin ? ' · Admin 🔧' : ''}
                </div>
              </div>
            </div>
            <div className="cb-header-actions">
              <button className="cb-icon-btn" onClick={handleNewChat} title="New chat">✏️</button>
              <button className="cb-icon-btn" onClick={() => setOpen(false)} title="Close">✕</button>
            </div>
          </div>

          {/* Messages */}
          <div className="cb-messages" id="cb-messages-container">
            {messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)}
            {loading && <TypingIndicator />}
            <div ref={bottomRef} />
          </div>

          {/* Decision / CRUD / Manage Panels */}
          {panelMode === 'approve_ui' || panelMode === 'reject_ui' ? (
            <DecisionPanel
              action={panelMode === 'approve_ui' ? 'approve' : 'decline'}
              onCancel={() => setPanelMode(null)}
              onSubmit={handleDecision}
            />
          ) : panelMode === 'exceptions' ? (
            <ExceptionsPanel onAction={handleManage} onCancel={() => setPanelMode(null)} isAdmin={isAdmin} />
          ) : panelMode === 'request_info' ? (
            <InfoRequestPanel onSubmit={handleManage} onCancel={() => setPanelMode(null)} />
          ) : panelMode === 'manage_users' ? (
            <UserManagePanel onAction={handleManage} onCancel={() => setPanelMode(null)} />
          ) : panelMode === 'manage_accounts' ? (
            <AccountPanel onAction={handleManage} onCancel={() => setPanelMode(null)} />
          ) : panelMode ? (
            <CrudForm action={panelMode} isAdmin={isAdmin} onCancel={() => setPanelMode(null)} onSubmit={handleCrud} />
          ) : null}

          {/* Quick Questions */}
          {showQuick && !panelMode && (
            <div className="cb-quick-section">
              <div className="cb-quick-header">
                <div className="cb-quick-title">💬 Ask me anything</div>
              </div>
              <div className="cb-quick-body">
                <div className="cb-quick-grid">
                  {QUICK_QUESTIONS.slice(0, 12).map((q, i) => (
                    <button key={i} className="cb-quick-btn" onClick={() => sendMessage(q.text)}>
                      <span className="cb-quick-icon">{q.icon}</span>
                      <span>{q.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="cb-crud-section">
                <div className="cb-quick-header" style={{ paddingTop: 6 }}>
                  <div className="cb-quick-title">{user ? '⚡ Actions' : '🔒 Actions (Login Required)'}</div>
                </div>
                <div className="cb-quick-body" style={{ paddingTop: 0 }}>
                  <div className="cb-quick-grid">
                    {ADMIN_QUICK.map((q, i) => {
                      const needsLogin  = ['approve_ui', 'reject_ui', 'exceptions'].includes(q.action);
                      const needsAdmin  = !['approve_ui', 'reject_ui', 'read', 'exceptions', 'request_info'].includes(q.action);
                      const needsSupAdm = q.action === 'request_info';
                      const locked = (needsLogin && !user) || (needsAdmin && !isAdmin) || (needsSupAdm && !isAdmin && user?.role !== 'supervisor');
                      const lockReason = !user ? 'Login required' : needsAdmin ? 'Admin required' : 'Admin or Supervisor required';
                      return (
                        <button
                          key={i}
                          className={`cb-quick-btn ${locked ? 'cb-quick-btn-locked' : ''}`}
                          onClick={() => handleQuickAction(q.action)}
                          title={locked ? lockReason : ''}
                        >
                          <span className="cb-quick-icon">{q.icon}</span>
                          <span>{q.label}</span>
                          {locked && <span className="cb-lock-icon">🔒</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <button className="cb-more-btn" onClick={() => setShowQuick(false)}>↑ Hide</button>
            </div>
          )}

          {/* Input */}
          {!panelMode && (
            <div className="cb-input-area">
              <div className="cb-input-wrapper">
                <textarea
                  ref={inputRef}
                  id="cb-input"
                  className="cb-input"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                  placeholder={user ? 'Ask anything… or type "approve TXN-XXXXX"' : 'Ask about transactions, risk, NACHA…'}
                  rows={1}
                  disabled={loading}
                />
                <button
                  id="cb-send-btn"
                  className="cb-send-btn"
                  onClick={() => sendMessage()}
                  disabled={!input.trim() || loading}
                >
                  {loading ? <span className="cb-send-spinner" /> : '➤'}
                </button>
              </div>
              {!showQuick && (
                <button className="cb-show-quick-btn" onClick={() => setShowQuick(true)}>⚡ Quick Questions & Actions</button>
              )}
            </div>
          )}

        </div>{/* end .cb-chat-area */}
      </div>
    </>
  );
}
