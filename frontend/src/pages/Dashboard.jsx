// frontend/src/pages/Dashboard.jsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { analyticsApi } from '../api/client';
import TransactionDetailModal from '../components/TransactionDetailModal';

function StatCard({ label, value, sub, icon, color, prefix = '', suffix = '' }) {
  return (
    <div className="stat-card" style={{ '--accent-color': color }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color }}>{prefix}{typeof value === 'number' ? value.toLocaleString() : value}{suffix}</div>
      {sub && <div className="stat-sub">{sub}</div>}
      <div className="stat-icon">{icon}</div>
    </div>
  );
}

function RiskDonut({ l1, l2, l3 }) {
  const total = l1 + l2 + l3 || 1;
  const p1 = Math.round((l1 / total) * 100);
  const p2 = Math.round((l2 / total) * 100);
  const p3 = 100 - p1 - p2;
  const r = 50, c = 2 * Math.PI * r;
  const d1 = (p1 / 100) * c, d2 = (p2 / 100) * c, d3 = (p3 / 100) * c;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
      <svg width="120" height="120" viewBox="0 0 120 120" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="#1a2035" strokeWidth="18" />
        <circle cx="60" cy="60" r={r} fill="none" stroke="#10b981" strokeWidth="18"
          strokeDasharray={`${d1} ${c - d1}`} strokeDashoffset="0" />
        <circle cx="60" cy="60" r={r} fill="none" stroke="#f59e0b" strokeWidth="18"
          strokeDasharray={`${d2} ${c - d2}`} strokeDashoffset={-d1} />
        <circle cx="60" cy="60" r={r} fill="none" stroke="#ef4444" strokeWidth="18"
          strokeDasharray={`${d3} ${c - d3}`} strokeDashoffset={-(d1 + d2)} />
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[['#10b981','Level 1 – Auto',l1,p1],['#f59e0b','Level 2 – Review',l2,p2],['#ef4444','Level 3 – High Risk',l3,p3]].map(([color,label,count,pct])=>(
          <div key={label} style={{ display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ width:10, height:10, borderRadius:'50%', background:color, flexShrink:0 }} />
            <span style={{ fontSize:'0.8rem', color:'var(--text-secondary)' }}>{label}</span>
            <span style={{ marginLeft:'auto', fontSize:'0.85rem', fontWeight:700, color }}>{count} <span style={{color:'var(--text-muted)',fontWeight:400}}>({pct}%)</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecentActivity({ items, onTxnClick }) {
  const icons = {
    transaction_created: '📥',
    auto_approved:       '✅',
    ai_processed:        '🤖',
    human_reviewed:      '👤',
    pattern_promoted:    '🚀',
    pattern_demoted:     '⬇️',
    risk_flagged:        '⚠️',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {items.length === 0 && <div className="empty-state" style={{ padding: '30px 0' }}><p>No activity yet</p></div>}
      {items.map((item, i) => (
        <div key={i}
          onClick={() => item.transaction_id && onTxnClick(item.transaction_id)}
          style={{
            display: 'flex', gap: 12, alignItems: 'flex-start',
            cursor: item.transaction_id ? 'pointer' : 'default',
            padding: '8px 10px', borderRadius: 8, marginLeft: -10, marginRight: -10,
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => { if (item.transaction_id) e.currentTarget.style.background = 'var(--bg-primary)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
          <div style={{ fontSize: '1.2rem', flexShrink: 0, marginTop: 2 }}>{icons[item.event_type] || '📌'}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-primary)' }}>{item.event_summary}</div>
            {item.company_name && (
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
                {item.company_name} {item.amount ? `· $${Number(item.amount).toLocaleString()}` : ''}
              </div>
            )}
            {item.transaction_id && (
              <div style={{ fontSize: '0.65rem', color: 'var(--accent-cyan)', marginTop: 2, fontFamily: 'monospace' }}>
                {item.transaction_id} · click to view →
              </div>
            )}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', flexShrink: 0 }}>
            {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [data, setData]               = useState(null);
  const [loading, setLoading]         = useState(true);
  const [selectedTxnId, setSelectedTxnId] = useState(null);
  const navigate = useNavigate();

  const load = () => {
    setLoading(true);
    analyticsApi.dashboard()
      .then(res => setData(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  // App.jsx already polls the dashboard endpoint every 60s for sidebar counts.
  // Load once on mount; manual refresh is available via the sidebar poll cycle.
  useEffect(() => { load(); }, []);

  if (loading && !data) return <div className="loading-center"><div className="spinner" /><p>Loading dashboard…</p></div>;
  if (!data) return <div className="loading-center"><p>Failed to load dashboard. Is the backend running?</p></div>;

  const { totals, values, riskDistribution, rates, today, learning, recentActivity } = data;

  return (
    <div>
      <div className="page-header">
        <h2>🏦 ACH Triage Dashboard</h2>
        <p>Real-time overview of AI-driven payment triage · NACHA Compliant</p>
      </div>

      <div className="stats-grid">
        <StatCard label="Total Transactions" value={totals.total} icon="💳" color="var(--accent-blue)" sub={`$${(values.totalValue/1000).toFixed(1)}K total value`} />
        <StatCard label="Auto-Approved (AI)" value={totals.autoApproved} icon="✅" color="var(--accent-green)" sub={`${rates.autoResolutionRate}% zero-touch rate`} />
        <StatCard label="Pending Review" value={totals.pending} icon="⏳" color="var(--accent-yellow)" sub="Human action required" />
        <StatCard label="Declined" value={totals.declined} icon="🚫" color="var(--accent-red)" sub="Fraud / policy violation" />
        <StatCard label="Avg Risk Score" value={rates.avgRiskScore} icon="📊" color="var(--accent-purple)" suffix="/100" sub="Across all transactions" />
        <StatCard label="Patterns Promoted" value={learning.promotedPatterns} icon="🧠" color="var(--accent-cyan)" sub={`${learning.totalHumanDecisions} human decisions total`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        {/* Risk Distribution */}
        <div className="card">
          <div className="card-title">Risk Level Distribution</div>
          <div style={{ marginTop: 16 }}>
            <RiskDonut l1={riskDistribution.level1} l2={riskDistribution.level2} l3={riskDistribution.level3} />
          </div>
        </div>

        {/* AI Learning Status */}
        <div className="card">
          <div className="card-title">🧠 AI Learning Status</div>
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              { label: 'Human Decision Patterns', val: learning.totalPatterns, color: 'var(--accent-blue)' },
              { label: 'Promoted to Auto-Approve', val: learning.promotedPatterns, color: 'var(--accent-green)' },
              { label: 'Total Human Decisions', val: learning.totalHumanDecisions, color: 'var(--accent-purple)' },
              { label: 'Promotion Rate', val: `${learning.promotionRate}%`, color: 'var(--accent-cyan)' },
            ].map(({ label, val, color }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{label}</span>
                <span style={{ fontSize: '0.9rem', fontWeight: 700, color }}>{val}</span>
              </div>
            ))}
            <hr className="divider" style={{ margin: '4px 0' }} />
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              The AI learns from every human decision. When a pattern reaches 85% approval confidence with ≥5 decisions, it is automatically promoted to Level 1 (zero-touch).
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Today's Activity */}
        <div className="card">
          <div className="card-title">Today's Activity</div>
          <div style={{ marginTop: 12, display: 'flex', gap: 24 }}>
            <div>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--accent-blue)' }}>{today.total}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Total processed</div>
            </div>
            <div>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--accent-green)' }}>{today.autoApproved}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Auto-approved</div>
            </div>
          </div>
          <div style={{ marginTop: 20 }}>
            <button className="btn btn-primary btn-sm" onClick={() => navigate('/intake')}>+ Add Transaction</button>
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={() => navigate('/queue')}>View Queue</button>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
            <div className="card-title">Recent Activity</div>
            <button className="btn btn-ghost btn-sm" onClick={load}>↻ Refresh</button>
          </div>
          <RecentActivity items={recentActivity || []} onTxnClick={setSelectedTxnId} />
        </div>
      </div>

      {selectedTxnId && (
        <TransactionDetailModal
          transactionId={selectedTxnId}
          onClose={() => setSelectedTxnId(null)}
        />
      )}
    </div>
  );
}
