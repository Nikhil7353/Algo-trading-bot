import { useState, useEffect, useCallback, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, ReferenceLine, Tooltip, PieChart, Pie, Cell } from 'recharts';
import { api } from '../api';

const POLL_INTERVAL = 30_000;

function formatCurrency(value) {
  const amount = Number(value || 0);
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function isWeekendInKolkata() {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
  }).format(new Date());
  return weekday === 'Sat' || weekday === 'Sun';
}

function StatCard({ label, value, tone = 'default', detail }) {
  return (
    <article className={`card stat-card stat-card-${tone}`}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {detail && <span className="stat-detail">{detail}</span>}
    </article>
  );
}

function railPct(pos) {
  const sl = Number(pos.stop_loss || 0);
  const tp = Number(pos.take_profit || 0);
  const cmp = Number(pos.current_price || pos.entry_price || 0);
  if (!sl || !tp || tp === sl) return 50;
  return Math.max(4, Math.min(96, ((cmp - sl) / (tp - sl)) * 100));
}

const MIX_COLORS = ['#c4b5fd', '#2dd4bf', '#fbbf24', '#fb7185', '#38bdf8'];

function EquityTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <span>{point.event || point.label || 'Equity'}</span>
      <strong>{formatCurrency(point.equity)}</strong>
    </div>
  );
}

function equityAxisDomain(values, initialCapital) {
  const nums = values.filter((value) => Number.isFinite(value));
  const lo = Math.min(initialCapital, ...nums);
  const hi = Math.max(initialCapital, ...nums);
  const pad = Math.max(5000, initialCapital * 0.15, (hi - lo) * 0.5);
  return [Math.max(0, Math.floor((lo - pad) / 1000) * 1000), Math.ceil((hi + pad) / 1000) * 1000];
}

