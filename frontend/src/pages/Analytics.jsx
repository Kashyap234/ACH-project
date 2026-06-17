// frontend/src/pages/Analytics.jsx
import { useState, useEffect } from 'react';
import { analyticsApi } from '../api/client';
import TransactionDetailModal from '../components/TransactionDetailModal';

function BarChart({ data, labelKey, valueKey, color = 'var(--accent-blue)', maxVal }) {
  if (!data?.length) return <div className="empty-state" style={{ padding: '20px 0' }}><p>No data yet</p></div>;
  const max = maxVal || Math.max(...data.map(d => d[valueKey] || 0), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {data.map((item, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 80, fontSize: '0.72rem', color: 'var(--text-secondary)', textAlign: 'right', flexShrink: 0 }}>
            {String(item[labelKey]).slice(0, 12)}
          </div>
          <div style={{ flex: 1, background: 'var(--bg-primary)', borderRadius: 4, height: 24, overflow: 'hidden' }}>
            <div style={{ width: `${Math.round(((item[valueKey] || 0) / max) * 100)}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.6s ease', minWidth: item[valueKey] > 0 ? 4 : 0 }} />
          </div>
          <div style={{ width: 36, fontSize: '0.75rem', fontWeight: 700, color, textAlign: 'right' }}>{item[valueKey] || 0}</div>
        </div>
      ))}
    </div>
  );
}

function PatternDetailModal({ pattern, onClose }) {
  if (!pattern) return null;
  const fv = pattern.feature_vector || pattern.last_feature_vector || {};
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 620, width: '95vw' }}>
        <div className="modal-header">
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
              {pattern.promoted_to_level1 && (
                <span style={{ fontSize: '0.72rem', background: 'rgba(16,185,129,0.15)', color: '#34d399', padding: '2px 10px', borderRadius: 99, fontWeight: 700 }}>🚀 AUTO-APPROVE</span>
              )}
              {pattern.is_frozen && (
                <span style={{ fontSize: '0.72rem', background: 'rgba(239,68,68,0.15)', color: 'var(--accent-red)', padding: '2px 10px', borderRadius: 99, fontWeight: 700 }}>🔒 FROZEN</span>
              )}
            </div>
            <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>{pattern.pattern_description}</h3>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: 2 }}>Hash: {pattern.pattern_hash}</div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {/* Stats grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 16 }}>
            {[
              ['Total Decisions', pattern.total_decisions, 'var(--accent-blue)'],
              ['Approved', pattern.approve_count, 'var(--accent-green)'],
              ['Declined', pattern.decline_count, 'var(--accent-red)'],
              ['Confidence', `${Math.round((pattern.confidence_score || 0) * 100)}%`, pattern.confidence_score >= 0.85 ? 'var(--accent-green)' : pattern.confidence_score >= 0.5 ? 'var(--accent-yellow)' : 'var(--accent-red)'],
              ['Demotion Count', pattern.demotion_count || 0, 'var(--text-secondary)'],
              ['Avg Review Time', pattern.avg_time_to_decide ? `${Math.round(pattern.avg_time_to_decide)}s` : '—', 'var(--text-secondary)'],
            ].map(([l, v, c]) => (
              <div key={l} style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>{l}</div>
                <div style={{ fontWeight: 700, color: c, fontSize: '0.9rem' }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Approval bar */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 2, height: 8, borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ width: `${Math.round((pattern.approve_count / Math.max(pattern.total_decisions, 1)) * 100)}%`, background: 'var(--accent-green)', transition: 'width 0.6s ease' }} />
              <div style={{ flex: 1, background: 'var(--accent-red)', opacity: 0.6 }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 4 }}>
              <span>✓ {pattern.approve_count} approved ({Math.round((pattern.approve_count / Math.max(pattern.total_decisions, 1)) * 100)}%)</span>
              <span>✗ {pattern.decline_count} declined</span>
            </div>
          </div>

          {/* Feature Vector */}
          {Object.keys(fv).length > 0 && (
            <div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Feature Vector</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {Object.entries(fv).filter(([, v]) => v !== null && v !== false && v !== 'UNKNOWN').map(([k, v]) => (
                  <span key={k} style={{ fontSize: '0.68rem', background: 'var(--bg-primary)', color: 'var(--text-secondary)', padding: '2px 8px', borderRadius: 4 }}>
                    <span style={{ color: 'var(--text-muted)' }}>{k}:</span> {Array.isArray(v) ? v.join(', ') || '—' : String(v)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Flag codes */}
          {fv.flag_codes?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Triggered Rule Codes</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {fv.flag_codes.map(code => (
                  <span key={code} style={{ fontFamily: 'monospace', fontSize: '0.72rem', background: 'rgba(239,68,68,0.1)', color: 'var(--accent-red)', padding: '2px 8px', borderRadius: 4 }}>{code}</span>
                ))}
              </div>
            </div>
          )}

          {/* Promotion info */}
          {pattern.promoted_to_level1 && pattern.promotion_date && (
            <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 8, fontSize: '0.78rem' }}>
              <div style={{ color: 'var(--accent-green)', fontWeight: 600, marginBottom: 4 }}>🚀 Promoted to Level 1 Auto-Approve</div>
              <div style={{ color: 'var(--text-muted)' }}>{new Date(pattern.promotion_date).toLocaleString()}</div>
              {pattern.promotion_reason && <div style={{ color: 'var(--text-secondary)', marginTop: 4 }}>{pattern.promotion_reason}</div>}
            </div>
          )}
        </div>
        <div className="modal-footer" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function LearningCurve({ patterns, onPatternClick }) {
  if (!patterns?.length) return <div className="empty-state" style={{ padding: '20px 0' }}><p>No patterns yet — submit and decide some transactions to train the AI</p></div>;
  const maxDecisions = Math.max(...patterns.map(p => p.total_decisions), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {patterns.slice(0, 8).map(p => (
        <div key={p.id}
          onClick={() => onPatternClick(p)}
          style={{ background: 'var(--bg-primary)', borderRadius: 10, padding: '12px 16px', cursor: 'pointer', border: '1px solid transparent', transition: 'border-color 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-blue)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-primary)', fontWeight: 500, maxWidth: '60%' }}>{p.pattern_description}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {p.promoted_to_level1 ? (
                <span style={{ fontSize: '0.68rem', background: 'rgba(16,185,129,0.15)', color: '#34d399', padding: '2px 8px', borderRadius: 99, fontWeight: 700 }}>🚀 AUTO-APPROVE</span>
              ) : (
                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{p.total_decisions} decisions</span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', gap: 2, height: 6, borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ width: `${Math.round((p.approve_count / Math.max(p.total_decisions, 1)) * 100)}%`, background: 'var(--accent-green)', transition: 'width 0.6s ease' }} />
                <div style={{ flex: 1, background: 'var(--accent-red)', opacity: 0.6 }} />
              </div>
            </div>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: p.confidence_score >= 0.85 ? 'var(--accent-green)' : p.confidence_score >= 0.5 ? 'var(--accent-yellow)' : 'var(--accent-red)' }}>
              {Math.round((p.confidence_score || 0) * 100)}% approved
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
            <span style={{ fontSize: '0.68rem', color: 'var(--accent-green)' }}>✓ {p.approve_count} approved</span>
            <span style={{ fontSize: '0.68rem', color: 'var(--accent-red)' }}>✗ {p.decline_count} declined</span>
            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Need: {Math.max(0, p.min_decisions_required - p.total_decisions)} more for promotion</span>
            <span style={{ fontSize: '0.65rem', color: 'var(--accent-cyan)', marginLeft: 'auto' }}>click for details →</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Analytics() {
  const [dashboard, setDashboard] = useState(null);
  const [rules, setRules] = useState([]);
  const [patterns, setPatterns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPattern, setSelectedPattern] = useState(null);

  useEffect(() => {
    Promise.all([analyticsApi.dashboard(), analyticsApi.rules(), analyticsApi.patterns()])
      .then(([dash, r, p]) => {
        setDashboard(dash.data);
        setRules(r.data || []);
        setPatterns(p.data || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading-center"><div className="spinner" /><p>Loading analytics…</p></div>;

  const d = dashboard;
  const total = d?.totals?.total || 0;
  const autoRate = total > 0 ? Math.round((d.totals.autoApproved / total) * 100) : 0;

  return (
    <div>
      <div className="page-header">
        <h2>📊 Analytics & Insights</h2>
        <p>AI learning performance, rule effectiveness, and transaction trends</p>
      </div>

      {/* KPI Row */}
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        {[
          { label: 'Auto-Resolution Rate', value: `${autoRate}%`, icon: '🤖', color: 'var(--accent-green)', sub: 'Zero-touch transactions' },
          { label: 'Human Reviews Required', value: d?.totals?.pending || 0, icon: '👤', color: 'var(--accent-yellow)', sub: 'Pending Level 2 & 3 transactions' },
          { label: 'AI Patterns Learned', value: d?.learning?.totalPatterns || 0, icon: '🧠', color: 'var(--accent-purple)', sub: 'Unique risk profiles' },
          { label: 'Patterns Promoted', value: d?.learning?.promotedPatterns || 0, icon: '🚀', color: 'var(--accent-cyan)', sub: 'Now auto-approved' },
        ].map(({ label, value, icon, color, sub }) => (
          <div key={label} className="stat-card" style={{ '--accent-color': color }}>
            <div className="stat-label">{label}</div>
            <div className="stat-value" style={{ color }}>{value}</div>
            <div className="stat-sub">{sub}</div>
            <div className="stat-icon">{icon}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        {/* Decision Breakdown */}
        <div className="card">
          <div className="card-title">Decision Breakdown</div>
          <div style={{ marginTop: 16 }}>
            <BarChart
              data={[
                { label: 'Auto-Approved', count: d?.totals?.autoApproved || 0 },
                { label: 'Approved', count: d?.totals?.approved || 0 },
                { label: 'Declined', count: d?.totals?.declined || 0 },
                { label: 'Pending', count: d?.totals?.pending || 0 },
              ]}
              labelKey="label" valueKey="count"
              color="var(--accent-blue)"
            />
          </div>
        </div>

        {/* Top Triggered Rules */}
        <div className="card">
          <div className="card-title">Most Triggered Risk Rules</div>
          <div style={{ marginTop: 16 }}>
            <BarChart
              data={rules.slice(0, 6).map(r => ({ name: r.rule_name.split(' ').slice(0, 3).join(' '), count: r.trigger_count }))}
              labelKey="name" valueKey="count"
              color="var(--accent-red)"
            />
          </div>
        </div>
      </div>

      {/* Learning Curve */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div className="card-title">🧠 AI Learning Curve</div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4 }}>
              Each pattern needs 3+ decisions at ≥85% approval rate to be promoted to zero-touch auto-approval
            </p>
          </div>
          <div style={{ textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <div>🟢 Approved</div><div>🔴 Declined</div>
          </div>
        </div>
        <LearningCurve patterns={patterns} onPatternClick={setSelectedPattern} />
      </div>

      {/* Rule Table */}
      <div className="card">
        <div className="card-title">Risk Rules Registry</div>
        <div className="table-wrapper" style={{ marginTop: 16 }}>
          <table>
            <thead>
              <tr>
                <th>Rule Code</th>
                <th>Name</th>
                <th>Category</th>
                <th>Flag Level</th>
                <th>Weight</th>
                <th>Triggers</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rules.map(rule => (
                <tr key={rule.rule_code}>
                  <td className="monospace" style={{ color: 'var(--accent-cyan)', fontSize: '0.78rem' }}>{rule.rule_code}</td>
                  <td style={{ fontSize: '0.82rem' }}>{rule.rule_name}</td>
                  <td><span style={{ fontSize: '0.72rem', textTransform: 'capitalize', color: 'var(--text-secondary)' }}>{rule.rule_category}</span></td>
                  <td><span className={`risk-badge level-${rule.flag_level}`}>L{rule.flag_level}</span></td>
                  <td style={{ fontWeight: 700, color: 'var(--accent-blue)' }}>{rule.weight}x</td>
                  <td style={{ fontWeight: 700 }}>{rule.trigger_count}</td>
                  <td><span style={{ fontSize: '0.72rem', color: rule.is_active ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                    {rule.is_active ? '● Active' : '○ Inactive'}
                  </span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedPattern && (
        <PatternDetailModal pattern={selectedPattern} onClose={() => setSelectedPattern(null)} />
      )}
    </div>
  );
}
