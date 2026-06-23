// frontend/src/pages/Dashboard.jsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { analyticsApi } from '../api/client';
import TransactionDetailModal from '../components/TransactionDetailModal';

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon, color, suffix = '', onClick }) {
  return (
    <div className="stat-card" style={{ '--accent-color': color, cursor: onClick ? 'pointer' : 'default' }} onClick={onClick}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color }}>{typeof value === 'number' ? value.toLocaleString() : value}{suffix}</div>
      {sub && <div className="stat-sub">{sub}</div>}
      <div className="stat-icon">{icon}</div>
    </div>
  );
}

// ── Risk Donut ────────────────────────────────────────────────────────────────
function RiskDonut({ l1, l2, l3 }) {
  const total = l1 + l2 + l3 || 1;
  const p1 = Math.round((l1 / total) * 100);
  const p2 = Math.round((l2 / total) * 100);
  const p3 = 100 - p1 - p2;
  const r = 50, c = 2 * Math.PI * r;
  const d1 = (p1 / 100) * c, d2 = (p2 / 100) * c, d3 = (p3 / 100) * c;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
      <svg width="120" height="120" viewBox="0 0 120 120" style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="#1a2035" strokeWidth="18" />
        <circle cx="60" cy="60" r={r} fill="none" stroke="#10b981" strokeWidth="18" strokeDasharray={`${d1} ${c-d1}`} strokeDashoffset="0" />
        <circle cx="60" cy="60" r={r} fill="none" stroke="#f59e0b" strokeWidth="18" strokeDasharray={`${d2} ${c-d2}`} strokeDashoffset={-d1} />
        <circle cx="60" cy="60" r={r} fill="none" stroke="#ef4444" strokeWidth="18" strokeDasharray={`${d3} ${c-d3}`} strokeDashoffset={-(d1+d2)} />
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[['#10b981','Level 1 – Auto',l1,p1],['#f59e0b','Level 2 – Review',l2,p2],['#ef4444','Level 3 – High Risk',l3,p3]].map(([col,label,count,pct]) => (
          <div key={label} style={{ display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ width:10,height:10,borderRadius:'50%',background:col,flexShrink:0 }} />
            <span style={{ fontSize:'0.8rem',color:'var(--text-secondary)' }}>{label}</span>
            <span style={{ marginLeft:'auto',fontSize:'0.85rem',fontWeight:700,color:col }}>{count} <span style={{color:'var(--text-muted)',fontWeight:400}}>({pct}%)</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Status breakdown donut (new — shows all 7 statuses) ───────────────────────
function StatusBreakdown({ totals }) {
  const items = [
    { label: 'Auto-Approved', value: totals.autoApproved || 0, color: '#10b981' },
    { label: 'Approved',      value: totals.approved     || 0, color: '#34d399' },
    { label: 'Declined',      value: totals.declined     || 0, color: '#ef4444' },
    { label: 'Under Review',  value: totals.pending      || 0, color: '#f59e0b' },
    { label: 'More Info Req', value: totals.more_info_required || 0, color: '#f97316' },
    { label: 'AI Workflow',   value: totals.ai_workflow  || 0, color: '#8b5cf6' },
  ];
  const total = items.reduce((a, i) => a + i.value, 0) || 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map(item => (
        <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', width: 110 }}>{item.label}</span>
          <div style={{ flex: 1, background: 'var(--bg-primary)', borderRadius: 3, height: 6, overflow: 'hidden' }}>
            <div style={{ width: `${Math.round((item.value / total) * 100)}%`, height: '100%', background: item.color, borderRadius: 3, transition: 'width 0.6s ease' }} />
          </div>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: item.color, width: 28, textAlign: 'right' }}>{item.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── MIR Workflow Panel ────────────────────────────────────────────────────────
function MirPanel({ mir, learning, onViewMir, onViewQueue }) {
  if (!mir) return null;
  const autonomyRate = mir.completedLifecycles > 0
    ? Math.round((mir.aiHandled / mir.completedLifecycles) * 100)
    : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Autonomy progress bar */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 6 }}>
          <span>AI Autonomy Rate</span>
          <span style={{ fontWeight: 700, color: autonomyRate >= 50 ? 'var(--accent-green)' : 'var(--accent-yellow)' }}>{autonomyRate}%</span>
        </div>
        <div style={{ height: 8, background: 'var(--bg-primary)', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{ width: `${autonomyRate}%`, height: '100%', background: 'linear-gradient(90deg, var(--accent-purple), var(--accent-blue))', borderRadius: 99, transition: 'width 0.8s ease' }} />
        </div>
        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 4 }}>
          {mir.aiHandled} of {mir.completedLifecycles} completed workflows handled fully by AI
        </div>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '2px 0' }} />

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[
          ['Autonomous Patterns', learning?.autonomousPatterns || 0, 'var(--accent-purple)'],
          ['Avg MIR Rounds',      mir.avgRoundsToResolve || '—',    'var(--accent-blue)'],
          ['Pending Responses',   mir.pendingInfoRequests || 0,     mir.pendingInfoRequests > 0 ? 'var(--accent-yellow)' : 'var(--accent-green)'],
          ['Overdue SLA',         mir.overdueInfoRequests || 0,     mir.overdueInfoRequests > 0 ? 'var(--accent-red)' : 'var(--text-muted)'],
        ].map(([label, val, color]) => (
          <div key={label} style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '8px 12px' }}>
            <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color }}>{val}</div>
          </div>
        ))}
      </div>

      {/* SLA warning */}
      {mir.overdueInfoRequests > 0 && (
        <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, fontSize: '0.78rem', color: 'var(--accent-red)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>⚠️ {mir.overdueInfoRequests} info request{mir.overdueInfoRequests > 1 ? 's' : ''} past SLA deadline</span>
          <button className="btn btn-sm" style={{ fontSize: '0.68rem', padding: '3px 10px', background: 'rgba(239,68,68,0.12)', color: 'var(--accent-red)', border: '1px solid rgba(239,68,68,0.3)' }} onClick={onViewMir}>
            Review →
          </button>
        </div>
      )}

      {/* Pending MIR */}
      {mir.pendingInfoRequests > 0 && mir.overdueInfoRequests === 0 && (
        <div style={{ padding: '8px 12px', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, fontSize: '0.78rem', color: 'var(--accent-yellow)' }}>
          🔄 {mir.pendingInfoRequests} originator response{mir.pendingInfoRequests > 1 ? 's' : ''} pending
        </div>
      )}

      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
        Once a pattern accumulates ≥5 unique transactions at ≥85% confidence, the AI replays the full workflow autonomously — sending info requests, evaluating responses, and approving or declining without human intervention.
      </div>
    </div>
  );
}

