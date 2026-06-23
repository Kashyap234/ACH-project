// frontend/src/App.jsx
// CHANGE: Added public /portal/:token route for the Originator Portal.
// The portal route renders OUTSIDE the authenticated sidebar layout — it has
// no nav, no auth guard, and no admin context. All existing routes unchanged.
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
import UserManagement     from './pages/UserManagement';
import LoginPage          from './pages/LoginPage';
import OriginatorPortal   from './pages/OriginatorPortal';   // NEW: MIR feature
import Chatbot            from './components/Chatbot';
import { analyticsApi, exceptionsApi } from './api/client';
import './index.css';

// ── Role badge color map ──────────────────────────────────────────────────────
const ROLE_COLORS = {
  admin:      'var(--accent-red)',
  supervisor: 'var(--accent-purple)',
  analyst:    'var(--accent-cyan)',
  reviewer:   'var(--accent-blue)',
};

function Sidebar({ pendingCount, exceptionCount, mirCount }) {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'admin';

  const nav = [
    { to:'/',           icon:'🏠', label:'Dashboard'          },
    { to:'/intake',     icon:'➕', label:'Add Transaction'     },
    { to:'/bulk',       icon:'📦', label:'Bulk Upload'         },
    { to:'/queue',      icon:'⚠️',  label:'Review Queue',        badge: pendingCount },
    { section: '── More Info ──' },
    // MIR badge: separate from main pending count
    { to:'/queue?filter=more_info_required', icon:'🔄', label:'Awaiting Responses', badge: mirCount, badgeColor:'var(--accent-yellow)' },
    { section: '── Positive Pay ──' },
    { to:'/exceptions', icon:'⚡', label:'Exception Dashboard', badge: exceptionCount, badgeColor:'var(--accent-red)' },
    { to:'/accounts',   icon:'🏦', label:'Account ACH Filters' },
    { to:'/register',   icon:'✅', label:'Check Register'      },
    { section: '── Reports ──' },
    { to:'/analytics',  icon:'📊', label:'Analytics'           },
    { to:'/audit',      icon:'📋', label:'Audit Log'            },
    ...(isAdmin ? [
      { section: '── Administration ──' },
      { to:'/users',    icon:'👥', label:'User Management'     },
    ] : []),
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="logo-icon">🏦</div>
        <h1>ACH Triage AI</h1>
        <p>Positive Pay · NACHA v4.0</p>
      </div>
      <nav className="sidebar-nav">
        {nav.map((item, i) => {
          if (item.section) return (
            <div key={i} className="nav-section-title" style={{ marginTop:10 }}>{item.section}</div>
          );
          return (
            <NavLink key={item.to} to={item.to} end={item.to==='/'} className={({isActive})=>`nav-item${isActive?' active':''}`}>
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
              {item.badge > 0 && (
                <span className="nav-badge" style={{ background: item.badgeColor || 'var(--accent-red)' }}>{item.badge}</span>
              )}
            </NavLink>
          );
        })}
      </nav>

      {user && (
        <div className="sidebar-user">
          <div className="user-info">
            <div className="user-name">{user.full_name}</div>
            <div className="user-role" style={{ color: ROLE_COLORS[user.role] || 'var(--text-muted)' }}>
              {user.role?.toUpperCase()}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={logout} style={{ marginTop:8 }}>Sign Out</button>
        </div>
      )}
    </aside>
  );
}

// ── Authenticated app shell ───────────────────────────────────────────────────
function AppShell() {
  const { user, loading } = useAuth();
  const [pendingCount,   setPendingCount]   = useState(0);
  const [exceptionCount, setExceptionCount] = useState(0);
  const [mirCount,       setMirCount]       = useState(0);

  useEffect(() => {
    if (!user) return;
    const load = () => {
      analyticsApi.dashboard().then(d => {
        setPendingCount(d?.data?.pending_review || 0);
        setMirCount(d?.data?.more_info_required || 0);
      }).catch(() => {});
      exceptionsApi.getAll().then(r => {
        setExceptionCount(r?.summary?.total || 0);
      }).catch(() => {});
    };
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [user]);

  if (loading) return <div className="loading-center"><div className="spinner" /></div>;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="app-layout">
      <Sidebar pendingCount={pendingCount} exceptionCount={exceptionCount} mirCount={mirCount} />
      <main className="main-content">
        <Routes>
          <Route path="/"          element={<Dashboard />} />
          <Route path="/intake"    element={<TransactionIntake />} />
          <Route path="/bulk"      element={<BulkUpload />} />
          <Route path="/queue"     element={<ReviewQueue onDecision={() => {
            analyticsApi.dashboard().then(d => {
              setPendingCount(d?.data?.pending_review || 0);
              setMirCount(d?.data?.more_info_required || 0);
            }).catch(() => {});
          }} />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/audit"     element={<AuditLog />} />
          <Route path="/exceptions"element={<ExceptionDashboard onDecision={() => {
            exceptionsApi.getAll().then(r => setExceptionCount(r?.summary?.total || 0)).catch(() => {});
          }} />} />
          <Route path="/accounts"  element={<AccountManager />} />
          <Route path="/register"  element={<IssuedCheckRegister />} />
          <Route path="/users"     element={<UserManagement />} />
          <Route path="*"          element={<Navigate to="/" replace />} />
        </Routes>
        <Chatbot />
      </main>
    </div>
  );
}

// ── Root app with public portal route ─────────────────────────────────────────
export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public login page — no sidebar, no auth */}
          <Route path="/login" element={<LoginPage />} />

          {/* NEW: Originator Portal — public, token-scoped, no sidebar, no auth guard */}
          {/* This route is OUTSIDE the authenticated AppShell intentionally.          */}
          {/* It renders OriginatorPortal which handles its own loading/error states.  */}
          <Route path="/portal/:token" element={<OriginatorPortal />} />

          {/* All other routes require authentication (handled inside AppShell) */}
          <Route path="/*" element={<AppShell />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}