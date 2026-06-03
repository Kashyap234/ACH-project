// frontend/src/pages/Analytics.jsx
import { useState, useEffect } from 'react';
import { analyticsApi } from '../api/client';

function BarChart({ data, labelKey, valueKey, color = 'var(--accent-blue)', maxVal }) {
  if (!data?.length) return <div className="empty-state" style={{padding:'20px 0'}}><p>No data yet</p></div>;
  const max = maxVal || Math.max(...data.map(d => d[valueKey] || 0), 1);
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
      {data.map((item, i) => (
        <div key={i} style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:80, fontSize:'0.72rem', color:'var(--text-secondary)', textAlign:'right', flexShrink:0 }}>
            {String(item[labelKey]).slice(0, 12)}
          </div>
          <div style={{ flex:1, background:'var(--bg-primary)', borderRadius:4, height:24, overflow:'hidden' }}>
            <div style={{ width:`${Math.round(((item[valueKey]||0)/max)*100)}%`, height:'100%', background:color, borderRadius:4, transition:'width 0.6s ease', minWidth: item[valueKey] > 0 ? 4 : 0 }} />
          </div>
          <div style={{ width:36, fontSize:'0.75rem', fontWeight:700, color, textAlign:'right' }}>{item[valueKey]||0}</div>
        </div>
      ))}
    </div>
  );
}

