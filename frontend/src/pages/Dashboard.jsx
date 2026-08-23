import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { LineChart, Line, YAxis, ResponsiveContainer, ReferenceLine, Tooltip } from 'recharts';
import { api } from '../api';
import AutoTraderWidget from '../components/AutoTraderWidget';

const POLL_INTERVAL = 30_000;

function formatCurrency(value) {
  const amount = Number(value || 0);
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatNumber(value, suffix = '') {
  const amount = Number(value || 0);
  return `${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}${suffix}`;
}

function formatStrategyName(name) {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function StatCard({ label, value, tone = 'default', detail, icon, badge }) {
  return (
    <article className={`card stat-card stat-card-${tone}`}>
      <div className="stat-card-header">
        <span className="stat-label">{label}</span>
        {icon && <span className="stat-icon-badge">{icon}</span>}
      </div>
      <strong className="stat-value">{value}</strong>
      <div className="stat-card-footer">
        {detail && <span className="stat-detail">{detail}</span>}
        {badge && <span className={`stat-pill-sm ${tone}`}>{badge}</span>}
      </div>
    </article>
  );
}

function EquityTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <span>{point.label || 'Portfolio value'}</span>
      <strong>{formatCurrency(point.equity)}</strong>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [portfolio, setPortfolio] = useState(null);
  const [strategies, setStrategies] = useState(null);
  const [trades, setTrades] = useState([]);
  const [performance, setPerformance] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [squaringOff, setSquaringOff] = useState(false);
  const [squareOffMessage, setSquareOffMessage] = useState('');

  const fetchData = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);

    try {
      const [portfolioResult, strategyResult, tradeResult, performanceResult] = await Promise.all([
        api.portfolio(),
        api.strategies(),
        api.trades(),
        api.performance(),
      ]);

      setPortfolio(portfolioResult);
      setStrategies(strategyResult);
      setTrades(Array.isArray(tradeResult) ? tradeResult : (tradeResult.results || []));
      setPerformance(Array.isArray(performanceResult) ? performanceResult : (performanceResult.results || []));
      setError('');
      setLastUpdated(new Date());
    } catch {
      setError('Dashboard data could not be refreshed. Check that the API server is running on port 8000.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const timer = setInterval(() => fetchData({ silent: true }), POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [fetchData]);

  const handleSquareOffAll = async () => {
    if (!window.confirm('Are you sure you want to square off ALL open positions immediately?')) {
      return;
    }
    setSquaringOff(true);
    try {
      const res = await api.emergencySquareOff();
      setSquareOffMessage(res.message || 'All positions squared off successfully.');
      await fetchData({ silent: true });
    } catch (err) {
      setError(`Square-off failed: ${err.message}`);
    } finally {
      setSquaringOff(false);
      setTimeout(() => setSquareOffMessage(''), 6000);
    }
  };

  if (loading && !portfolio) {
    return (
      <section className="dashboard-page" aria-busy="true">
        <div className="page-heading">
          <div>
            <span className="eyebrow">Paper trading workspace</span>
            <h1>Dashboard</h1>
          </div>
        </div>
        <div className="skeleton-grid">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="card skeleton-card"><div className="skeleton-shimmer" /></div>
          ))}
        </div>
      </section>
    );
  }

  if (!portfolio) return <div className="error">{error || 'Failed to load portfolio.'}</div>;

  const realizedPnl = Number(portfolio.realized_pnl || 0);
  const unrealizedPnl = Number(portfolio.unrealized_pnl || 0);
  const initialCapital = Number(portfolio.initial_capital || 0);
  const currentCapital = Number(portfolio.current_capital || initialCapital);
  const accountChange = initialCapital ? ((currentCapital - initialCapital) / initialCapital) * 100 : 0;
  const topTrades = trades.slice(0, 5);
  const activeStrategies = strategies?.active || [];
  const availableStrategies = strategies?.available || activeStrategies;
  const equityCurve = performance
    .map((point) => ({
      label: point.date || point.created_at?.slice(0, 10) || '',
      equity: Number(point.equity ?? point.current_capital ?? point.portfolio_value ?? 0),
    }))
    .filter((point) => Number.isFinite(point.equity) && point.equity > 0);
  const hasEquityHistory = equityCurve.length > 1;

  return (
    <section className="dashboard-page">
      <header className="page-heading dashboard-header">
        <div>
          <span className="eyebrow">Paper trading workspace</span>
          <h1>Dashboard</h1>
          <p className="page-subtitle">A live view of capital, risk, and your latest trading activity.</p>
        </div>
        <div className="dashboard-status">
          <span className="status-dot" aria-hidden="true" />
          <span>{refreshing ? 'Refreshing data…' : 'Auto-refresh on'}</span>
          {lastUpdated && <small>Updated {lastUpdated.toLocaleTimeString()}</small>}
        </div>
      </header>

      {error && <div className="dashboard-alert" role="status">{error}</div>}
      {squareOffMessage && <div className="dashboard-alert success-alert" role="status" style={{ background: '#0a3820', borderColor: '#00e676', color: '#b9f6ca', padding: '12px 16px', borderRadius: '8px', marginBottom: '16px' }}>{squareOffMessage}</div>}

      <div className="stats-grid dashboard-stats-grid">
        <StatCard
          label="Portfolio value"
          value={formatCurrency(currentCapital)}
          icon="💰"
          tone={accountChange >= 0 ? 'positive' : 'negative'}
          detail={`${accountChange >= 0 ? '+' : ''}${formatNumber(accountChange, '%')} from starting capital`}
        />
        <StatCard
          label="Open positions"
          value={formatNumber(portfolio.open_positions)}
          icon="⚡"
          detail="Currently active in market"
          badge={portfolio.open_positions > 0 ? 'ACTIVE' : 'IDLE'}
        />
        <StatCard
          label="Unrealized P&L"
          value={formatCurrency(unrealizedPnl)}
          icon="📈"
          tone={unrealizedPnl > 0 ? 'positive' : unrealizedPnl < 0 ? 'negative' : 'default'}
          detail="Open-position movement"
        />
        <StatCard
          label="Realized P&L"
          value={formatCurrency(realizedPnl)}
          icon="🎯"
          tone={realizedPnl > 0 ? 'positive' : realizedPnl < 0 ? 'negative' : 'default'}
          detail="Closed-position result"
        />
        <StatCard
          label="Win rate"
          value={formatNumber(portfolio.win_rate, '%')}
          icon="🏆"
          tone={portfolio.win_rate >= 50 ? 'positive' : 'default'}
          detail="Across completed trades"
        />
        <StatCard
          label="Max drawdown"
          value={formatNumber(portfolio.max_drawdown_pct, '%')}
          icon="🛡️"
          tone={portfolio.max_drawdown_pct > 5 ? 'negative' : 'default'}
          detail="Peak to trough decline"
        />
      </div>

      <div className="dashboard-grid">
        <article className="card dashboard-panel equity-panel">
          <div className="panel-heading">
            <div>
              <h2>Portfolio equity</h2>
              <p>Historical account value</p>
            </div>
            <strong>{formatCurrency(currentCapital)}</strong>
          </div>
          {hasEquityHistory ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={equityCurve} margin={{ top: 10, right: 8, bottom: 0, left: 4 }}>
                <YAxis domain={['auto', 'auto']} tick={{ fill: '#8990b0', fontSize: 11 }} width={68} tickFormatter={(value) => `Rs ${Math.round(value).toLocaleString()}`} />
                <Tooltip content={<EquityTooltip />} cursor={{ stroke: '#31375a', strokeWidth: 1 }} />
                {initialCapital > 0 && <ReferenceLine y={initialCapital} stroke="#596080" strokeDasharray="4 4" />}
                <Line type="monotone" dataKey="equity" stroke="#00d4ff" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: '#00d4ff', stroke: '#0a0a1a', strokeWidth: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="chart-empty-state">
              <span className="empty-chart-icon" aria-hidden="true">⌁</span>
              <strong>No equity history yet</strong>
              <p>Completed trades and daily snapshots will build this chart over time.</p>
            </div>
          )}
        </article>

        <article className="card dashboard-panel trades-panel">
          <div className="panel-heading">
            <div>
              <h2>Recent trades</h2>
              <p>Your five latest trade records</p>
            </div>
            <button className="text-button" onClick={() => navigate('/trades')}>View all</button>
          </div>
          {topTrades.length === 0 ? (
            <div className="trade-empty-state">
              <strong>No trades recorded</strong>
              <p>Scan signals or run a backtest to start building your activity.</p>
              <button className="btn btn-secondary btn-sm" onClick={() => navigate('/signals')}>Open signals</button>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="table compact">
                <thead><tr><th>Symbol</th><th>Side</th><th>P&L</th></tr></thead>
                <tbody>
                  {topTrades.map((trade) => {
                    const pnl = Number(trade.pnl || 0);
                    return (
                      <tr key={trade.id || `${trade.symbol}-${trade.created_at}`}>
                        <td className="mono">{trade.symbol || '—'}</td>
                        <td><span className={`signal-badge ${(trade.side || '').toLowerCase()}`}>{trade.side || '—'}</span></td>
                        <td className={`mono pnl-value ${pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : ''}`}>{formatCurrency(pnl)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </div>

      <div style={{ marginTop: '1.25rem' }}>
        <AutoTraderWidget />
      </div>

      <div className="dashboard-lower-grid">
        <article className="card dashboard-panel strategy-panel">
          <div className="panel-heading">
            <div><h2>Strategies</h2><p>Choose which approaches are available for scanning.</p></div>
            <span className="strategy-count">{activeStrategies.length} active</span>
          </div>
          {availableStrategies.length ? (
            <div className="strategies-grid">
              {availableStrategies.map((strategy) => (
                <div
                  key={strategy}
                  className={`strategy-chip ${activeStrategies.includes(strategy) ? 'active' : ''}`}
                  onClick={() => navigate('/signals')}
                  style={{ cursor: 'pointer' }}
                  title="Click to scan with this strategy"
                >
                  {formatStrategyName(strategy)}
                </div>
              ))}
            </div>
          ) : <p className="muted-copy">No strategies are configured yet.</p>}
        </article>

        <article className="card dashboard-panel action-panel">
          <div className="panel-heading"><div><h2>Quick actions</h2><p>Move straight to the next task.</p></div></div>
          <div className="quick-actions">
            <button className="btn btn-primary" onClick={() => navigate('/signals')}>Scan signals</button>
            <button className="btn btn-secondary" onClick={() => navigate('/backtest')}>Backtest</button>
            <button className="btn btn-secondary" onClick={() => navigate('/trades')}>Trades</button>
            <button className="btn btn-outline" onClick={() => fetchData({ silent: true })} disabled={refreshing}>{refreshing ? '…' : 'Refresh'}</button>
            <button
              className="btn btn-danger"
              style={{ background: '#d32f2f', color: '#fff', borderColor: '#f44336' }}
              onClick={handleSquareOffAll}
              disabled={squaringOff || portfolio.open_positions === 0}
            >
              {squaringOff ? 'Closing…' : 'Square off'}
            </button>
          </div>
        </article>
      </div>
    </section>
  );
}
