import { useEffect, useState, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import MarketTicker from './components/MarketTicker';
import AutoTraderWidget from './components/AutoTraderWidget';
import AIAssistantDrawer from './components/AIAssistantDrawer';
import { api } from './api';
import './App.css';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Signals = lazy(() => import('./pages/Signals'));
const Trades = lazy(() => import('./pages/Trades'));
const Backtest = lazy(() => import('./pages/Backtest'));
const Settings = lazy(() => import('./pages/Settings'));
const AIAssistant = lazy(() => import('./pages/AIAssistant'));

function formatCurrency(value) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function RouteFallback() {
  return (
    <section className="dashboard-page" aria-busy="true">
      <p className="muted-copy" style={{ padding: '1.5rem 0' }}>Loading desk…</p>
    </section>
  );
}

function SidebarEquity() {
  const [portfolio, setPortfolio] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      api.portfolio()
        .then((data) => { if (alive) setPortfolio(data); })
        .catch(() => {});
    };
    const start = setTimeout(load, 0);
    const timer = setInterval(load, 30_000);
    return () => { alive = false; clearTimeout(start); clearInterval(timer); };
  }, []);

  const equity = Number(portfolio?.current_capital || 25000);
  const cash = Number(portfolio?.available_cash || 0);
  const invested = Number(portfolio?.invested_capital || 0);
  const lots = Number(portfolio?.open_positions || 0);
  const deployed = equity > 0 ? Math.min(100, (invested / equity) * 100) : 0;

  return (
    <div className="sidebar-acct">
      <div className="sidebar-acct-row">
        <span>Paper equity</span>
        <span className="sidebar-acct-live"><i className="mode-pulse" /> live</span>
      </div>
      <strong className="mono">{formatCurrency(equity)}</strong>
      <div className="sidebar-acct-row">
        <span>Cash {formatCurrency(cash)}</span>
        <span>{lots} lot{lots === 1 ? '' : 's'}</span>
      </div>
      <div className="meter"><i style={{ width: `${deployed.toFixed(0)}%` }} /></div>
      <div className="sidebar-acct-row">
        <span>{deployed.toFixed(0)}% deployed</span>
        <span>risk 2%</span>
      </div>
    </div>
  );
}

function Sidebar() {
  const links = [
    { to: '/', label: 'Overview', end: true },
    { to: '/signals', label: 'Scanner' },
    { to: '/trades', label: 'Book' },
    { to: '/backtest', label: 'Lab' },
    { to: '/settings', label: 'Controls' },
    { to: '/assistant', label: 'Copilot' },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-icon" />
        <div className="logo-text">
          <span className="logo-title">Aether Desk</span>
          <span className="logo-badge">Aurora · live</span>
        </div>
      </div>
      <nav className="sidebar-nav">
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            end={l.end}
          >
            <span className="nav-text">{l.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">
        <AutoTraderWidget compact />
        <SidebarEquity />
      </div>
    </aside>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-stage">
        <div className="aurora-orbs" aria-hidden="true">
          <span className="orb a" />
          <span className="orb b" />
          <span className="orb c" />
        </div>
        <div className="app">
          <Sidebar />
          <main className="main">
            <MarketTicker />
            <div className="main-body">
              <Suspense fallback={<RouteFallback />}>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/assistant" element={<AIAssistant />} />
                  <Route path="/signals" element={<Signals />} />
                  <Route path="/trades" element={<Trades />} />
                  <Route path="/backtest" element={<Backtest />} />
                  <Route path="/settings" element={<Settings />} />
                </Routes>
              </Suspense>
            </div>
            <AIAssistantDrawer />
          </main>
        </div>
      </div>
    </BrowserRouter>
  );
}