// ── Recent Activity feed ──────────────────────────────────────────────────────
const EVENT_ICONS = {
  transaction_created:      '📥',
  auto_approved:            '✅',
  ai_processed:             '🤖',
  ai_workflow_started:      '🤖',
  ai_workflow_queued:       '🤖',
  ai_auto_approved:         '🤖',
  ai_auto_declined:         '🤖',
  ai_escalated_to_human:    '⚠️',
  ai_info_requested:        '🤖',
  ai_followup_requested:    '🤖',
  human_reviewed:           '👤',
  human_approved:           '✅',
  human_declined:           '🚫',
  human_override:           '👤',
  info_requested:           '🔄',
  originator_response_submitted: '📨',
  transaction_resubmitted:  '🔄',
  portal_link_opened:       '🔗',
  pattern_promoted:         '🚀',
  pattern_demoted:          '⬇️',
  risk_flagged:             '⚠️',
  mir_escalation_required:  '⚠️',
};

const ACTOR_COLORS = {
  HUMAN:        'var(--accent-blue)',
  AI:           'var(--accent-purple)',
  AI_AUTOMATION:'var(--accent-purple)',
  ORIGINATOR:   'var(--accent-cyan)',
  SYSTEM:       'var(--text-muted)',
};

function RecentActivity({ items, onTxnClick }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {items.length === 0 && (
        <div className="empty-state" style={{ padding: '30px 0' }}><p>No activity yet</p></div>
      )}
      {items.map((item, i) => {
        const actorColor = ACTOR_COLORS[item.actor] || 'var(--text-muted)';
        const isAiAuto   = item.actor === 'AI_AUTOMATION';
        return (
          <div key={i}
            onClick={() => item.transaction_id && onTxnClick(item.transaction_id)}
            style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: item.transaction_id ? 'pointer' : 'default', padding: '7px 10px', borderRadius: 8, marginLeft: -10, marginRight: -10, transition: 'background 0.15s' }}
            onMouseEnter={e => { if (item.transaction_id) e.currentTarget.style.background = 'var(--bg-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
            <div style={{ fontSize: '1.1rem', flexShrink: 0, marginTop: 2 }}>{EVENT_ICONS[item.event_type] || '📌'}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>{item.event_summary}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                {item.company_name && <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{item.company_name}{item.amount ? ` · $${Number(item.amount).toLocaleString()}` : ''}</span>}
                {item.actor && (
                  <span style={{ fontSize: '0.62rem', fontWeight: 700, color: actorColor, background: `${actorColor}18`, padding: '1px 6px', borderRadius: 99 }}>
                    {isAiAuto ? '🤖 AI_AUTO' : item.actor}
                  </span>
                )}
                {item.transaction_id && <span style={{ fontSize: '0.62rem', color: 'var(--accent-cyan)', fontFamily: 'monospace' }}>{item.transaction_id}</span>}
              </div>
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', flexShrink: 0, textAlign: 'right' }}>
              {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Mini trend sparkline ──────────────────────────────────────────────────────
function Sparkline({ data, color = 'var(--accent-blue)', height = 40 }) {
  if (!data?.length) return null;
  const max   = Math.max(...data, 1);
  const w     = 140;
  const step  = w / Math.max(data.length - 1, 1);
  const pts   = data.map((v, i) => `${Math.round(i * step)},${Math.round(height - (v / max) * height)}`).join(' ');
  return (
    <svg width={w} height={height} style={{ overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {data.map((v, i) => (
        <circle key={i} cx={Math.round(i * step)} cy={Math.round(height - (v / max) * height)} r="2.5" fill={color} />
      ))}
    </svg>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [data,          setData]          = useState(null);
  const [trends,        setTrends]        = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [selectedTxnId, setSelectedTxnId] = useState(null);
  const navigate = useNavigate();

  const load = () => {
    setLoading(true);
    Promise.all([analyticsApi.dashboard(), analyticsApi.trends(7)])
      .then(([dash, tr]) => {
        setData(dash.data);
        setTrends(tr.data || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, []);

  if (loading && !data) return <div className="loading-center"><div className="spinner" /><p>Loading dashboard…</p></div>;
  if (!data) return <div className="loading-center"><p>Failed to load. Is the backend running?</p></div>;

  const { totals, values, riskDistribution, rates, today, learning, recentActivity, mir } = data;
  const hasAiWorkflow = (totals?.ai_workflow || 0) + (learning?.autonomousPatterns || 0) > 0;

  // Sparkline data from trends
  const sparkApproved  = trends.slice(-7).map(d => d.auto_approved + (d.human_reviewed || 0));
  const sparkRisk      = trends.slice(-7).map(d => d.avg_risk_score || 0);

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2>🏦 ACH Triage Dashboard</h2>
          <p>Real-time overview · AI-driven triage · NACHA Compliant · MIR Autonomous Workflow</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={load} style={{ marginTop: 4 }}>↻ Refresh</button>
      </div>

      {/* ── Row 1: Core KPIs ──────────────────────────────────────────────── */}
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <StatCard label="Total Transactions"  value={totals.total}       icon="💳" color="var(--accent-blue)"   sub={`$${(values.totalValue/1000).toFixed(1)}K total value`} />
        <StatCard label="Auto-Approved (AI)"  value={totals.autoApproved}icon="✅" color="var(--accent-green)"  sub={`${rates.autoResolutionRate}% zero-touch rate`} />
        <StatCard label="Pending Review"      value={totals.pending}     icon="⏳" color="var(--accent-yellow)" sub="Human action required" onClick={() => navigate('/queue')} />
        <StatCard label="Declined"            value={totals.declined}    icon="🚫" color="var(--accent-red)"    sub="Fraud / policy violation" />
        <StatCard label="Patterns Promoted"   value={learning.promotedPatterns} icon="🧠" color="var(--accent-cyan)" sub={`${learning.totalHumanDecisions} human decisions`} onClick={() => navigate('/analytics')} />
        <StatCard label="Avg Risk Score"      value={rates.avgRiskScore} icon="📊" color="var(--accent-purple)" suffix="/100" sub="Across all transactions" />
      </div>

      {/* ── Row 2: MIR KPIs (shown only when MIR activity exists) ─────────── */}
      {(mir?.totalLifecycles > 0 || mir?.pendingInfoRequests > 0 || hasAiWorkflow) && (
        <div className="stats-grid" style={{ marginBottom: 20, gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <StatCard label="More Info Required" value={totals.more_info_required || 0} icon="🔄" color="var(--accent-yellow)" sub="Awaiting originator" onClick={() => navigate('/queue')} />
          <StatCard label="AI Workflow Active" value={totals.ai_workflow || 0}        icon="🤖" color="var(--accent-purple)" sub="Autonomous in progress" />
          <StatCard label="Pending Responses"  value={mir?.pendingInfoRequests || 0}  icon="📨" color={mir?.overdueInfoRequests > 0 ? 'var(--accent-red)' : 'var(--accent-blue)'} sub={mir?.overdueInfoRequests > 0 ? `${mir.overdueInfoRequests} overdue` : 'All within SLA'} onClick={() => navigate('/exceptions')} />
          <StatCard label="AI Handled (MIR)"   value={mir?.aiHandled || 0}            icon="🤖" color="var(--accent-green)"  sub={`of ${mir?.completedLifecycles || 0} total workflows`} />
        </div>
      )}

      {/* ── Row 3: Charts ─────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>

        {/* Risk Distribution */}
        <div className="card">
          <div className="card-title">Risk Level Distribution</div>
          <div style={{ marginTop: 16 }}>
            <RiskDonut l1={riskDistribution.level1} l2={riskDistribution.level2} l3={riskDistribution.level3} />
          </div>
        </div>

        {/* Status Breakdown */}
        <div className="card">
          <div className="card-title">Transaction Status Breakdown</div>
          <div style={{ marginTop: 16 }}>
            <StatusBreakdown totals={totals} />
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 24 }}>
            <div>
              <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 3 }}>7-Day Approvals</div>
              <Sparkline data={sparkApproved} color="var(--accent-green)" />
            </div>
            <div>
              <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 3 }}>7-Day Avg Risk</div>
              <Sparkline data={sparkRisk} color="var(--accent-red)" />
            </div>
          </div>
        </div>
      </div>

      {/* ── Row 4: AI Learning + MIR Panel ────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>

        {/* AI Learning Status */}
        <div className="card">
          <div className="card-title">🧠 AI Learning Status</div>
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { label: 'Unique Patterns Learned',    val: learning.totalPatterns,     color: 'var(--accent-blue)'   },
              { label: 'Promoted to Auto-Approve',   val: learning.promotedPatterns,  color: 'var(--accent-green)'  },
              { label: 'Autonomous MIR Patterns',    val: learning.autonomousPatterns || 0, color: 'var(--accent-purple)' },
              { label: 'Total Human Decisions',      val: learning.totalHumanDecisions,color:'var(--accent-cyan)'  },
              { label: 'Total MIR Events',           val: learning.totalMirDecisions || 0, color: 'var(--accent-yellow)' },
              { label: 'Promotion Rate',             val: `${learning.promotionRate}%`, color: 'var(--accent-cyan)' },
            ].map(({ label, val, color }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{label}</span>
                <span style={{ fontSize: '0.88rem', fontWeight: 700, color }}>{val}</span>
              </div>
            ))}

            {/* Promotion progress bar */}
            <div style={{ marginTop: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: 5 }}>
                <span>Pattern promotion rate</span>
                <span>{learning.promotionRate}%</span>
              </div>
              <div style={{ height: 6, background: 'var(--bg-primary)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ width: `${learning.promotionRate}%`, height: '100%', background: 'var(--accent-green)', borderRadius: 99, transition: 'width 0.6s ease' }} />
              </div>
            </div>

            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.6, marginTop: 2 }}>
              Patterns need ≥5 unique transactions at ≥85% confidence to promote.
            </div>
            <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={() => navigate('/analytics')}>
              View all patterns →
            </button>
          </div>
        </div>

        {/* MIR Autonomous Workflow Panel */}
        <div className="card" style={{ borderColor: hasAiWorkflow ? 'rgba(139,92,246,0.25)' : undefined }}>
          <div className="card-title">🤖 MIR Autonomous Workflow</div>
          <div style={{ marginTop: 16 }}>
            <MirPanel
              mir={mir}
              learning={learning}
              onViewMir={() => navigate('/exceptions')}
              onViewQueue={() => navigate('/queue')}
            />
          </div>
        </div>
      </div>

      {/* ── Row 5: Today's Activity + Recent Activity ──────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20 }}>

        {/* Today */}
        <div className="card">
          <div className="card-title">Today's Activity</div>
          <div style={{ marginTop: 12, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--accent-blue)', lineHeight: 1 }}>{today.total}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>Total processed</div>
            </div>
            <div>
              <div style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--accent-green)', lineHeight: 1 }}>{today.autoApproved}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>Auto-approved</div>
            </div>
            {(today.more_info_required || 0) > 0 && (
              <div>
                <div style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--accent-yellow)', lineHeight: 1 }}>{today.more_info_required}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>More info req</div>
              </div>
            )}
            {(today.ai_workflow || 0) > 0 && (
              <div>
                <div style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--accent-purple)', lineHeight: 1 }}>{today.ai_workflow}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>AI workflows</div>
              </div>
            )}
          </div>
          <div style={{ marginTop: 20, display: 'flex', gap: 8, flexDirection: 'column' }}>
            <button className="btn btn-primary btn-sm" onClick={() => navigate('/intake')}>+ Add Transaction</button>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/queue')}>Review Queue {totals.pending > 0 ? `(${totals.pending})` : ''}</button>
            {(totals.more_info_required || 0) > 0 && (
              <button className="btn btn-sm" style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--accent-yellow)', border: '1px solid rgba(245,158,11,0.3)', fontSize: '0.78rem', padding: '6px 12px', borderRadius: 6, cursor: 'pointer' }} onClick={() => navigate('/exceptions')}>
                🔄 {totals.more_info_required} Awaiting Info
              </button>
            )}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <div className="card-title">Recent Activity</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>auto-refreshes every 20s</span>
              <button className="btn btn-ghost btn-sm" onClick={load}>↻</button>
            </div>
          </div>
          <RecentActivity items={recentActivity || []} onTxnClick={setSelectedTxnId} />
        </div>
      </div>

      {selectedTxnId && (
        <TransactionDetailModal transactionId={selectedTxnId} onClose={() => setSelectedTxnId(null)} />
      )}
    </div>
  );
}