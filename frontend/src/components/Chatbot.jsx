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
  { icon: '📚', label: 'NACHA Compliance',        text: 'Explain how this system ensures NACHA compliance.' },
  { icon: '🛡️', label: 'Positive Pay',            text: 'How does Positive Pay work in this system and what exceptions exist?' },
];

const ADMIN_QUICK = [
  { icon: '✅', label: 'Approve Transaction', action: 'approve_ui' },
  { icon: '❌', label: 'Reject Transaction',  action: 'reject_ui'  },
  { icon: '➕', label: 'Create Transaction',  action: 'create'     },
  { icon: '✏️', label: 'Update Transaction',  action: 'update'     },
  { icon: '🗑️', label: 'Delete Transaction',  action: 'delete'     },
  { icon: '🔍', label: 'Read Transaction',    action: 'read'       },
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

// ═══════════════════════════════════════════════════════════════════════════════
// Main Chatbot Component
// ═══════════════════════════════════════════════════════════════════════════════
export default function Chatbot() {
  const { user } = useAuth();
  const isAdmin  = user?.role === 'admin';

  const [open,       setOpen]       = useState(false);
  const [input,      setInput]      = useState('');
  const [messages,   setMessages]   = useState([
    {
      role: 'bot', source: 'system',
      content: '👋 **Hello! I\'m your ACH AI Assistant.**\n\nI have access to **live system data** and understand natural language. Ask me anything about your transactions, risk analysis, compliance, or trends.\n\n'
        + (user ? '🔐 Logged in as **' + user.full_name + '** (' + user.role + ')' : '')
        + (isAdmin ? '\n🔧 **Admin mode active** — you can approve, reject, create, update, and delete transactions via chat or the buttons below.' : user ? '\n💡 You can **approve or reject** pending transactions directly in this chat!' : ''),
      timestamp: new Date().toISOString(),
    }
  ]);
  const [loading,    setLoading]    = useState(false);
  const [unread,     setUnread]     = useState(0);
  const [showQuick,  setShowQuick]  = useState(true);
  const [panelMode,  setPanelMode]  = useState(null); // 'approve_ui'|'reject_ui'|'create'|'read'|'update'|'delete'|null
  const bottomRef  = useRef(null);
  const inputRef   = useRef(null);

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
    addMsg('user', msg, 'user');
    setLoading(true);
    try {
      const history = messages.slice(-12).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
      const res = await chatbotApi.sendMessage(msg, history);
      const reply  = res.reply  || res.data?.reply  || 'No response.';
      const source = res.source || res.data?.source || 'ai';
      addMsg('bot', reply, source);
      if (!open) setUnread(u => u + 1);
    } catch (e) {
      addMsg('bot', '⚠️ **Error:** ' + (e?.response?.data?.error || e.message || 'Connection failed.'), 'error');
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [input, loading, messages, open]);

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

  const handleQuickAction = (action) => {
    if ((action === 'approve_ui' || action === 'reject_ui') && !user) {
      addMsg('bot', '🔒 **You must be logged in** to approve or reject transactions.', 'error');
      setShowQuick(false);
      return;
    }
    if (!['approve_ui', 'reject_ui', 'read'].includes(action) && !isAdmin) {
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

  const clearChat = () => {
    setPanelMode(null);
    setMessages([{
      role: 'bot', source: 'system',
      content: '👋 Chat cleared. What can I help you with?',
      timestamp: new Date().toISOString()
    }]);
    setShowQuick(true);
  };

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
            <button className="cb-icon-btn" onClick={clearChat} title="Clear chat">🗑️</button>
            <button className="cb-icon-btn" onClick={() => setOpen(false)} title="Close">✕</button>
          </div>
        </div>

        {/* Messages */}
        <div className="cb-messages" id="cb-messages-container">
          {messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)}
          {loading && <TypingIndicator />}
          <div ref={bottomRef} />
        </div>

        {/* Decision / CRUD Panel */}
        {panelMode && (panelMode === 'approve_ui' || panelMode === 'reject_ui') ? (
          <DecisionPanel
            action={panelMode === 'approve_ui' ? 'approve' : 'decline'}
            onCancel={() => setPanelMode(null)}
            onSubmit={handleDecision}
          />
        ) : panelMode ? (
          <CrudForm
            action={panelMode}
            isAdmin={isAdmin}
            onCancel={() => setPanelMode(null)}
            onSubmit={handleCrud}
          />
        ) : null}

        {/* Quick Questions */}
        {showQuick && !panelMode && (
          <div className="cb-quick-section">
            <div className="cb-quick-title">💬 Ask me anything</div>
            <div className="cb-quick-grid">
              {QUICK_QUESTIONS.slice(0, 8).map((q, i) => (
                <button key={i} id={`cb-quick-${i}`} className="cb-quick-btn" onClick={() => sendMessage(q.text)}>
                  <span className="cb-quick-icon">{q.icon}</span>
                  <span>{q.label}</span>
                </button>
              ))}
            </div>

            {/* Actions Section */}
            <div className="cb-crud-section">
              <div className="cb-quick-title" style={{ marginTop: 10 }}>
                {user ? '⚡ Transaction Actions' : '🔒 Transaction Actions (Login Required)'}
              </div>
              <div className="cb-quick-grid">
                {ADMIN_QUICK.map((q, i) => {
                  const needsAdmin = !['approve_ui', 'reject_ui', 'read'].includes(q.action);
                  const needsLogin = ['approve_ui', 'reject_ui'].includes(q.action);
                  const locked = (needsAdmin && !isAdmin) || (needsLogin && !user);
                  return (
                    <button
                      key={i}
                      id={`cb-action-${q.action}`}
                      className={`cb-quick-btn ${locked ? 'cb-quick-btn-locked' : ''}`}
                      onClick={() => handleQuickAction(q.action)}
                      title={locked ? (needsAdmin ? 'Admin required' : 'Login required') : ''}
                    >
                      <span className="cb-quick-icon">{q.icon}</span>
                      <span>{q.label}</span>
                      {locked && <span className="cb-lock-icon">🔒</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            <button className="cb-more-btn" onClick={() => setShowQuick(false)}>Hide suggestions</button>
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
      </div>
    </>
  );
}
