// frontend/src/App.jsx
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import Dashboard          from './pages/Dashboard';
import TransactionIntake  from './pages/TransactionIntake';
import BulkUpload         from './pages/BulkUpload';
import ReviewQueue        from './pages/ReviewQueue';
import Analytics          from './pages/Analytics';
import AuditLog           from './pages/AuditLog';
import ExceptionDashboard from './pages/ExceptionDashboard';
import AccountManager     from './pages/AccountManager';
import IssuedCheckRegister from './pages/IssuedCheckRegister';
import LoginPage          from './pages/LoginPage';
import RegisterPage       from './pages/RegisterPage';
import { analyticsApi, exceptionsApi } from './api/client';
import './index.css';

// ── Role badge color map ──────────────────────────────────────────────────────
const ROLE_COLORS = {
  admin:      'var(--accent-red)',
  supervisor: 'var(--accent-purple)',
  analyst:    'var(--accent-cyan)',
  reviewer:   'var(--accent-blue)',
};

function Sidebar({ pendingCount, exceptionCount }) {
  const { user, logout } = useAuth();

  const nav = [
    { to:'/',          icon:'🏠', label:'Dashboard'         },
    { to:'/intake',    icon:'➕', label:'Add Transaction'    },
    { to:'/bulk',      icon:'📦', label:'Bulk Upload'        },
    { to:'/queue',     icon:'⚠️',  label:'Review Queue',      badge: pendingCount },
    { section: '── Positive Pay ──' },
    { to:'/exceptions',icon:'⚡', label:'Exception Dashboard', badge: exceptionCount, badgeColor:'var(--accent-red)' },
    { to:'/accounts',  icon:'🏦', label:'Account ACH Filters' },
    { to:'/register',  icon:'✅', label:'Check Register'    },
    { section: '── Reports ──' },
    { to:'/analytics', icon:'📊', label:'Analytics'          },
    { to:'/audit',     icon:'📋', label:'Audit Log'           },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="logo-icon">🏦</div>
        <h1>ACH Triage AI</h1>
        <p>Positive Pay · NACHA v3.0</p>
      </div>
      <nav className="sidebar-nav">
        {nav.map((item, i) => {
          if (item.section) return (
            <div key={i} className="nav-section-title" style={{ marginTop:10 }}>{item.section}</div>
          );
          return (
            <NavLink key={item.to} to={item.to} end={item.to==='/'} className={({isActive})=>`nav-item${isActive?' active':''}`}>
              <span className="nav-icon">{item.icon}</span>
              {item.label}
              {item.badge > 0 && <span className="nav-badge" style={{ background: item.badgeColor || 'var(--accent-red)' }}>{item.badge}</span>}
            </NavLink>
          );
        })}
      </nav>

      {/* User Info + Logout */}
      {user && (
        <div className="sidebar-user">
          <div className="sidebar-user-avatar">
            {user.full_name.charAt(0).toUpperCase()}
          </div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{user.full_name}</div>
            <div className="sidebar-user-role" style={{ color: ROLE_COLORS[user.role] || 'var(--accent-blue)' }}>
              {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
            </div>
          </div>
          <button
            id="logout-btn"
            className="sidebar-logout-btn"
            onClick={logout}
            title="Sign out"
          >
            ⏏
          </button>
        </div>
      )}

      <div className="sidebar-footer">
        <div><span className="status-dot"/>System Online · v3.0</div>
        <div style={{marginTop:4,fontSize:'0.62rem'}}>Full NACHA · Bulk · Exceptions · Positive Pay</div>
      </div>
    </aside>
  );
}

// ── Protected Route wrapper ───────────────────────────────────────────────────
function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="loading-center" style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
        <div className="spinner" style={{ width: 40, height: 40 }} />
        <p style={{ color: 'var(--text-secondary)', marginTop: 12 }}>Verifying session…</p>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AppShell() {
  const [pending,    setPending]    = useState(0);
  const [exceptions, setExceptions] = useState(0);

  const refresh = () => {
    analyticsApi.dashboard().then(r => setPending(r.data?.totals?.pending||0)).catch(()=>{});
    exceptionsApi.getAll().then(r => setExceptions(r.summary?.total||0)).catch(()=>{});
  };

  useEffect(() => { refresh(); const t = setInterval(refresh, 15000); return () => clearInterval(t); }, []);

  return (
    <div className="app-shell">
      <Sidebar pendingCount={pending} exceptionCount={exceptions} />
      <main className="main-content">
        <Routes>
          <Route path="/"          element={<Dashboard />} />
          <Route path="/intake"    element={<TransactionIntake onSubmit={refresh} />} />
          <Route path="/bulk"      element={<BulkUpload onComplete={refresh} />} />
          <Route path="/queue"     element={<ReviewQueue onDecision={refresh} />} />
          <Route path="/exceptions"element={<ExceptionDashboard onDecision={refresh} />} />
          <Route path="/accounts"  element={<AccountManager />} />
          <Route path="/register"  element={<IssuedCheckRegister />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/audit"     element={<AuditLog />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public routes */}
          <Route path="/login"    element={<PublicRoute><LoginPage /></PublicRoute>} />
          <Route path="/register" element={<PublicRoute><RegisterPage /></PublicRoute>} />
          {/* All other routes are protected */}
          <Route path="/*" element={<ProtectedRoute><AppShell /></ProtectedRoute>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

// Redirect logged-in users away from login/register
function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  return children;
}
