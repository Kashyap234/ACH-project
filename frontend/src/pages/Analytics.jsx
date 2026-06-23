// frontend/src/pages/Analytics.jsx
import { useState, useEffect } from 'react';
import { analyticsApi } from '../api/client';

// ── Bar chart ─────────────────────────────────────────────────────────────────
function BarChart({ data, labelKey, valueKey, color = 'var(--accent-blue)', maxVal }) {
  if (!data?.length) return <div className="empty-state" style={{ padding: '16px 0' }}><p>No data yet</p></div>;
  const max = maxVal || Math.max(...data.map(d => d[valueKey] || 0), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {data.map((item, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 90, fontSize: '0.7rem', color: 'var(--text-secondary)', textAlign: 'right', flexShrink: 0 }}>
            {String(item[labelKey]).slice(0, 14)}
          </div>
          <div style={{ flex: 1, background: 'var(--bg-primary)', borderRadius: 4, height: 22, overflow: 'hidden' }}>
            <div style={{ width: `${Math.round(((item[valueKey] || 0) / max) * 100)}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.6s ease', minWidth: item[valueKey] > 0 ? 4 : 0 }} />
          </div>
          <div style={{ width: 36, fontSize: '0.75rem', fontWeight: 700, color, textAlign: 'right' }}>{item[valueKey] || 0}</div>
        </div>
      ))}
    </div>
  );
}

// ── Three-segment bar (approve / MIR / decline) ───────────────────────────────
function ThreeBar({ approveCount, mirCount, declineCount, total }) {
  const t = total || 1;
  const ap = Math.round((approveCount / t) * 100);
  const mi = Math.round(((mirCount || 0) / t) * 100);
  return (
    <div style={{ display: 'flex', gap: 2, height: 6, borderRadius: 99, overflow: 'hidden' }}>
      <div style={{ width: `${ap}%`, background: 'var(--accent-green)', transition: 'width 0.6s ease' }} />
      <div style={{ width: `${mi}%`, background: 'var(--accent-yellow)', transition: 'width 0.6s ease' }} />
      <div style={{ flex: 1, background: 'var(--accent-red)', opacity: 0.6 }} />
    </div>
  );
}

// ── Workflow Playbook panel ───────────────────────────────────────────────────
function PlaybookPanel({ playbook }) {
  if (!playbook) return (
    <div style={{ padding: '10px 14px', background: 'var(--bg-primary)', borderRadius: 8, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
      No playbook yet — pattern needs promotion first.
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Summary */}
      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6, fontStyle: 'italic' }}>
        "{playbook.summary}"
      </div>
      {/* Meta */}
      <div style={{ display: 'flex', gap: 12, fontSize: '0.7rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
        <span>📋 {playbook.expected_rounds} expected round{playbook.expected_rounds !== 1 ? 's' : ''}</span>
        <span>📈 {Math.round((playbook.approval_rate || 0) * 100)}% historical approval</span>
        <span>🗂 Built from {playbook.built_from_samples} examples</span>
        <span>⏱ {new Date(playbook.built_at).toLocaleDateString()}</span>
      </div>
      {/* Rounds */}
      {(playbook.rounds || []).map(round => (
        <div key={round.round} style={{ padding: '10px 14px', background: 'var(--bg-primary)', borderRadius: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent-purple)' }}>Round {round.round}</span>
            <span style={{ fontSize: '0.65rem', background: 'rgba(245,158,11,0.12)', color: 'var(--accent-yellow)', padding: '2px 8px', borderRadius: 99 }}>
              {round.category?.replace(/_/g, ' ')}
            </span>
          </div>
          {round.message_template && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.5, fontStyle: 'italic' }}>
              "{round.message_template.slice(0, 180)}{round.message_template.length > 180 ? '…' : ''}"
            </div>
          )}
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 5 }}>
            {round.pct_led_to_decision}% of responses led to final decision
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Pattern Detail Modal ──────────────────────────────────────────────────────
function PatternDetailModal({ pattern, onClose }) {
  const [tab, setTab] = useState('overview');
  if (!pattern) return null;
  const fv        = pattern.feature_vector || pattern.last_feature_vector || {};
  const qaPairs   = pattern.learned_qa_pairs || [];
  const mirCats   = pattern.mir_category_counts || {};
  const hasPlaybook = !!pattern.workflow_playbook;
  const mirRate   = pattern.total_decisions > 0
    ? Math.round(((pattern.mir_count || 0) / pattern.total_decisions) * 100) : 0;

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 680, width: '95vw' }}>
        <div className="modal-header">
          <div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
              {pattern.promoted_to_level1 && (
                <span style={{ fontSize: '0.7rem', background: 'rgba(16,185,129,0.15)', color: '#34d399', padding: '2px 10px', borderRadius: 99, fontWeight: 700 }}>🚀 AUTO-APPROVE</span>
              )}
              {hasPlaybook && (
                <span style={{ fontSize: '0.7rem', background: 'rgba(139,92,246,0.15)', color: 'var(--accent-purple)', padding: '2px 10px', borderRadius: 99, fontWeight: 700 }}>🤖 AUTONOMOUS WORKFLOW</span>
              )}
              {pattern.is_frozen && (
                <span style={{ fontSize: '0.7rem', background: 'rgba(239,68,68,0.15)', color: 'var(--accent-red)', padding: '2px 10px', borderRadius: 99, fontWeight: 700 }}>🔒 FROZEN</span>
              )}
            </div>
            <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>{pattern.pattern_description}</h3>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: 2 }}>
              Pattern: {pattern.pattern_hash}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
            {[
              { id: 'overview',  label: '📊 Overview'   },
              { id: 'mir',       label: `🔄 MIR (${pattern.mir_count || 0})` },
              { id: 'playbook',  label: '📋 Playbook'   },
              { id: 'training',  label: `🧠 Training (${qaPairs.length})` },
              { id: 'vector',    label: '🔬 Features'   },
            ].map(t => (
              <button key={t.id} className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Overview tab ─────────────────────────────────────────── */}
          {tab === 'overview' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 14 }}>
                {[
                  ['Total Decisions', pattern.total_decisions,                       'var(--accent-blue)'],
                  ['Approved',        pattern.approve_count,                         'var(--accent-green)'],
                  ['Declined',        pattern.decline_count,                         'var(--accent-red)'],
                  ['Confidence',      `${Math.round((pattern.confidence_score||0)*100)}%`,
                    pattern.confidence_score >= 0.85 ? 'var(--accent-green)' : pattern.confidence_score >= 0.5 ? 'var(--accent-yellow)' : 'var(--accent-red)'],
                  ['MIR Requests',    pattern.mir_count || 0,                        'var(--accent-yellow)'],
                  ['Avg Review Time', pattern.avg_time_to_decide ? `${Math.round(pattern.avg_time_to_decide)}s` : '—', 'var(--text-secondary)'],
                ].map(([l, v, c]) => (
                  <div key={l} style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>{l}</div>
                    <div style={{ fontWeight: 700, color: c, fontSize: '0.9rem' }}>{v}</div>
                  </div>
                ))}
              </div>

              <ThreeBar approveCount={pattern.approve_count} mirCount={pattern.mir_count} declineCount={pattern.decline_count} total={pattern.total_decisions} />
              <div style={{ display: 'flex', gap: 12, marginTop: 5, fontSize: '0.68rem' }}>
                <span style={{ color: 'var(--accent-green)' }}>✓ {pattern.approve_count} approved</span>
                <span style={{ color: 'var(--accent-yellow)' }}>🔄 {pattern.mir_count || 0} MIR</span>
                <span style={{ color: 'var(--accent-red)' }}>✗ {pattern.decline_count} declined</span>
              </div>

              {!pattern.promoted_to_level1 && (
                <div style={{ marginTop: 12, padding: '8px 14px', background: 'var(--bg-primary)', borderRadius: 8, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Needs {Math.max(0, (pattern.min_decisions_required || 5) - pattern.total_decisions)} more unique transactions and {pattern.confidence_score < 0.85 ? `${Math.round((0.85 - (pattern.confidence_score||0)) * 100)}% more confidence` : 'confidence is already ≥85%'} to promote.
                </div>
              )}

              {pattern.promoted_to_level1 && pattern.promotion_date && (
                <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 8, fontSize: '0.78rem' }}>
                  <div style={{ color: 'var(--accent-green)', fontWeight: 600, marginBottom: 4 }}>
                    🚀 {hasPlaybook ? 'Promoted — Autonomous Workflow Active' : 'Promoted to Level 1 Auto-Approve'}
                  </div>
                  <div style={{ color: 'var(--text-muted)' }}>{new Date(pattern.promotion_date).toLocaleString()}</div>
                  {pattern.promotion_reason && <div style={{ color: 'var(--text-secondary)', marginTop: 4, fontSize: '0.72rem' }}>{pattern.promotion_reason}</div>}
                </div>
              )}
            </>
          )}

          {/* ── MIR tab ───────────────────────────────────────────────── */}
          {tab === 'mir' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  ['MIR Count',          pattern.mir_count || 0,                  'var(--accent-yellow)'],
                  ['MIR Rate',           `${mirRate}%`,                           'var(--accent-yellow)'],
                  ['Avg Rounds',         (pattern.avg_rounds_to_resolve || 0).toFixed(1), 'var(--accent-blue)'],
                  ['Approvals after MIR',pattern.mir_resolution_outcomes?.approved || '—','var(--accent-green)'],
                ].map(([l, v, c]) => (
                  <div key={l} style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>{l}</div>
                    <div style={{ fontWeight: 700, color: c, fontSize: '0.9rem' }}>{v}</div>
                  </div>
                ))}
              </div>

              {Object.keys(mirCats).length > 0 && (
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Category Breakdown</div>
                  {Object.entries(mirCats).sort((a, b) => b[1] - a[1]).map(([cat, count]) => {
                    const pct = Math.round((count / (pattern.mir_count || 1)) * 100);
                    return (
                      <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                        <div style={{ width: 140, fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{cat.replace(/_/g, ' ')}</div>
                        <div style={{ flex: 1, background: 'var(--bg-primary)', borderRadius: 3, height: 18, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent-yellow)', opacity: 0.7, borderRadius: 3, transition: 'width 0.6s ease' }} />
                        </div>
                        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent-yellow)', width: 28, textAlign: 'right' }}>{count}</div>
                      </div>
                    );
                  })}
                </div>
              )}

              {pattern.mir_count === 0 && (
                <div style={{ padding: '16px', background: 'var(--bg-primary)', borderRadius: 8, fontSize: '0.78rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                  No MIR requests on this pattern yet.
                </div>
              )}
            </div>
          )}

          {/* ── Playbook tab ──────────────────────────────────────────── */}
          {tab === 'playbook' && (
            <PlaybookPanel playbook={pattern.workflow_playbook} />
          )}

          {/* ── Training examples tab ─────────────────────────────────── */}
          {tab === 'training' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {qaPairs.length === 0 && (
                <div style={{ padding: '16px', background: 'var(--bg-primary)', borderRadius: 8, fontSize: '0.78rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                  No training examples yet. These build up as transactions go through MIR rounds.
                </div>
              )}
              {qaPairs.slice(-10).reverse().map((qa, i) => (
                <div key={i} style={{ padding: '10px 14px', background: 'var(--bg-primary)', borderRadius: 8, borderLeft: `3px solid ${qa.final_outcome === 'approve' ? 'var(--accent-green)' : qa.final_outcome === 'decline' ? 'var(--accent-red)' : 'var(--accent-yellow)'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--accent-yellow)' }}>Round {qa.round} · {qa.category?.replace(/_/g, ' ')}</span>
                    <span style={{ fontSize: '0.65rem', color: qa.final_outcome === 'approve' ? 'var(--accent-green)' : qa.final_outcome === 'decline' ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                      {qa.led_to_decision ? `→ ${qa.final_outcome?.toUpperCase()}` : '→ another round'}
                    </span>
                  </div>
                  {qa.message_template && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                      <strong>Asked:</strong> {qa.message_template.slice(0, 120)}{qa.message_template.length > 120 ? '…' : ''}
                    </div>
                  )}
                  {qa.response_example && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                      <strong>Answered:</strong> {qa.response_example.slice(0, 120)}{qa.response_example.length > 120 ? '…' : ''}
                    </div>
                  )}
                  {qa.recorded_at && (
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 4 }}>{new Date(qa.recorded_at).toLocaleDateString()}</div>
                  )}
                </div>
              ))}
              {qaPairs.length > 10 && (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'center' }}>Showing 10 most recent of {qaPairs.length} examples</div>
              )}
            </div>
          )}

          {/* ── Feature Vector tab ────────────────────────────────────── */}
          {tab === 'vector' && (
            <>
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

// ── Learning Curve ────────────────────────────────────────────────────────────
function LearningCurve({ patterns, onPatternClick }) {
  if (!patterns?.length) return (
    <div className="empty-state" style={{ padding: '20px 0' }}>
      <p>No patterns yet — submit and review some transactions to train the AI</p>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {patterns.slice(0, 10).map(p => {
        const hasPlaybook = !!p.workflow_playbook;
        const mirRate     = p.total_decisions > 0 ? Math.round(((p.mir_count || 0) / p.total_decisions) * 100) : 0;
        const remaining   = Math.max(0, (p.min_decisions_required || 5) - p.total_decisions);
        return (
          <div key={p._docId || p.pattern_hash}
            onClick={() => onPatternClick(p)}
            style={{ background: 'var(--bg-primary)', borderRadius: 10, padding: '12px 16px', cursor: 'pointer', border: '1px solid transparent', transition: 'border-color 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-blue)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; }}>
            {/* Header row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-primary)', fontWeight: 500, maxWidth: '55%', lineHeight: 1.4 }}>
                {p.pattern_description}
              </div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {hasPlaybook && (
                  <span style={{ fontSize: '0.62rem', background: 'rgba(139,92,246,0.15)', color: 'var(--accent-purple)', padding: '2px 7px', borderRadius: 99, fontWeight: 700 }}>🤖 AUTONOMOUS</span>
                )}
                {p.promoted_to_level1 && (
                  <span style={{ fontSize: '0.62rem', background: 'rgba(16,185,129,0.15)', color: '#34d399', padding: '2px 7px', borderRadius: 99, fontWeight: 700 }}>🚀 AUTO-APPROVE</span>
                )}
                {(p.mir_count || 0) > 0 && (
                  <span style={{ fontSize: '0.62rem', background: 'rgba(245,158,11,0.12)', color: 'var(--accent-yellow)', padding: '2px 7px', borderRadius: 99 }}>🔄 {p.mir_count} MIR</span>
                )}
                {!p.promoted_to_level1 && (
                  <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>{p.total_decisions} decisions</span>
                )}
              </div>
            </div>

            {/* Three-segment progress bar */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <ThreeBar approveCount={p.approve_count} mirCount={p.mir_count} declineCount={p.decline_count} total={p.total_decisions} />
              </div>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: p.confidence_score >= 0.85 ? 'var(--accent-green)' : p.confidence_score >= 0.5 ? 'var(--accent-yellow)' : 'var(--accent-red)', width: 44, textAlign: 'right' }}>
                {Math.round((p.confidence_score || 0) * 100)}%
              </div>
            </div>

            {/* Footer row */}
            <div style={{ display: 'flex', gap: 10, marginTop: 5, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--accent-green)' }}>✓ {p.approve_count}</span>
              <span style={{ fontSize: '0.65rem', color: 'var(--accent-red)' }}>✗ {p.decline_count}</span>
              {(p.mir_count || 0) > 0 && <span style={{ fontSize: '0.65rem', color: 'var(--accent-yellow)' }}>🔄 {p.mir_count} ({mirRate}%)</span>}
              {!p.promoted_to_level1 && remaining > 0 && (
                <span style={{ fontSize: '0.63rem', color: 'var(--text-muted)' }}>needs {remaining} more</span>
              )}
              {p.avg_rounds_to_resolve > 0 && (
                <span style={{ fontSize: '0.63rem', color: 'var(--text-muted)' }}>avg {p.avg_rounds_to_resolve.toFixed(1)} rounds</span>
              )}
              <span style={{ fontSize: '0.62rem', color: 'var(--accent-cyan)', marginLeft: 'auto' }}>details →</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── MIR Workflow Stats panel ──────────────────────────────────────────────────
function MirStatsPanel({ patterns }) {
  const withMir      = patterns.filter(p => (p.mir_count || 0) > 0);
  const autonomous   = patterns.filter(p => p.workflow_playbook);
  const totalMir     = patterns.reduce((a, p) => a + (p.mir_count || 0), 0);
  const avgRounds    = withMir.length > 0
    ? (withMir.reduce((a, p) => a + (p.avg_rounds_to_resolve || 0), 0) / withMir.length).toFixed(1)
    : '—';

  // Category frequency across all patterns
  const allCats = {};
  patterns.forEach(p => {
    Object.entries(p.mir_category_counts || {}).forEach(([cat, count]) => {
      allCats[cat] = (allCats[cat] || 0) + count;
    });
  });
  const topCats = Object.entries(allCats).sort((a, b) => b[1] - a[1]).slice(0, 6);

  if (totalMir === 0) return (
    <div className="empty-state" style={{ padding: '20px 0' }}>
      <p>No MIR data yet — MIR statistics will appear here as transactions go through information request rounds.</p>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
        {[
          ['Total MIR Events', totalMir,         'var(--accent-yellow)'],
          ['Patterns w/ MIR',  withMir.length,   'var(--accent-blue)'],
          ['Autonomous',       autonomous.length, 'var(--accent-purple)'],
          ['Avg Rounds',       avgRounds,         'var(--accent-cyan)'],
        ].map(([l, v, c]) => (
          <div key={l} style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
            <div style={{ fontWeight: 700, color: c, fontSize: '1.1rem' }}>{v}</div>
            <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: 3 }}>{l}</div>
          </div>
        ))}
      </div>

      {/* Category breakdown */}
      {topCats.length > 0 && (
        <div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Most Requested Categories</div>
          <BarChart
            data={topCats.map(([cat, count]) => ({ name: cat.replace(/_/g, ' '), count }))}
            labelKey="name" valueKey="count" color="var(--accent-yellow)"
          />
        </div>
      )}
    </div>
  );
}

// ── Main Analytics page ───────────────────────────────────────────────────────
export default function Analytics() {
  const [dashboard, setDashboard] = useState(null);
  const [rules,     setRules]     = useState([]);
  const [patterns,  setPatterns]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [selected,  setSelected]  = useState(null);
  const [section,   setSection]   = useState('learning');  // learning | mir | rules

  const load = () => {
    setLoading(true);
    Promise.all([analyticsApi.dashboard(), analyticsApi.rules(), analyticsApi.patterns()])
      .then(([dash, r, p]) => {
        setDashboard(dash.data);
        setRules(r.data || []);
        setPatterns(p.data || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="loading-center"><div className="spinner" /><p>Loading analytics…</p></div>;

  const d        = dashboard;
  const total    = d?.totals?.total || 0;
  const autoRate = total > 0 ? Math.round((d.totals.autoApproved / total) * 100) : 0;
  const autonomous = patterns.filter(p => p.workflow_playbook).length;

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2>📊 Analytics & Insights</h2>
          <p>AI learning performance · MIR workflow intelligence · Risk rule effectiveness</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={load}>↻ Refresh</button>
      </div>

      {/* ── KPI Row ──────────────────────────────────────────────────────── */}
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        {[
          { label: 'Auto-Resolution Rate',  value: `${autoRate}%`,                    icon: '🤖', color: 'var(--accent-green)',  sub: 'Zero-touch transactions'       },
          { label: 'Human Reviews Pending', value: d?.totals?.pending || 0,           icon: '👤', color: 'var(--accent-yellow)', sub: 'Level 2 & 3 transactions'      },
          { label: 'More Info Required',    value: d?.totals?.more_info_required || 0,icon: '🔄', color: 'var(--accent-orange)', sub: 'Awaiting originator response'   },
          { label: 'AI Patterns Learned',   value: d?.learning?.totalPatterns || 0,   icon: '🧠', color: 'var(--accent-purple)', sub: 'Unique risk fingerprints'       },
          { label: 'Patterns Promoted',     value: d?.learning?.promotedPatterns || 0,icon: '🚀', color: 'var(--accent-cyan)',   sub: 'Auto-approve active'            },
          { label: 'Autonomous Workflows',  value: autonomous,                         icon: '🤖', color: 'var(--accent-purple)', sub: 'Full MIR handled by AI'         },
        ].map(({ label, value, icon, color, sub }) => (
          <div key={label} className="stat-card" style={{ '--accent-color': color }}>
            <div className="stat-label">{label}</div>
            <div className="stat-value" style={{ color }}>{value}</div>
            <div className="stat-sub">{sub}</div>
            <div className="stat-icon">{icon}</div>
          </div>
        ))}
      </div>

      {/* ── Top row charts ───────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        {/* Decision Breakdown */}
        <div className="card">
          <div className="card-title">Decision Breakdown</div>
          <div style={{ marginTop: 14 }}>
            <BarChart
              data={[
                { label: 'Auto-Approved', count: d?.totals?.autoApproved || 0 },
                { label: 'Approved',      count: d?.totals?.approved     || 0 },
                { label: 'More Info Req', count: d?.totals?.more_info_required || 0 },
                { label: 'AI Workflow',   count: d?.totals?.ai_workflow   || 0 },
                { label: 'Declined',      count: d?.totals?.declined      || 0 },
                { label: 'Pending',       count: d?.totals?.pending       || 0 },
              ]}
              labelKey="label" valueKey="count" color="var(--accent-blue)"
            />
          </div>
        </div>

        {/* Top Risk Rules */}
        <div className="card">
          <div className="card-title">Most Triggered Risk Rules</div>
          <div style={{ marginTop: 14 }}>
            <BarChart
              data={rules.slice(0, 6).map(r => ({ name: r.rule_name.split(' ').slice(0, 3).join(' '), count: r.trigger_count }))}
              labelKey="name" valueKey="count" color="var(--accent-red)"
            />
          </div>
        </div>
      </div>

      {/* ── Section tabs ─────────────────────────────────────────────────── */}
      <div className="card">
        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
          {[
            { id: 'learning', label: '🧠 AI Learning Curve' },
            { id: 'mir',      label: `🔄 MIR Workflow Stats` },
            { id: 'rules',    label: '📋 Risk Rules Registry' },
          ].map(t => (
            <button key={t.id} className={`btn btn-sm ${section === t.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setSection(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Learning Curve */}
        {section === 'learning' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  Each pattern needs <strong>5+ unique transactions</strong> at <strong>≥85% confidence</strong> to be promoted.
                  Patterns with a <span style={{ color: 'var(--accent-purple)', fontWeight: 600 }}>🤖 AUTONOMOUS</span> badge have a full workflow playbook —
                  the AI handles info requests, response evaluation, and final decisions without human intervention.
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0, marginLeft: 16 }}>
                <div>🟢 Approved</div>
                <div>🟡 MIR</div>
                <div>🔴 Declined</div>
              </div>
            </div>
            <LearningCurve patterns={patterns} onPatternClick={setSelected} />
          </>
        )}

        {/* MIR Stats */}
        {section === 'mir' && (
          <MirStatsPanel patterns={patterns} />
        )}

        {/* Rules Table */}
        {section === 'rules' && (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Code</th><th>Name</th><th>Category</th>
                  <th>Level</th><th>Weight</th><th>Triggers</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rules.map(rule => (
                  <tr key={rule.rule_code}>
                    <td className="monospace" style={{ color: 'var(--accent-cyan)', fontSize: '0.78rem' }}>{rule.rule_code}</td>
                    <td style={{ fontSize: '0.82rem' }}>{rule.rule_name}</td>
                    <td><span style={{ fontSize: '0.7rem', textTransform: 'capitalize', color: 'var(--text-secondary)' }}>{rule.rule_category}</span></td>
                    <td><span className={`risk-badge level-${rule.flag_level}`}>L{rule.flag_level}</span></td>
                    <td style={{ fontWeight: 700, color: 'var(--accent-blue)' }}>{rule.weight}x</td>
                    <td style={{ fontWeight: 700 }}>{rule.trigger_count}</td>
                    <td><span style={{ fontSize: '0.72rem', color: rule.is_active ? 'var(--accent-green)' : 'var(--text-muted)' }}>{rule.is_active ? '● Active' : '○ Inactive'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <PatternDetailModal pattern={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}