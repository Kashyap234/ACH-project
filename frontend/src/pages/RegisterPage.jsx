// frontend/src/pages/RegisterPage.jsx
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ROLES = [
  { value: 'reviewer',   label: '👤 Reviewer',   desc: 'Can approve/decline transactions' },
  { value: 'analyst',    label: '🔍 Analyst',     desc: 'Can view and analyze all data' },
  { value: 'supervisor', label: '🏆 Supervisor',  desc: 'Can review and override decisions' },
  { value: 'admin',      label: '⚙️ Admin',       desc: 'Full system access' },
];

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate      = useNavigate();

  const [form, setForm] = useState({
    username: '', full_name: '', email: '', password: '', confirm: '', role: 'reviewer'
  });
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const validate = () => {
    if (!form.username.trim())  return 'Username is required.';
    if (!form.full_name.trim()) return 'Full name is required.';
    if (!form.email.trim())     return 'Email is required.';
    if (!/\S+@\S+\.\S+/.test(form.email)) return 'Invalid email address.';
    if (form.password.length < 6) return 'Password must be at least 6 characters.';
    if (form.password !== form.confirm) return 'Passwords do not match.';
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const err = validate();
    if (err) { setError(err); return; }
    setError(''); setLoading(true);
    try {
      const { confirm: _, ...data } = form;
      await register(data);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || 'Registration failed.');
    } finally { setLoading(false); }
  };

  return (
    <div className="auth-page">
      <div className="auth-orb auth-orb-1" />
      <div className="auth-orb auth-orb-2" />
      <div className="auth-orb auth-orb-3" />

      <div className="auth-card auth-card-wide">
        <div className="auth-logo">
          <div className="auth-logo-icon">🏦</div>
          <h1>ACH Triage AI</h1>
          <p>Positive Pay · NACHA Compliance · v3.0</p>
        </div>

        <div className="auth-divider" />

        <h2 className="auth-title">Create Account</h2>
        <p className="auth-subtitle">Register as a transaction reviewer or analyst</p>

        <form onSubmit={handleSubmit} className="auth-form" id="register-form">
          <div className="auth-form-grid">
            <div className="form-group">
              <label className="form-label">Full Name <span className="required">*</span></label>
              <input id="reg-fullname" className="form-input" type="text" placeholder="Jane Smith"
                value={form.full_name} onChange={e => set('full_name', e.target.value)} autoFocus />
            </div>

            <div className="form-group">
              <label className="form-label">Username <span className="required">*</span></label>
              <input id="reg-username" className="form-input" type="text" placeholder="jsmith"
                value={form.username} onChange={e => set('username', e.target.value)} autoComplete="username" />
            </div>

            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label className="form-label">Email Address <span className="required">*</span></label>
              <input id="reg-email" className="form-input" type="email" placeholder="jane@yourbank.com"
                value={form.email} onChange={e => set('email', e.target.value)} />
            </div>

            <div className="form-group">
              <label className="form-label">Password <span className="required">*</span></label>
              <input id="reg-password" className="form-input" type="password" placeholder="Min. 6 characters"
                value={form.password} onChange={e => set('password', e.target.value)} autoComplete="new-password" />
            </div>

            <div className="form-group">
              <label className="form-label">Confirm Password <span className="required">*</span></label>
              <input id="reg-confirm" className="form-input" type="password" placeholder="Repeat password"
                value={form.confirm} onChange={e => set('confirm', e.target.value)} autoComplete="new-password" />
            </div>
          </div>

          {/* Role selector */}
          <div className="form-group" style={{ marginTop: 8 }}>
            <label className="form-label">Role <span className="required">*</span></label>
            <div className="role-grid">
              {ROLES.map(r => (
                <button key={r.value} type="button" id={`role-${r.value}`}
                  className={`role-card${form.role === r.value ? ' role-card-active' : ''}`}
                  onClick={() => set('role', r.value)}>
                  <div className="role-label">{r.label}</div>
                  <div className="role-desc">{r.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {error && <div className="auth-error"><span>⚠️</span> {error}</div>}

          <button id="reg-submit" type="submit" className="btn btn-primary auth-btn" disabled={loading}>
            {loading
              ? <><div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Creating account…</>
              : '✨ Create Account'}
          </button>
        </form>

        <div className="auth-footer">
          Already have an account?{' '}
          <Link to="/login" className="auth-link">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
