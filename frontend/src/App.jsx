// frontend/src/App.jsx
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Dashboard          from './pages/Dashboard';
import TransactionIntake  from './pages/TransactionIntake';
import BulkUpload         from './pages/BulkUpload';
import ReviewQueue        from './pages/ReviewQueue';
import Analytics          from './pages/Analytics';
import AuditLog           from './pages/AuditLog';
import ExceptionDashboard from './pages/ExceptionDashboard';
import AccountManager     from './pages/AccountManager';
import IssuedCheckRegister from './pages/IssuedCheckRegister';
import { analyticsApi, exceptionsApi } from './api/client';
import './index.css';

function Sidebar({ pendingCount, exceptionCount }) {
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
      <div className="sidebar-footer">
        <div><span className="status-dot"/>System Online · v3.0</div>
        <div style={{marginTop:4,fontSize:'0.62rem'}}>Full NACHA · Bulk · Exceptions · Positive Pay</div>
      </div>
    </aside>
  );
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
  return <BrowserRouter><AppShell /></BrowserRouter>;
}
