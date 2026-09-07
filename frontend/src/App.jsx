import { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import MarketTicker from './components/MarketTicker';
import AutoTraderWidget from './components/AutoTraderWidget';
import AIAssistantDrawer from './components/AIAssistantDrawer';
import { usePortfolio } from './PortfolioContext.jsx';
import { formatCurrency } from './utils.js';
import './App.css';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Signals = lazy(() => import('./pages/Signals'));
const Trades = lazy(() => import('./pages/Trades'));
const Backtest = lazy(() => import('./pages/Backtest'));
const Settings = lazy(() => import('./pages/Settings'));
const AIAssistant = lazy(() => import('./pages/AIAssistant'));

function RouteFallback() {
  return (
    <section className="dashboard-page" aria-busy="true">
      <p className="muted-copy" style={{ padding: '1.5rem 0' }}>Loading desk…</p>
    </section>
  );
}

function MarketSessionWidget() {
  const [timeStr, setTimeStr] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const istOptions = { timeZone: 'Asia/Kolkata', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' };
      const timeFormatted = new Intl.DateTimeFormat('en-IN', istOptions).format(now);
      setTimeStr(timeFormatted);

      const day = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(now);
      const isWeekend = day === 'Sat' || day === 'Sun';

      // Check IST hours 09:15 to 15:30
      const [h, m] = timeFormatted.split(':').map(Number);
      const totalMinutes = h * 60 + m;
      const marketOpen = 9 * 60 + 15;
      const marketClose = 15 * 60 + 30;
      setIsOpen(!isWeekend && totalMinutes >= marketOpen && totalMinutes <= marketClose);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="sidebar-market-card">
      <div className="market-card-header">
        <span className="market-card-title">
          <i className={`market-status-dot ${isOpen ? 'open' : 'closed'}`} />
          {isOpen ? 'NSE Market: OPEN' : 'NSE Market: CLOSED'}
        </span>
        <span className="market-ist-clock">{timeStr} IST</span>
      </div>
      <div className="market-card-stats">
        <div className="market-mini-stat">
          <span className="stat-name">Active Engine</span>
          <span className="stat-val">5 Strategies</span>
        </div>
        <div className="market-mini-stat">
          <span className="stat-name">Broker Feed</span>
          <span className="stat-val highlight">Angel One LTP</span>
        </div>
      </div>
    </div>
  );
}

function SidebarEquity() {
  // Consumes the shared PortfolioContext — no extra fetch needed
  const { portfolio } = usePortfolio();

  const equity = Number(portfolio?.current_capital || 25000);
  const cash = Number(portfolio?.available_cash || 0);
  const invested = Number(portfolio?.invested_capital || 0);
  const lots = Number(portfolio?.open_positions || 0);
  const deployed = equity > 0 ? Math.min(100, (invested / equity) * 100) : 0;

  return (
    <div className="sidebar-acct">
      <div className="sidebar-acct-row">
        <span className="acct-type">Paper Portfolio</span>
        <span className="sidebar-acct-live"><i className="mode-pulse" /> LIVE</span>
      </div>
      <strong className="sidebar-equity-value">{formatCurrency(equity)}</strong>
      <div className="sidebar-acct-row" style={{ marginTop: '4px' }}>
        <span>Cash: {formatCurrency(cash)}</span>
        <span className="lots-badge">{lots} lot{lots === 1 ? '' : 's'}</span>
      </div>
      <div className="meter"><i style={{ width: `${deployed.toFixed(0)}%` }} /></div>
      <div className="sidebar-acct-row muted-row">
        <span>{deployed.toFixed(0)}% deployed</span>
        <span>Risk: 2% SL</span>
      </div>
    </div>
  );
}

function Sidebar() {
  const links = [
    {
      to: '/',
      label: 'Overview',
      end: true,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
        </svg>
      ),
    },
    {
      to: '/signals',
      label: 'Scanner',
      badge: 'LIVE',
      badgeClass: 'badge-pulse-green',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12h3l3-9 4 18 4-11 3 4h3" />
        </svg>
      ),
    },
    {
      to: '/trades',
      label: 'Trade Book',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      ),
    },
    {
      to: '/backtest',
      label: 'Quant Lab',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 2v7.31L4.75 18.1A2 2 0 0 0 6.48 21h11.04a2 2 0 0 0 1.73-2.9L14 9.31V2" />
          <path d="M8.5 2h7" />
          <path d="M7 16h10" />
        </svg>
      ),
    },
    {
      to: '/settings',
      label: 'Controls',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" y1="21" x2="4" y2="14" />
          <line x1="4" y1="10" x2="4" y2="3" />
          <line x1="12" y1="21" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12" y2="3" />
          <line x1="20" y1="21" x2="20" y2="16" />
          <line x1="20" y1="12" x2="20" y2="3" />
          <line x1="1" y1="14" x2="7" y2="14" />
          <line x1="9" y1="8" x2="15" y2="8" />
          <line x1="17" y1="16" x2="23" y2="16" />
        </svg>
      ),
    },
    {
      to: '/assistant',
      label: 'AI Copilot',
      badge: 'AI',
      badgeClass: 'badge-glow-ai',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
          <path d="M5 3v4" />
          <path d="M19 17v4" />
        </svg>
      ),
    },
  ];

  return (
    <aside className="sidebar">
      {/* Brand Header */}
      <div className="sidebar-brand" style={{ padding: '16px 14px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {/* Logo Mark + Name Row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Exact authentic icon from original generated art */}
          <div style={{
            width: '46px',
            height: '46px',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <img
              src="/nikhil_algo_exact_icon.png"
              alt="NikhilAlgo Logo"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                filter: 'drop-shadow(0 0 12px rgba(124,58,237,0.75))',
              }}
            />
          </div>

          {/* Brand name */}
          <div style={{ lineHeight: 1 }}>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: '#ffffff' }}>Nikhil</span>
              <span style={{ background: 'linear-gradient(90deg, #c4b5fd, #2dd4bf)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Algo</span>
              <span style={{
                fontSize: '0.62rem',
                padding: '0.1rem 0.38rem',
                borderRadius: '5px',
                background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.5), rgba(45, 212, 191, 0.35))',
                border: '1px solid rgba(45, 212, 191, 0.7)',
                color: '#2dd4bf',
                fontWeight: 800,
                letterSpacing: '0.04em',
                boxShadow: '0 0 8px rgba(45, 212, 191, 0.3)',
              }}>
                AI
              </span>
            </div>
            <div style={{ fontSize: '0.58rem', color: '#8b7db0', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: '3px' }}>
              AI Algorithmic Platform
            </div>
          </div>
        </div>

        {/* Live badge */}
        <span className="logo-badge">
          <i className="status-indicator-dot" /> ANGEL ONE · LIVE
        </span>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            end={l.end}
          >
            <span className="nav-icon">{l.icon}</span>
            <span className="nav-text">{l.label}</span>
            {l.badge && <span className={`nav-item-badge ${l.badgeClass}`}>{l.badge}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Center Market Status Widget */}
      <MarketSessionWidget />

      {/* Footer Hub */}
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