export default function Dashboard() {
  const [portfolio, setPortfolio] = useState(null);
  const [trades, setTrades] = useState([]);
  const [performance, setPerformance] = useState([]);
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [squaringOff, setSquaringOff] = useState(false);
  const [closingSymbol, setClosingSymbol] = useState(null);
  const [squareOffMessage, setSquareOffMessage] = useState('');
  const [bot, setBot] = useState({ is_running: false, logs: [] });
  const [risk, setRisk] = useState(null);

  const fetchData = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);

    try {
      const [portfolioResult, tradeResult] = await Promise.all([
        api.portfolio(),
        api.trades(),
      ]);

      setPortfolio(portfolioResult);
      const tradeRows = Array.isArray(tradeResult) ? tradeResult : (tradeResult.results || []);
      setTrades(tradeRows.filter((trade) => trade.pnl_type === 'REALIZED' || trade.exit_price != null));
      setError('');
      setLastUpdated(new Date());
      setLoading(false);
      setRefreshing(false);

      api.performance()
        .then((performanceResult) => {
          setPerformance(Array.isArray(performanceResult) ? performanceResult : (performanceResult.results || []));
        })
        .catch(() => {});
      api.positions()
        .then((positionResult) => {
          setPositions(Array.isArray(positionResult) ? positionResult.filter((p) => p.is_open) : (positionResult.results || []).filter((p) => p.is_open));
          setLastUpdated(new Date());
        })
        .catch(() => {});
    } catch {
      setError('Dashboard data could not be refreshed. Check that the API server is running on port 8000.');
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const timer = setInterval(() => fetchData({ silent: true }), POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [fetchData]);

  useEffect(() => {
    api.getSettings().then(setRisk).catch(() => {});
    const loadBot = () => api.getAutoTraderStatus().then(setBot).catch(() => {});
    loadBot();
    const timer = setInterval(loadBot, 10_000);
    return () => clearInterval(timer);
  }, []);

  const handleClosePosition = async (pos) => {
    if (!pos || closingSymbol) return;
    setClosingSymbol(pos.symbol);
    const exitSide = (pos.side === 'SHORT' || pos.side === 'SELL') ? 'BUY' : 'SELL';
    try {
      await api.execute({
        symbol: pos.symbol,
        side: exitSide,
        quantity: pos.quantity,
        price: Number(pos.current_price || pos.entry_price || 100),
      });
      setSquareOffMessage(`Closed position: ${pos.symbol} (${pos.quantity} shares).`);
      await fetchData({ silent: true });
    } catch (err) {
      setError(`Failed to close ${pos.symbol}: ${err.message}`);
    } finally {
      setClosingSymbol(null);
      setTimeout(() => setSquareOffMessage(''), 5000);
    }
  };

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

  const initialCapital = Number(portfolio?.initial_capital || 25000);
  const currentCapital = Number(portfolio?.current_capital || initialCapital);
  const availableCash = Number(portfolio?.available_cash ?? Math.max(0, currentCapital));
  const investedCapital = Number(portfolio?.invested_capital ?? 0);
  const realizedPnl = Number(portfolio?.realized_pnl || 0);
  const unrealizedPnl = Number(portfolio?.unrealized_pnl || 0);
  const mixData = [
    { name: 'Cash', value: Math.max(availableCash, 0) },
    ...positions.map((pos) => ({
      name: pos.symbol,
      value: Number(pos.quantity || 0) * Number(pos.entry_price || 0),
    })),
  ].filter((row) => row.value > 0);
  const cashPct = currentCapital > 0 ? (availableCash / currentCapital) * 100 : 0;
  const istStamp = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  }).format(new Date());
  const riskCfg = risk?.risk || {};
  const botLogs = Array.isArray(bot.logs) ? bot.logs.slice(0, 4) : [];
  const priceColumnLabel = isWeekendInKolkata() ? 'Last close' : 'Last price';

  const equityCurve = useMemo(() => {
    const dailyRows = [...(performance || [])]
      .map((point) => ({
        label: point.date || point.created_at?.slice(0, 10) || '',
        event: point.date ? `EOD ${point.date}` : 'Daily close',
        equity: Number(point.ending_capital ?? point.equity ?? point.current_capital ?? 0),
      }))
      .filter((point) => point.label && Number.isFinite(point.equity) && point.equity > 0)
      .sort((a, b) => String(a.label).localeCompare(String(b.label)));

    if (dailyRows.length > 1) {
      return dailyRows;
    }

    const closed = [...(trades || [])]
      .filter((trade) => trade.pnl_type === 'REALIZED' || trade.exit_price != null)
      .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));

    const points = [
      { label: 'Start', event: 'Starting capital', equity: initialCapital },
    ];

    let runningEquity = initialCapital;
    closed.forEach((trade) => {
      runningEquity += Number(trade.pnl || 0);
      const when = trade.created_at
        ? new Date(trade.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'Close';
      points.push({
        label: when,
        event: `Closed ${trade.symbol || 'trade'}  ${formatCurrency(trade.pnl)}`,
        equity: runningEquity,
      });
    });

    points.push({
      label: 'Now',
      event: 'Equity now (open lots marked to last price)',
      equity: currentCapital,
    });
    return points;
  }, [performance, trades, initialCapital, currentCapital]);

  const equityDomain = useMemo(
    () => equityAxisDomain(equityCurve.map((point) => point.equity), initialCapital),
    [equityCurve, initialCapital],
  );

  if (loading && !portfolio) {
    return (
      <section className="dashboard-page" aria-busy="true">
        <div className="page-heading">
          <div>
            <h1>Overview</h1>
            <p className="page-subtitle">Loading marks…</p>
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

  return (
    <section className="dashboard-page">
      <header className="page-heading dashboard-header">
        <div>
          <h1>Overview</h1>
          <p className="page-subtitle">{istStamp} · {isWeekendInKolkata() ? 'last-close marks' : 'live session marks'} · IST</p>
        </div>
        <div className="header-chips">
          <button
            type="button"
            className="chip refresh-chip"
            onClick={() => fetchData({ silent: false })}
            disabled={refreshing}
            title="Refresh live portfolio and prices"
          >
            <svg
              className={`refresh-icon ${refreshing ? 'spinning' : ''}`}
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            <span>{refreshing ? 'Syncing…' : 'Refresh'}</span>
          </button>
          <span className="chip mode-chip">
            <i className="mode-pulse" /> Paper Trading
          </span>
          <span className={`chip ${bot.is_running ? 'bot-active' : ''}`}>
            AutoBot: {bot.is_running ? 'RUNNING' : 'OFF'}
          </span>
          <span className={`chip ${unrealizedPnl > 0 ? 'up' : unrealizedPnl < 0 ? 'down' : ''}`}>
            Unreal: {unrealizedPnl >= 0 ? '+' : ''}{formatCurrency(unrealizedPnl)}
          </span>
        </div>
      </header>

      {error && <div className="dashboard-alert" role="status">{error}</div>}
      {squareOffMessage && <div className="dashboard-alert success-alert" role="status" style={{ background: '#0a3820', borderColor: '#00e676', color: '#b9f6ca', padding: '12px 16px', borderRadius: '8px', marginBottom: '16px' }}>{squareOffMessage}</div>}

      <div className="stats-grid dashboard-stats-grid">
        <StatCard label="Total Equity" value={formatCurrency(currentCapital)} detail="Cash + Holdings" tone="default" />
        <StatCard label="Available Cash" value={formatCurrency(availableCash)} detail={`${cashPct.toFixed(1)}% Free Margin`} tone="default" />
        <StatCard
          label="Invested Capital"
          value={formatCurrency(investedCapital)}
          detail={positions.map((p) => p.symbol).slice(0, 2).join(' · ') || 'Flat (0 Lots)'}
          tone="default"
        />
        <StatCard
          label="Unrealized P&L"
          value={`${unrealizedPnl >= 0 ? '+' : ''}${formatCurrency(unrealizedPnl)}`}
          tone={unrealizedPnl > 0 ? 'positive' : unrealizedPnl < 0 ? 'negative' : 'default'}
          detail={isWeekendInKolkata() ? 'Weekend Close' : 'Live Mark-to-Market'}
        />
        <StatCard
          label="Realized P&L"
          value={formatCurrency(realizedPnl)}
          tone={realizedPnl > 0 ? 'positive' : realizedPnl < 0 ? 'negative' : 'default'}
          detail={`${trades.length} Closed Trades`}
        />
        <StatCard
          label="Active Lots"
          value={`${positions.length} / ${riskCfg.max_open_positions || 5}`}
          detail={`${positions.length === 0 ? 'No Open Risk' : 'In Market'}`}
          tone={positions.length > 0 ? 'positive' : 'default'}
        />
      </div>

      <div className="dashboard-grid">
        <article className="card dashboard-panel equity-panel">
          <div className="panel-heading">
            <div>
              <h2>Mark Path (Equity Curve)</h2>
              <p>Step after each closed trade · Cash {formatCurrency(availableCash)} + Holdings {formatCurrency(investedCapital)}</p>
            </div>
            <div className="equity-quick-stat">
              <span className="stat-tag">Net Return:</span>
              <strong className={`mono ${realizedPnl >= 0 ? 'positive' : 'negative'}`}>
                {realizedPnl >= 0 ? '+' : ''}{formatCurrency(realizedPnl)}
              </strong>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={equityCurve} margin={{ top: 10, right: 8, bottom: 0, left: 4 }}>
              <defs>
                <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#c4b5fd" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#c4b5fd" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" tick={{ fill: '#b3a6d4', fontSize: 10 }} axisLine={{ stroke: 'rgba(255,255,255,0.12)' }} tickLine={false} />
              <YAxis
                domain={equityDomain}
                tick={{ fill: '#b3a6d4', fontSize: 11 }}
                width={72}
                tickFormatter={(value) => `₹${Math.round(value).toLocaleString('en-IN')}`}
              />
              <Tooltip content={<EquityTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.16)', strokeWidth: 1 }} />
              {initialCapital > 0 && <ReferenceLine y={initialCapital} stroke="#8b7db0" strokeDasharray="4 4" />}
              <Area
                type="stepAfter"
                dataKey="equity"
                name="Equity"
                stroke="#c4b5fd"
                strokeWidth={2.5}
                fillOpacity={1}
                fill="url(#equityGrad)"
                activeDot={{ r: 5, fill: '#2dd4bf', stroke: '#050414', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </article>

        <article className="card dashboard-panel trades-panel">
          <div className="panel-heading">
            <div>
              <h2>Book Mix</h2>
              <p>Asset allocation vs open lots</p>
            </div>
          </div>
          {mixData.length > 0 ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '8px 0' }}>
                <ResponsiveContainer width="48%" height={150}>
                  <PieChart>
                    <Pie data={mixData} dataKey="value" innerRadius={42} outerRadius={60} paddingAngle={4} stroke="none">
                      {mixData.map((row, idx) => (
                        <Cell key={row.name} fill={MIX_COLORS[idx % MIX_COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'grid', gap: 8 }}>
                  {mixData.map((row, idx) => (
                    <div key={row.name} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: MIX_COLORS[idx % MIX_COLORS.length] }} />
                      <span style={{ color: '#f7f4ff', fontWeight: 600 }}>{row.name}:</span>
                      <span>{currentCapital > 0 ? `${((row.value / currentCapital) * 100).toFixed(1)}%` : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="book-mix-summary-bar">
                <div className="summary-item">
                  <span className="label">Free Cash</span>
                  <strong className="mono">{formatCurrency(availableCash)}</strong>
                </div>
                <div className="summary-item">
                  <span className="label">Margin Deployed</span>
                  <strong className="mono">{formatCurrency(investedCapital)}</strong>
                </div>
              </div>
            </>
          ) : (
            <p className="muted-copy">No book mix yet.</p>
          )}
        </article>
      </div>

      {positions.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span className="muted-copy" style={{ fontWeight: 650, color: '#f7f4ff' }}>Active Positions · SL / TP Range Tracking</span>
            <button type="button" className="btn btn-danger btn-sm" onClick={handleSquareOffAll} disabled={squaringOff}>
              {squaringOff ? 'Closing…' : 'Square Off All'}
            </button>
          </div>
          <div className="pos-lots">
            {positions.map((pos) => {
              const pnl = Number(pos.unrealized_pnl || 0);
              const pct = railPct(pos);
              const isClosing = closingSymbol === pos.symbol;
              return (
                <div className="lot" key={pos.id || pos.symbol}>
                  <div className="hd">
                    <div>
                      <b>{pos.symbol}</b>{' '}
                      <span className={`signal-badge ${String(pos.side || 'buy').toLowerCase()}`}>
                        {pos.side || 'LONG'} {pos.quantity}
                      </span>
                    </div>
                    <span className={`mono ${pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : ''}`}>
                      {pnl >= 0 ? '+' : ''}{formatCurrency(pnl)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--text-muted)' }}>
                    <span>Entry {Number(pos.entry_price || 0).toLocaleString('en-IN')}</span>
                    <span>{priceColumnLabel} {Number(pos.current_price || pos.entry_price || 0).toLocaleString('en-IN')}</span>
                  </div>
                  <div className="rail">
                    <i style={{ width: `${pct}%` }} />
                    <span className="markr" style={{ left: `${pct}%` }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--text-muted)' }}>
                    <span>SL {Number(pos.stop_loss || 0).toFixed(2)}</span>
                    <span>TP {Number(pos.take_profit || 0).toFixed(2)}</span>
                  </div>
                  <button type="button" className="text-button" style={{ marginTop: 8 }} onClick={() => handleClosePosition(pos)} disabled={isClosing}>
                    {isClosing ? 'Closing…' : 'Close lot'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="dashboard-lower-grid" style={{ marginTop: 14 }}>
        <article className="card dashboard-panel">
          <div className="panel-heading">
            <div>
              <h2>AutoBot Decision Stream</h2>
              <p>Real-time strategy telemetry and scanning events</p>
            </div>
            <span className={`badge ${bot.is_running ? 'badge-success' : 'badge-idle'}`} style={{ fontSize: '0.7rem' }}>
              {bot.is_running ? 'POLLING LIVE' : 'DAEMON IDLE'}
            </span>
          </div>
          <div className="tape-feed">
            {botLogs.length > 0 ? (
              botLogs.map((log, idx) => (
                <div className={`ev ${log.level || 'info'}`} key={idx}>
                  <time>{String(log.timestamp || '').split(' ').pop() || '—'}</time>
                  <div className="ev-msg">{log.message}</div>
                </div>
              ))
            ) : (
              <div className="tape-idle-box">
                <div className="idle-title">🤖 Auto-Trader Engine Ready</div>
                <p>Configured with 5 active breakout strategies across 6 watchlist stocks. Click <strong>AutoBot Toggle</strong> in the sidebar to start continuous automated execution.</p>
              </div>
            )}
          </div>
        </article>

        <article className="card dashboard-panel">
          <div className="panel-heading">
            <div>
              <h2>Risk Envelope & Guardrails</h2>
              <p>Enforced by Risk Management Engine</p>
            </div>
            <span className="badge badge-success" style={{ fontSize: '0.7rem' }}>SHIELD ACTIVE</span>
          </div>
          <div className="risk-guardrails-grid">
            <div className="guardrail-row">
              <div className="guardrail-info">
                <span>Max Daily Drawdown Halt</span>
                <strong>{riskCfg.max_daily_loss_pct ?? 2}% Max</strong>
              </div>
              <div className="guardrail-meter"><i style={{ width: '0%', background: '#4ade80' }} /></div>
            </div>
            <div className="guardrail-row">
              <div className="guardrail-info">
                <span>Max Single Position Allocation</span>
                <strong>{riskCfg.max_position_pct ?? 25}% of Capital</strong>
              </div>
              <div className="guardrail-meter"><i style={{ width: '0%', background: '#2dd4bf' }} /></div>
            </div>
            <div className="guardrail-row">
              <div className="guardrail-info">
                <span>Concurrent Position Capacity</span>
                <strong>{positions.length} / {riskCfg.max_open_positions ?? 5} Slots</strong>
              </div>
              <div className="guardrail-meter"><i style={{ width: `${(positions.length / (riskCfg.max_open_positions || 5)) * 100}%`, background: '#c4b5fd' }} /></div>
            </div>
            <div className="guardrail-row">
              <div className="guardrail-info">
                <span>Default Stop-Loss & Target</span>
                <strong className="mono">{riskCfg.stop_loss_pct ?? 2}% SL · {riskCfg.take_profit_pct ?? 4}% TP</strong>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
