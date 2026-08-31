import { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { api } from '../api';

function formatCurrency(value) {
  const amount = Number(value || 0);
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatStrategy(value) {
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const QUICK_STOCKS = [
  { sym: 'RELIANCE', sector: 'Energy' },
  { sym: 'SBIN', sector: 'Banking' },
  { sym: 'TCS', sector: 'IT Services' },
  { sym: 'INFY', sector: 'Tech' },
  { sym: 'ITC', sector: 'FMCG' },
  { sym: 'TATAMOTORS', sector: 'Auto' },
];

const CAPITAL_PRESETS = [10000, 25000, 50000, 100000];

export default function Backtest() {
  const [symbol, setSymbol] = useState('RELIANCE');
  const [strategies, setStrategies] = useState(['ema_crossover', 'supertrend']);
  const [capital, setCapital] = useState(25000);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.strategies()
      .then((response) => setAvailable(response?.available || []))
      .catch(() => setError('Strategies could not be loaded. Confirm that the API server is running.'));
  }, []);

  const handleRun = async () => {
    const targetSymbol = symbol.trim().toUpperCase();
    if (!targetSymbol) {
      setError('Please enter a stock symbol (e.g. RELIANCE, SBIN, TCS) or select one of the quick chips below.');
      return;
    }
    if (Number(capital) <= 0) {
      setError('Please enter a positive initial capital amount.');
      return;
    }
    if (!strategies.length) {
      setError('Please select at least one strategy to evaluate.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await api.backtest({ symbol: targetSymbol, strategies, capital: Number(capital) });
      setResult(response);
    } catch (requestError) {
      setResult(null);
      setError(requestError?.message || 'The backtest could not be completed. Try again in a moment.');
    } finally {
      setLoading(false);
    }
  };

  const toggleStrategy = (strategy) => {
    setStrategies((current) =>
      current.includes(strategy) ? current.filter((item) => item !== strategy) : [...current, strategy]
    );
  };

  const totalPnl = Number(result?.total_pnl || 0);
  const totalReturn = Number(result?.total_return_pct || 0);
  const winRate = Number(result?.win_rate || 0);
  const maxDrawdown = Number(result?.max_drawdown_pct || 0);
  const chartData = result?.equity_curve || [];

  return (
    <section className="backtest-page">
      <header className="page-heading backtest-heading">
        <div>
          <h1>Quant Lab</h1>
          <p className="page-subtitle">Historical backtesting, multi-strategy simulation &amp; risk analytics</p>
        </div>
        <div className="header-chips">
          <span className="chip mode-chip">
            <i className="mode-pulse" /> Simulation Lab
          </span>
          <span className="chip">
            {strategies.length} Selected {strategies.length === 1 ? 'Strategy' : 'Strategies'}
          </span>
        </div>
      </header>

      <div className="backtest-workspace">
        <article className="card backtest-config-card">
          <div className="panel-heading">
            <div>
              <h2>Simulation Parameters</h2>
              <p>Choose instrument, initial capital, and algorithmic strategies to backtest.</p>
            </div>
          </div>

          <div className="backtest-input-grid">
            <div className="form-group">
              <label>Target Stock Symbol</label>
              <input
                value={symbol}
                onChange={(event) => setSymbol(event.target.value.toUpperCase())}
                className="input mono"
                placeholder="e.g. RELIANCE, SBIN, TCS"
              />
              <div className="quick-symbol-chips-grid" style={{ marginTop: '8px' }}>
                {QUICK_STOCKS.map((s) => (
                  <button
                    key={s.sym}
                    type="button"
                    className={`stock-chip-btn ${symbol === s.sym ? 'active' : ''}`}
                    onClick={() => setSymbol(s.sym)}
                  >
                    <strong>{s.sym}</strong>
                    <span className="chip-sector">{s.sector}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label>Initial Capital (₹)</label>
              <input
                type="number"
                min="1000"
                value={capital}
                onChange={(event) => setCapital(event.target.value)}
                className="input mono"
              />
              <div className="quick-qty-chips" style={{ marginTop: '8px' }}>
                {CAPITAL_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`chip-sm ${Number(capital) === c ? 'active' : ''}`}
                    onClick={() => setCapital(c)}
                  >
                    ₹{(c / 1000).toFixed(0)}k
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="strategy-picker" style={{ marginTop: '14px' }}>
            <div className="strategy-picker-heading">
              <span>ACTIVE STRATEGIES TO TEST</span>
              <small>{strategies.length} selected</small>
            </div>
            <div className="strategy-toggles" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '6px' }}>
              {available.map((strategy) => {
                const isSelected = strategies.includes(strategy);
                return (
                  <button
                    key={strategy}
                    type="button"
                    className={`btn btn-sm ${isSelected ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => toggleStrategy(strategy)}
                    style={{ fontSize: '0.8rem', padding: '0.4rem 0.85rem' }}
                  >
                    {isSelected ? '✓ ' : '+ '}{formatStrategy(strategy)}
                  </button>
                );
              })}
            </div>
            {!available.length && !error && <p className="muted-copy">Loading available algorithms…</p>}
          </div>

          <div className="backtest-action-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="muted-copy" style={{ fontSize: '0.78rem' }}>
              ⚡ Backtests simulate execution with slippage and exchange fees on historical OHLCV data.
            </p>
            <button onClick={handleRun} disabled={loading || !strategies.length} className="btn btn-primary" style={{ padding: '0.65rem 1.4rem', fontWeight: 700 }}>
              {loading ? 'Running Quant Backtest…' : '⚡ Run Simulation'}
            </button>
          </div>
        </article>

        <aside className="card backtest-tips-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <span className="eyebrow">Quant Rules</span>
            <h2 style={{ fontSize: '1rem', marginTop: '4px' }}>Optimizing Strategy Alpha</h2>
            <ul style={{ paddingLeft: '1.1rem', marginTop: '10px', display: 'grid', gap: '8px', fontSize: '0.8rem', color: '#b3a6d4' }}>
              <li><strong>Trend + Mean Reversion:</strong> Pairing Supertrend with RSI filters false breakout whipsaws.</li>
              <li><strong>Capital Sizing:</strong> Keep capital consistent across test runs to benchmark Sharpe ratios.</li>
              <li><strong>Risk Drawdown:</strong> Aim for max drawdown under 10% for institutional capital safety.</li>
            </ul>
          </div>
          <div style={{ marginTop: '12px', padding: '8px 12px', background: 'rgba(45, 212, 191, 0.1)', border: '1px solid rgba(45, 212, 191, 0.25)', borderRadius: '10px', fontSize: '0.74rem', color: '#2dd4bf' }}>
            💡 Tip: Open <strong>AI Copilot</strong> to ask for recommendations on optimal indicator periods for {symbol}.
          </div>
        </aside>
      </div>

      {error && <div className="dashboard-alert" style={{ marginTop: '14px' }}>{error}</div>}

      {!result && !loading && !error && (
        <article className="card scanner-radar-hub" style={{ marginTop: '14px', textAlign: 'center', padding: '2.5rem 1.5rem' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>🧪</div>
          <h2>Ready to Run Quant Backtest</h2>
          <p style={{ maxWidth: '500px', margin: '0 auto', color: '#b3a6d4', fontSize: '0.86rem' }}>
            Configure your parameters above and click <strong>Run Simulation</strong> to compute multi-year performance tear-sheets, equity growth curves, win rates, and drawdowns.
          </p>
        </article>
      )}

      {result && (
        <section className="backtest-results-section" style={{ marginTop: '16px' }}>
          <div className="results-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div>
              <h2>Backtest Tear-Sheet: {symbol}</h2>
              <p>{symbol} · Evaluated with {strategies.length} active strategies on ₹{Number(capital).toLocaleString('en-IN')}</p>
            </div>
            <span className="results-count">✓ Simulation Complete</span>
          </div>

          <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: '10px', marginBottom: '14px' }}>
            <article className={`card stat-card ${totalReturn >= 0 ? 'stat-card-positive' : 'stat-card-negative'}`}>
              <span className="stat-label">Total Return</span>
              <strong className={`stat-value ${totalReturn >= 0 ? 'positive' : 'negative'}`}>
                {totalReturn >= 0 ? '+' : ''}{totalReturn.toFixed(2)}%
              </strong>
              <span className="stat-detail">{formatCurrency(totalPnl)} Net P&amp;L</span>
            </article>

            <article className={`card stat-card ${totalPnl >= 0 ? 'stat-card-positive' : 'stat-card-negative'}`}>
              <span className="stat-label">Net Profit</span>
              <strong className={`stat-value ${totalPnl >= 0 ? 'positive' : 'negative'}`}>
                {totalPnl >= 0 ? '+' : ''}{formatCurrency(totalPnl)}
              </strong>
              <span className="stat-detail">Base ₹{Number(capital).toLocaleString('en-IN')}</span>
            </article>

            <article className={`card stat-card ${winRate >= 50 ? 'stat-card-positive' : 'stat-card-default'}`}>
              <span className="stat-label">Win Rate</span>
              <strong className="stat-value">{winRate.toFixed(1)}%</strong>
              <span className="stat-detail">{result.wins || 0} Wins · {result.losses || 0} Losses</span>
            </article>

            <article className="card stat-card stat-card-default">
              <span className="stat-label">Total Trades</span>
              <strong className="stat-value">{result.total_trades || 0}</strong>
              <span className="stat-detail">Simulated Fills</span>
            </article>

            <article className="card stat-card stat-card-negative">
              <span className="stat-label">Max Drawdown</span>
              <strong className="stat-value negative">{maxDrawdown.toFixed(2)}%</strong>
              <span className="stat-detail">Peak-to-Trough Loss</span>
            </article>

            <article className="card stat-card stat-card-default">
              <span className="stat-label">Ending Capital</span>
              <strong className="stat-value">{formatCurrency(Number(capital) + totalPnl)}</strong>
              <span className="stat-detail">Final Portfolio Value</span>
            </article>
          </div>

          {/* Equity Curve Chart */}
          {chartData.length > 1 && (
            <article className="card dashboard-panel" style={{ padding: '16px 18px', marginBottom: '14px' }}>
              <div className="panel-heading">
                <div>
                  <h2>Simulated Equity Growth Curve</h2>
                  <p>Portfolio valuation over time across {chartData.length} trade events</p>
                </div>
                <div className="equity-quick-stat">
                  <span className="stat-tag">Peak:</span>
                  <strong className="mono positive">
                    {formatCurrency(Math.max(...chartData.map((d) => d.equity || capital)))}
                  </strong>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 2 }}>
                  <defs>
                    <linearGradient id="backtestGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2dd4bf" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#2dd4bf" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fill: '#b3a6d4', fontSize: 10 }} minTickGap={36} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} />
                  <YAxis
                    tick={{ fill: '#b3a6d4', fontSize: 11 }}
                    domain={['auto', 'auto']}
                    width={72}
                    tickFormatter={(val) => `₹${Math.round(val).toLocaleString('en-IN')}`}
                    axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                  />
                  <Tooltip
                    contentStyle={{ background: 'rgba(12, 10, 36, 0.92)', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 12 }}
                    formatter={(value) => formatCurrency(value)}
                  />
                  <ReferenceLine y={Number(capital)} stroke="#8b7db0" strokeDasharray="4 4" />
                  <Area
                    type="monotone"
                    dataKey="equity"
                    stroke="#2dd4bf"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#backtestGrad)"
                    activeDot={{ r: 5, fill: '#c4b5fd', stroke: '#050414', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </article>
          )}

          {/* Trade Details Table */}
          {result.trades?.length > 0 && (
            <article className="card history-table-card">
              <div className="history-table-heading" style={{ padding: '14px 18px' }}>
                <div>
                  <h2>Simulated Trade Executions</h2>
                  <p>{result.trades.length} simulated trade{result.trades.length === 1 ? '' : 's'} executed by the backtest engine.</p>
                </div>
              </div>
              <div className="table-scroll">
                <table className="table history-table">
                  <thead>
                    <tr>
                      <th>Entry Date</th>
                      <th>Exit Date</th>
                      <th>Side</th>
                      <th>Entry Price</th>
                      <th>Exit Price</th>
                      <th>Qty</th>
                      <th>P&amp;L (₹)</th>
                      <th>Return %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.map((trade, index) => {
                      const pnl = Number(trade.pnl || 0);
                      const pnlPct = Number(trade.pnl_pct || 0);
                      return (
                        <tr key={`${trade.entry_date}-${index}`}>
                          <td className="mono" style={{ color: '#8b7db0' }}>{trade.entry_date || '—'}</td>
                          <td className="mono" style={{ color: '#8b7db0' }}>{trade.exit_date || '—'}</td>
                          <td>
                            <span className={`signal-badge ${(trade.side || 'BUY').toLowerCase()}`}>
                              {trade.side || 'BUY'}
                            </span>
                          </td>
                          <td className="mono">{formatCurrency(trade.entry_price)}</td>
                          <td className="mono">{formatCurrency(trade.exit_price)}</td>
                          <td className="mono">{trade.qty ?? trade.quantity ?? '—'}</td>
                          <td className={`mono ${pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : ''}`} style={{ fontWeight: 700 }}>
                            {pnl >= 0 ? '+' : ''}{formatCurrency(pnl)}
                          </td>
                          <td className={`mono ${pnlPct > 0 ? 'positive' : pnlPct < 0 ? 'negative' : ''}`} style={{ fontWeight: 700 }}>
                            {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </article>
          )}
        </section>
      )}
    </section>
  );
}
