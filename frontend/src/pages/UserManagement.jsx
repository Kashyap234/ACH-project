// frontend/src/pages/UserManagement.jsx — Admin-only user management
import { useState, useEffect, useCallback } from 'react';
import { authApi } from '../api/client';
import { useAuth } from '../context/AuthContext';

const ROLES = [
  { value: 'reviewer',   label: 'Reviewer',   icon: '👤', color: 'var(--accent-blue)',   desc: 'Can review and approve/decline transactions' },
  { value: 'analyst',    label: 'Analyst',     icon: '🔍', color: 'var(--accent-cyan)',   desc: 'Can view and analyze all data' },
  { value: 'supervisor', label: 'Supervisor',  icon: '🏆', color: 'var(--accent-purple)', desc: 'Can review and override decisions' },
  { value: 'admin',      label: 'Admin',       icon: '⚙️', color: 'var(--accent-red)',    desc: 'Full system access' },
];

const roleInfo = Object.fromEntries(ROLES.map(r => [r.value, r]));

function RoleBadge({ role }) {
  const r = roleInfo[role] || { icon: '?', label: role, color: '#666' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 10px', borderRadius: 99, fontSize: '0.72rem', fontWeight: 700,
      background: r.color + '22', color: r.color, border: '1px solid ' + r.color + '44'
    }}>
      {r.icon} {r.label}
    </span>
  );
}

