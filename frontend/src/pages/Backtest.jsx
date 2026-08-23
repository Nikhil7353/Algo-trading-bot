import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { api } from '../api';

function formatCurrency(value) {
  const amount = Number(value || 0);
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatStrategy(value) {
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function Metric({ label, value, tone = '' }) {
  return <article className="card backtest-metric"><span>{label}</span><strong className={tone}>{value}</strong></article>;
}

export default function Backtest() {
  const [symbol, setSymbol] = useState('');
  const [strategies, setStrategies] = useState(['ema_crossover']);
  const [capital, setCapital] = useState(5000);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState([]);
  const [error, setError] = useState('');

  const quickStocks = ['RELIANCE', 'SBIN', 'ITC', 'INFY', 'TCS', 'TATAMOTORS'];

  useEffect(() => {
    api.strategies().then((response) => setAvailable(response?.available || [])).catch(() => setError('Strategies could not be loaded. Confirm that the API server is running.'));
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
    setStrategies((current) => current.includes(strategy) ? current.filter((item) => item !== strategy) : [...current, strategy]);
  };

  const totalPnl = Number(result?.total_pnl || 0);
  const totalReturn = Number(result?.total_return_pct || 0);
  const chartData = result?.equity_curve || [];

  return (
    <section className="backtest-page">
      <header className="page-heading backtest-heading">
        <div>
          <span className="eyebrow">Historical simulation</span>
          <h1>Backtest</h1>
          <p className="page-subtitle">Test a strategy on historical data before acting on a live signal.</p>
        </div>
        <div className="mode-pill">
          <span className="mode-pulse"></span>
          <span>Simulation Only (No real orders)</span>
        </div>
      </header>

      <div className="backtest-workspace">
        <article className="card backtest-config-card">
          <div className="panel-heading"><div><h2>Test configuration</h2><p>Choose the symbol, initial capital, and strategies to evaluate.</p></div></div>
          <div className="backtest-input-grid">
            <div className="form-group">
              <label>Stock Symbol</label>
              <input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} className="input" placeholder="e.g. RELIANCE, SBIN, TCS" />
              <div className="quick-symbol-chips">
                {quickStocks.map((s) => (
                  <button key={s} type="button" className={`chip-sm ${symbol === s ? 'active' : ''}`} onClick={() => setSymbol(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="form-group">
              <label>Initial Capital (₹)</label>
              <input type="number" min="1" value={capital} onChange={(event) => setCapital(event.target.value)} className="input" />
            </div>
          </div>
          <div className="strategy-picker">
            <div className="strategy-picker-heading"><span>Strategies</span><small>{strategies.length} selected</small></div>
            <div className="strategy-toggles">
              {available.map((strategy) => (
                <button
                  key={strategy}
                  type="button"
                  className={`btn btn-sm ${strategies.includes(strategy) ? 'btn-active' : 'btn-inactive'}`}
                  onClick={() => toggleStrategy(strategy)}
                >
                  {formatStrategy(strategy)}
                </button>
              ))}
            </div>
            {!available.length && !error && <p className="muted-copy">Loading available strategies…</p>}
          </div>
          <div className="backtest-action-row">
            <p>Results use 2-year historical data with slippage and brokerage.</p>
            <button onClick={handleRun} disabled={loading || !strategies.length} className="btn btn-primary">
              {loading ? 'Running simulation…' : 'Run backtest'}
            </button>
          </div>
        </article>

        <aside className="card backtest-tips-card">
          <span className="eyebrow">Before you run</span>
          <h2>Keep tests comparable</h2>
          <ul>
            <li>Use the same capital for fair strategy comparisons.</li>
            <li>Try one strategy first, then combine them.</li>
            <li>Review drawdown as well as total return.</li>
          </ul>
        </aside>
      </div>

      {error && <div className="dashboard-alert backtest-alert" role="alert">{error}</div>}

      {!result && !loading && !error && (
        <article className="card backtest-pending-state">
          <div className="empty-chart-icon">📊</div>
          <strong>Ready for a historical test</strong>
          <p>Configure your inputs above, then run the simulation to see performance metrics, equity chart, and trade details.</p>
        </article>
      )}

      {result && (
        <section className="backtest-results-section">
          <div className="results-heading"><div><h2>Backtest results</h2><p>{(symbol || 'RELIANCE').trim().toUpperCase()} · {strategies.length} selected {strategies.length === 1 ? 'strategy' : 'strategies'}</p></div><span className="results-count">Simulation complete</span></div>
          <div className="backtest-stats-grid">
            <Metric label="Total trades" value={result.total_trades || 0} />
            <Metric label="Win / loss" value={`${result.wins || 0} / ${result.losses || 0}`} />
            <Metric label="Win rate" value={`${Number(result.win_rate || 0).toFixed(1)}%`} />
            <Metric label="Total P&L" value={formatCurrency(totalPnl)} tone={totalPnl >= 0 ? 'positive-text' : 'negative-text'} />
            <Metric label="Return" value={`${totalReturn.toFixed(2)}%`} tone={totalReturn >= 0 ? 'positive-text' : 'negative-text'} />
            <Metric label="Max drawdown" value={`${Number(result.max_drawdown_pct || 0).toFixed(2)}%`} tone="negative-text" />
          </div>

          {chartData.length > 1 && <article className="card backtest-chart-card"><div className="panel-heading"><div><h2>Equity curve</h2><p>Portfolio value across the test period.</p></div></div><ResponsiveContainer width="100%" height={300}><LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 2 }}><XAxis dataKey="date" tick={{ fill: '#8990b0', fontSize: 11 }} minTickGap={36} /><YAxis tick={{ fill: '#8990b0', fontSize: 11 }} domain={['auto', 'auto']} width={62} /><Tooltip contentStyle={{ background: '#0c0e20', border: '1px solid #31375a', borderRadius: 6 }} formatter={(value) => formatCurrency(value)} /><ReferenceLine y={result.initial_capital} stroke="#596080" strokeDasharray="4 4" /><Line type="monotone" dataKey="equity" stroke="#00d4ff" strokeWidth={2.5} dot={false} /></LineChart></ResponsiveContainer></article>}

          {result.trades?.length > 0 && <article className="card backtest-trades-card"><div className="panel-heading"><div><h2>Trade details</h2><p>{result.trades.length} simulated trade{result.trades.length === 1 ? '' : 's'}.</p></div></div><div className="table-scroll"><table className="table history-table"><thead><tr><th>Entry date</th><th>Exit date</th><th>Side</th><th>Entry</th><th>Exit</th><th>Qty</th><th>P&amp;L</th><th>P&amp;L %</th></tr></thead><tbody>{result.trades.map((trade, index) => { const pnl = Number(trade.pnl || 0); const pnlPct = Number(trade.pnl_pct || 0); return <tr key={`${trade.entry_date}-${index}`}><td className="mono">{trade.entry_date || '—'}</td><td className="mono">{trade.exit_date || '—'}</td><td><span className={`signal-badge ${(trade.side || '').toLowerCase()}`}>{trade.side || '—'}</span></td><td className="mono">{formatCurrency(trade.entry_price)}</td><td className="mono">{formatCurrency(trade.exit_price)}</td><td className="mono">{trade.qty ?? trade.quantity ?? '—'}</td><td className={`mono pnl-value ${pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : ''}`}>{formatCurrency(pnl)}</td><td className={`mono pnl-value ${pnlPct > 0 ? 'positive' : pnlPct < 0 ? 'negative' : ''}`}>{pnlPct.toFixed(2)}%</td></tr>; })}</tbody></table></div></article>}
        </section>
      )}
    </section>
  );
}