function LearningCurve({ patterns }) {
  if (!patterns?.length) return <div className="empty-state" style={{padding:'20px 0'}}><p>No patterns yet — submit and decide some transactions to train the AI</p></div>;
  const maxDecisions = Math.max(...patterns.map(p => p.total_decisions), 1);
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
      {patterns.slice(0, 8).map(p => (
        <div key={p.id} style={{ background:'var(--bg-primary)', borderRadius:10, padding:'12px 16px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
            <div style={{ fontSize:'0.78rem', color:'var(--text-primary)', fontWeight:500, maxWidth:'60%' }}>{p.pattern_description}</div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              {p.promoted_to_level1 ? (
                <span style={{ fontSize:'0.68rem', background:'rgba(16,185,129,0.15)', color:'#34d399', padding:'2px 8px', borderRadius:99, fontWeight:700 }}>🚀 AUTO-APPROVE</span>
              ) : (
                <span style={{ fontSize:'0.68rem', color:'var(--text-muted)' }}>{p.total_decisions} decisions</span>
              )}
            </div>
          </div>
          <div style={{ display:'flex', gap:16, alignItems:'center' }}>
            <div style={{ flex:1 }}>
              <div style={{ display:'flex', gap:2, height:6, borderRadius:99, overflow:'hidden' }}>
                <div style={{ width:`${Math.round((p.approve_count/Math.max(p.total_decisions,1))*100)}%`, background:'var(--accent-green)', transition:'width 0.6s ease' }} />
                <div style={{ flex:1, background:'var(--accent-red)', opacity:0.6 }} />
              </div>
            </div>
            <div style={{ fontSize:'0.72rem', fontWeight:700, color: p.confidence_score >= 0.85 ? 'var(--accent-green)' : p.confidence_score >= 0.5 ? 'var(--accent-yellow)' : 'var(--accent-red)' }}>
              {Math.round((p.confidence_score || 0) * 100)}% approved
            </div>
          </div>
          <div style={{ display:'flex', gap:12, marginTop:4 }}>
            <span style={{ fontSize:'0.68rem', color:'var(--accent-green)' }}>✓ {p.approve_count} approved</span>
            <span style={{ fontSize:'0.68rem', color:'var(--accent-red)' }}>✗ {p.decline_count} declined</span>
            <span style={{ fontSize:'0.68rem', color:'var(--text-muted)' }}>Need: {Math.max(0, p.min_decisions_required - p.total_decisions)} more for promotion</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Analytics() {
  const [dashboard, setDashboard] = useState(null);
  const [rules, setRules]         = useState([]);
  const [patterns, setPatterns]   = useState([]);
  const [loading, setLoading]     = useState(true);

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
      <div className="stats-grid" style={{ marginBottom:24 }}>
        {[
          { label:'Auto-Resolution Rate', value:`${autoRate}%`, icon:'🤖', color:'var(--accent-green)', sub:'Zero-touch transactions' },
          { label:'Human Reviews Required', value: d?.totals?.pending + (d?.totals?.approved||0) + (d?.totals?.declined||0), icon:'👤', color:'var(--accent-yellow)', sub:'Level 2 & 3 transactions' },
          { label:'AI Patterns Learned', value: d?.learning?.totalPatterns || 0, icon:'🧠', color:'var(--accent-purple)', sub:'Unique risk profiles' },
          { label:'Patterns Promoted', value: d?.learning?.promotedPatterns || 0, icon:'🚀', color:'var(--accent-cyan)', sub:'Now auto-approved' },
        ].map(({ label, value, icon, color, sub }) => (
          <div key={label} className="stat-card" style={{ '--accent-color': color }}>
            <div className="stat-label">{label}</div>
            <div className="stat-value" style={{ color }}>{value}</div>
            <div className="stat-sub">{sub}</div>
            <div className="stat-icon">{icon}</div>
          </div>
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20, marginBottom:20 }}>
        {/* Decision Breakdown */}
        <div className="card">
          <div className="card-title">Decision Breakdown</div>
          <div style={{ marginTop:16 }}>
            <BarChart
              data={[
                { label:'Auto-Approved', count: d?.totals?.autoApproved || 0 },
                { label:'Approved',      count: d?.totals?.approved      || 0 },
                { label:'Declined',      count: d?.totals?.declined      || 0 },
                { label:'Pending',       count: d?.totals?.pending       || 0 },
              ]}
              labelKey="label" valueKey="count"
              color="var(--accent-blue)"
            />
          </div>
        </div>

        {/* Top Triggered Rules */}
        <div className="card">
          <div className="card-title">Most Triggered Risk Rules</div>
          <div style={{ marginTop:16 }}>
            <BarChart
              data={rules.slice(0,6).map(r => ({ name: r.rule_name.split(' ').slice(0,3).join(' '), count: r.trigger_count }))}
              labelKey="name" valueKey="count"
              color="var(--accent-red)"
            />
          </div>
        </div>
      </div>

      {/* Learning Curve */}
      <div className="card" style={{ marginBottom:20 }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:16 }}>
          <div>
            <div className="card-title">🧠 AI Learning Curve</div>
            <p style={{ fontSize:'0.78rem', color:'var(--text-muted)', marginTop:4 }}>
              Each pattern needs 5+ decisions at ≥85% approval rate to be promoted to zero-touch auto-approval
            </p>
          </div>
          <div style={{ textAlign:'right', fontSize:'0.75rem', color:'var(--text-muted)' }}>
            <div>🟢 Approved</div><div>🔴 Declined</div>
          </div>
        </div>
        <LearningCurve patterns={patterns} />
      </div>

      {/* Rule Table */}
      <div className="card">
        <div className="card-title">Risk Rules Registry</div>
        <div className="table-wrapper" style={{ marginTop:16 }}>
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
                  <td className="monospace" style={{ color:'var(--accent-cyan)', fontSize:'0.78rem' }}>{rule.rule_code}</td>
                  <td style={{ fontSize:'0.82rem' }}>{rule.rule_name}</td>
                  <td><span style={{ fontSize:'0.72rem', textTransform:'capitalize', color:'var(--text-secondary)' }}>{rule.rule_category}</span></td>
                  <td><span className={`risk-badge level-${rule.flag_level}`}>L{rule.flag_level}</span></td>
                  <td style={{ fontWeight:700, color:'var(--accent-blue)' }}>{rule.weight}x</td>
                  <td style={{ fontWeight:700 }}>{rule.trigger_count}</td>
                  <td><span style={{ fontSize:'0.72rem', color: rule.is_active ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                    {rule.is_active ? '● Active' : '○ Inactive'}
                  </span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