// ── Create User Modal ────────────────────────────────────────────────────────
function CreateUserModal({ onClose, onCreated }) {
  const [form, setForm]     = useState({ username: '', full_name: '', email: '', role: 'reviewer' });
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState(null);
  const [error,   setError]   = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.username || !form.full_name || !form.email || !form.role) {
      setError('All fields are required.'); return;
    }
    setError(''); setLoading(true);
    try {
      const res = await authApi.createUser(form);
      setResult(res);
      onCreated();
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to create user.');
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    return (
      <div className="um-modal-overlay" onClick={onClose}>
        <div className="um-modal um-premium-modal" onClick={e => e.stopPropagation()}>
          <div className="um-modal-header um-modal-header-success">
            <div className="um-header-icon-success">✨</div>
            <div>
              <h3>User Created Successfully</h3>
              <p>The account has been provisioned and is ready for use.</p>
            </div>
            <button className="um-close-btn" onClick={onClose}>✕</button>
          </div>
          <div className="um-success-body">
            <div className="um-cred-box um-premium-cred-box">
              <div className="um-cred-header">
                <span className="um-cred-icon">🔐</span>
                <p className="um-cred-title">Login Credentials</p>
              </div>
              <div className="um-cred-row"><span>Name</span><strong>{result.user?.full_name}</strong></div>
              <div className="um-cred-row"><span>Username</span><strong>{result.user?.username}</strong></div>
              <div className="um-cred-row"><span>Password</span><strong className="um-password">{result.temp_password}</strong></div>
              <div className="um-cred-row"><span>Role</span><RoleBadge role={result.user?.role} /></div>
              <div className="um-cred-row"><span>Email</span><span>{result.user?.email}</span></div>
            </div>
            <div className={`um-email-status ${result.email_status?.sent ? 'um-email-ok' : 'um-email-warn'}`}>
              <div className="um-email-status-icon">{result.email_status?.sent ? '📧' : '⚠️'}</div>
              <div className="um-email-status-text">
                {result.email_status?.sent
                  ? `Credentials have been securely emailed to ${result.user?.email}`
                  : 'SMTP not configured — please share the password above manually with the user.'
                }
              </div>
            </div>
            <button className="btn btn-primary um-btn-large" onClick={onClose}>Complete Setup</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="um-modal-overlay" onClick={onClose}>
      <div className="um-modal um-premium-modal" onClick={e => e.stopPropagation()}>
        <div className="um-modal-header">
          <div className="um-header-icon">➕</div>
          <div>
            <h3>Create New User</h3>
            <p>Provision a new account with specific access controls.</p>
          </div>
          <button className="um-close-btn" onClick={onClose}>✕</button>
        </div>
        <form className="um-form" onSubmit={handleSubmit}>
          <div className="um-premium-section">
            <h4 className="um-section-title">User Information</h4>
            <div className="um-form-grid">
              <div className="form-group">
                <label className="form-label">Full Name <span className="required">*</span></label>
                <input className="form-input um-premium-input" value={form.full_name} onChange={e => set('full_name', e.target.value)} placeholder="e.g. Jane Smith" autoFocus />
              </div>
              <div className="form-group">
                <label className="form-label">Username <span className="required">*</span></label>
                <input className="form-input um-premium-input" value={form.username} onChange={e => set('username', e.target.value.toLowerCase().replace(/\s/g,''))} placeholder="e.g. jsmith" />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Email Address <span className="required">*</span></label>
                <input className="form-input um-premium-input" type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="e.g. jane@yourbank.com" />
              </div>
            </div>
          </div>

          <div className="um-premium-section">
            <h4 className="um-section-title">Access & Permissions</h4>
            <div className="form-group">
              <div className="role-grid um-premium-role-grid">
                {ROLES.map(r => (
                  <button key={r.value} type="button"
                    className={`role-card um-premium-role-card ${form.role === r.value ? ' role-card-active' : ''}`}
                    onClick={() => set('role', r.value)}
                    style={form.role === r.value ? { borderColor: r.color, background: `linear-gradient(145deg, ${r.color}11, ${r.color}05)`, boxShadow: `0 4px 12px ${r.color}22` } : {}}>
                    <div className="role-label" style={{ color: form.role === r.value ? r.color : undefined }}>
                      <span className="um-role-icon">{r.icon}</span> {r.label}
                    </div>
                    <div className="role-desc">{r.desc}</div>
                    {form.role === r.value && <div className="um-role-check" style={{ color: r.color }}>✓</div>}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="um-premium-footer-note">
            <span className="um-note-icon">💡</span>
            <span>A secure, random password will be generated automatically and sent to the user's email address.</span>
          </div>

          {error && <div className="auth-error um-premium-error"><span>⚠️</span> {error}</div>}

          <div className="um-modal-actions">
            <button type="button" className="btn btn-secondary um-btn-large" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary um-btn-large um-btn-glow" disabled={loading}>
              {loading ? <><div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Provisioning…</> : '✨ Create User Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Edit User Modal ──────────────────────────────────────────────────────────
function EditUserModal({ user, currentUser, onClose, onUpdated }) {
  const [role,      setRole]      = useState(user.role);
  const [isActive,  setIsActive]  = useState(user.is_active);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [resetPass, setResetPass] = useState(false);

  const handleSave = async () => {
    setError(''); setLoading(true);
    try {
      await authApi.updateUser(user.user_id, { role, is_active: isActive, reset_password: resetPass || undefined });
      onUpdated();
      onClose();
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    } finally { setLoading(false); }
  };

  const isSelf = user.user_id === currentUser?.user_id;

  return (
    <div className="um-modal-overlay" onClick={onClose}>
      <div className="um-modal um-modal-sm" onClick={e => e.stopPropagation()}>
        <div className="um-modal-header">
          <h3>✏️ Edit User</h3>
          <button className="um-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="um-form">
          <div className="um-user-info-row">
            <div className="um-avatar">{user.full_name[0].toUpperCase()}</div>
            <div>
              <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{user.full_name}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>@{user.username} · {user.email}</div>
            </div>
          </div>

          <div className="form-group" style={{ marginTop: 16 }}>
            <label className="form-label">Role</label>
            <div className="role-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              {ROLES.map(r => (
                <button key={r.value} type="button"
                  className={`role-card${role === r.value ? ' role-card-active' : ''}`}
                  style={role === r.value ? { borderColor: r.color, background: r.color + '15' } : {}}
                  onClick={() => setRole(r.value)}>
                  <div className="role-label" style={{ color: role === r.value ? r.color : undefined }}>{r.icon} {r.label}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="um-toggle-row" style={{ marginTop: 16 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Account Status</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{isSelf ? 'Cannot deactivate your own account' : (isActive ? 'Active — user can log in' : 'Inactive — login blocked')}</div>
            </div>
            <button
              className={`um-toggle ${isActive ? 'um-toggle-on' : ''}`}
              onClick={() => !isSelf && setIsActive(!isActive)}
              disabled={isSelf}
            >
              <span className="um-toggle-thumb" />
            </button>
          </div>

          <div className="um-toggle-row" style={{ marginTop: 12 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Reset Password</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Generate new password and send to user's email</div>
            </div>
            <button className={`um-toggle ${resetPass ? 'um-toggle-on' : ''}`} onClick={() => setResetPass(!resetPass)}>
              <span className="um-toggle-thumb" />
            </button>
          </div>

          {error && <div className="auth-error" style={{ marginTop: 12 }}><span>⚠️</span> {error}</div>}

          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSave} disabled={loading}>
              {loading ? <><div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Saving…</> : '💾 Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main User Management Page ─────────────────────────────────────────────────
export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const [users,      setUsers]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editUser,   setEditUser]   = useState(null);
  const [search,     setSearch]     = useState('');
  const [filterRole, setFilterRole] = useState('all');
  const [deleting,   setDeleting]   = useState(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authApi.listUsers();
      setUsers(res.data || []);
    } catch (e) {
      setError(e?.response?.data?.error || e.message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleDelete = async (user) => {
    if (!window.confirm('Are you sure you want to permanently delete user "' + user.username + '"? This cannot be undone.')) return;
    setDeleting(user.user_id);
    try {
      await authApi.deleteUser(user.user_id);
      fetchUsers();
    } catch (e) {
      alert(e?.response?.data?.error || e.message);
    } finally { setDeleting(null); }
  };

  const filtered = users.filter(u => {
    const matchSearch = !search || u.full_name.toLowerCase().includes(search.toLowerCase()) || u.username.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase());
    const matchRole   = filterRole === 'all' || u.role === filterRole;
    return matchSearch && matchRole;
  });

  const stats = {
    total:  users.length,
    active: users.filter(u => u.is_active).length,
    byRole: ROLES.map(r => ({ ...r, count: users.filter(u => u.role === r.value).length })),
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">👥 User Management</h1>
          <p className="page-subtitle">Admin-only — create and manage system users</p>
        </div>
        <button className="btn btn-primary" id="create-user-btn" onClick={() => setShowCreate(true)}>
          ➕ Create New User
        </button>
      </div>

      {/* Stats Row */}
      <div className="um-stats-row">
        <div className="um-stat-card">
          <div className="um-stat-num">{stats.total}</div>
          <div className="um-stat-label">Total Users</div>
        </div>
        <div className="um-stat-card um-stat-active">
          <div className="um-stat-num">{stats.active}</div>
          <div className="um-stat-label">Active</div>
        </div>
        {stats.byRole.map(r => (
          <div key={r.value} className="um-stat-card" style={{ borderLeft: '3px solid ' + r.color }}>
            <div className="um-stat-num" style={{ color: r.color }}>{r.count}</div>
            <div className="um-stat-label">{r.icon} {r.label}s</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="um-filters">
        <input
          className="form-input"
          style={{ maxWidth: 280 }}
          placeholder="🔍 Search by name, username or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="form-input" style={{ maxWidth: 160 }} value={filterRole} onChange={e => setFilterRole(e.target.value)}>
          <option value="all">All Roles</option>
          {ROLES.map(r => <option key={r.value} value={r.value}>{r.icon} {r.label}</option>)}
        </select>
      </div>

      {/* Users Table */}
      {error && <div className="auth-error"><span>⚠️</span> {error}</div>}

      {loading ? (
        <div className="um-loading">
          <div className="spinner" />
          <span>Loading users…</span>
        </div>
      ) : (
        <div className="um-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last Login</th>
                <th>Created By</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign:'center', color:'var(--text-muted)', padding: '32px' }}>No users found</td></tr>
              ) : filtered.map(u => (
                <tr key={u.user_id} className={!u.is_active ? 'um-row-inactive' : ''}>
                  <td>
                    <div style={{ display:'flex', alignItems:'center', gap: 10 }}>
                      <div className="um-avatar um-avatar-sm" style={{ background: roleInfo[u.role]?.color + '33', color: roleInfo[u.role]?.color }}>
                        {u.full_name[0].toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize:'0.87rem' }}>{u.full_name}</div>
                        <div style={{ fontSize:'0.72rem', color:'var(--text-muted)' }}>@{u.username}</div>
                      </div>
                      {u.user_id === currentUser?.user_id && <span className="um-you-badge">You</span>}
                    </div>
                  </td>
                  <td style={{ fontSize:'0.82rem' }}>{u.email}</td>
                  <td><RoleBadge role={u.role} /></td>
                  <td>
                    <span className={`status-badge ${u.is_active ? 'status-approved' : 'status-declined'}`}>
                      {u.is_active ? '● Active' : '● Inactive'}
                    </span>
                  </td>
                  <td style={{ fontSize:'0.78rem', color:'var(--text-muted)' }}>
                    {u.last_login ? new Date(u.last_login).toLocaleDateString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : 'Never'}
                  </td>
                  <td style={{ fontSize:'0.78rem', color:'var(--text-muted)' }}>
                    {u.created_by || 'System'}
                  </td>
                  <td>
                    <div style={{ display:'flex', gap: 6 }}>
                      <button className="btn-sm btn-secondary" id={`edit-user-${u.user_id}`} onClick={() => setEditUser(u)} title="Edit user">✏️ Edit</button>
                      {u.user_id !== currentUser?.user_id && (
                        <button
                          className="btn-sm btn-danger"
                          id={`delete-user-${u.user_id}`}
                          onClick={() => handleDelete(u)}
                          disabled={deleting === u.user_id}
                          title="Delete user"
                        >
                          {deleting === u.user_id ? '…' : '🗑️'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { fetchUsers(); }}
        />
      )}
      {editUser && (
        <EditUserModal
          user={editUser}
          currentUser={currentUser}
          onClose={() => setEditUser(null)}
          onUpdated={fetchUsers}
        />
      )}
    </div>
  );
}
