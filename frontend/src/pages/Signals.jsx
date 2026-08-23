import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import CandlestickChart from '../components/CandlestickChart';

function formatPrice(value) {
  const price = Number(value);
  if (!Number.isFinite(price)) return '—';
  return `₹${price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatStrategy(value) {
  if (!value) return 'Strategy';
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getScanErrorMessage(scanError) {
  const message = scanError?.message || '';
  if (message.includes('503')) {
    return 'Scanner access is not ready yet. Restart the Django server so it loads STOCKBOT_API_KEY, then try again.';
  }
  if (message.includes('401')) {
    return 'Scanner key mismatch. Check STOCKBOT_API_KEY in backend and frontend.';
  }
  return 'Unable to scan right now. Confirm that the API server is running on port 8000.';
}

const DEFAULT_QUANTITY = 1;

export default function Signals() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('single'); // 'single' | 'screener'

  // Single Scanner state
  const [symbol, setSymbol] = useState('');
  const [scannedSymbol, setScannedSymbol] = useState('');
  const [signals, setSignals] = useState([]);
  const [candles, setCandles] = useState([]);
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Screener state
  const [screenerResults, setScreenerResults] = useState([]);
  const [screenerLoading, setScreenerLoading] = useState(false);
  const [screenerError, setScreenerError] = useState('');

  const quickStocks = ['RELIANCE', 'SBIN', 'ITC', 'INFY', 'TCS', 'TATAMOTORS'];

  // Trade Execution Dialog state
  const [tradeDialog, setTradeDialog] = useState(null);
  const [quantity, setQuantity] = useState(DEFAULT_QUANTITY);
  const [executing, setExecuting] = useState(false);
  const [tradeResult, setTradeResult] = useState(null);

  const scan = async (event, stockToScan) => {
    event?.preventDefault();
    const requestedSymbol = (stockToScan || symbol || '').trim().toUpperCase();
    if (!requestedSymbol) {
      setError('Please enter a stock symbol (e.g. RELIANCE, SBIN, TCS) or click one of the quick stock chips below.');
      return;
    }
    if (stockToScan) setSymbol(stockToScan);
    setScannedSymbol(requestedSymbol);

    setLoading(true);
    setError('');
    try {
      const response = await api.scan(requestedSymbol);
      const items = Array.isArray(response) ? response : [response];
      const foundSignals = items.flatMap((item) => (item?.signals || []).map((s) => ({ ...s, symbol: s.symbol || item.symbol })));
      const foundCandles = items[0]?.candles || [];

      setSignals(foundSignals);
      setCandles(foundCandles);
      setScanned(true);
    } catch (scanError) {
      setSignals([]);
      setCandles([]);
      setScanned(true);
      setError(getScanErrorMessage(scanError));
    } finally {
      setLoading(false);
    }
  };

  const runScreener = async () => {
    setScreenerLoading(true);
    setScreenerError('');
    try {
      const results = await api.scanWatchlist();
      setScreenerResults(results || []);
    } catch (err) {
      setScreenerError(err.message || 'Watchlist scan failed. Confirm server is running.');
    } finally {
      setScreenerLoading(false);
    }
  };

  const openTradeDialog = (signal) => {
    setTradeDialog(signal);
    setQuantity(DEFAULT_QUANTITY);
    setTradeResult(null);
  };

  const closeTradeDialog = () => {
    setTradeDialog(null);
    setQuantity(DEFAULT_QUANTITY);
    setTradeResult(null);
  };

  const confirmTrade = async () => {
    if (!tradeDialog) return;
    const side = String(tradeDialog.side || tradeDialog.signal || tradeDialog.action || '').toUpperCase();
    const price = Number(tradeDialog.price || tradeDialog.current_price || tradeDialog.close);
    const qty = Number(quantity);

    if (!side || !price || !qty) {
      setTradeResult({ ok: false, message: 'Missing order details. Check signal and try again.' });
      return;
    }

    setExecuting(true);
    setTradeResult(null);

    try {
      const response = await api.execute({ symbol: tradeDialog.symbol, side, quantity: qty, price });
      const orderId = response?.order_id || 'ORDER';
      setTradeResult({
        ok: true,
        message: `${side} order for ${qty} share(s) of ${tradeDialog.symbol} @ ${formatPrice(price)} submitted successfully (ID: ${orderId}).`,
      });
    } catch (tradeError) {
      setTradeResult({
        ok: false,
        message: tradeError?.message?.includes('400')
          ? 'Risk Manager blocked this order. Check capital allocation or daily loss limits.'
          : 'Execution failed. Confirm backend trading server is active.',
      });
    } finally {
      setExecuting(false);
    }
  };

  const dialogSide = tradeDialog ? String(tradeDialog.side || tradeDialog.signal || tradeDialog.action || '').toUpperCase() : '';
  const dialogPrice = tradeDialog ? Number(tradeDialog.price || tradeDialog.current_price || tradeDialog.close) : 0;
  const estimatedTotal = Number(quantity) * (Number.isFinite(dialogPrice) ? dialogPrice : 0);

  return (
    <section className="signals-page">
      <header className="page-heading signals-heading">
        <div>
          <span className="eyebrow">MARKET RESEARCH & SCANNER</span>
          <h1>Signals & Screener</h1>
          <p className="page-subtitle">Scan individual NSE stocks or screen your entire Nifty watchlist for momentum breakouts.</p>
        </div>
        <div className="mode-pill">
          <span className="mode-pulse"></span>
          <span>Paper Trading Active</span>
        </div>
      </header>

      {/* Mode Switcher Tabs */}
      <div className="tabs" style={{ marginBottom: '1.25rem' }}>
        <button
          className={`tab ${activeTab === 'single' ? 'active' : ''}`}
          onClick={() => setActiveTab('single')}
        >
          Single Symbol Scanner
        </button>
        <button
          className={`tab ${activeTab === 'screener' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('screener');
            if (screenerResults.length === 0) runScreener();
          }}
        >
          🔍 Watchlist Screener
        </button>
      </div>

      {/* TAB 1: SINGLE SYMBOL SCANNER */}
      {activeTab === 'single' && (
        <>
          <article className="card scanner-card">
            <form className="scanner-form" onSubmit={scan}>
              <label htmlFor="symbol">Stock symbol</label>
              <div className="scan-bar">
                <input
                  id="symbol"
                  className="input"
                  value={symbol}
                  onChange={(event) => setSymbol(event.target.value.toUpperCase())}
                  placeholder="e.g. RELIANCE, SBIN, TCS, INFY"
                  autoComplete="off"
                  spellCheck="false"
                />
                <button className="btn btn-primary" type="submit" disabled={loading}>
                  {loading ? 'Scanning…' : 'Scan symbol'}
                </button>
              </div>
              <div className="quick-symbol-chips" style={{ marginTop: '0.65rem' }}>
                {quickStocks.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`chip-sm ${symbol === s ? 'active' : ''}`}
                    onClick={(e) => {
                      setSymbol(s);
                      scan(e, s);
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </form>
          </article>

          {error && (
            <div className="scanner-error" role="alert" style={{ marginTop: '1rem' }}>
              <div>
                <strong>Scan unavailable</strong>
                <p>{error}</p>
              </div>
              <button className="btn btn-outline btn-sm" onClick={scan} disabled={loading}>
                Try again
              </button>
            </div>
          )}

          {/* Interactive Candlestick Chart when candles exist */}
          {scanned && candles.length > 0 && (
            <article className="card" style={{ marginTop: '1.25rem', padding: '1.25rem' }}>
              <CandlestickChart data={candles} symbol={scannedSymbol} height={340} />
            </article>
          )}

          {/* Signals Results */}
          {scanned && (
            <section className="signal-results-section">
              <div className="results-heading">
                <div>
                  <h2>Scanner Results</h2>
                  <p>{scannedSymbol} · {signals.length} active strategy signal{signals.length === 1 ? '' : 's'}</p>
                </div>
                <span className="results-count">
                  {signals.length ? `${signals.length} signal${signals.length === 1 ? '' : 's'} found` : 'No active breakout'}
                </span>
              </div>

              {!signals.length ? (
                <article className="card scanner-empty-state compact-empty">
                  <div className="empty-chart-icon">⚖️</div>
                  <h2>No Trade Signal (HOLD)</h2>
                  <p>Neither EMA crossover, RSI reversal, nor Supertrend triggered on {scannedSymbol}. Market is consolidating.</p>
                </article>
              ) : (
                <div className="signal-results-grid">
                  {signals.map((sig, index) => {
                    const action = String(sig.action || sig.side || 'HOLD').toUpperCase();
                    const tone = action === 'BUY' ? 'buy' : action === 'SELL' ? 'sell' : 'hold';
                    return (
                      <article key={`${sig.strategy}-${index}`} className={`card signal-result-card ${tone}`}>
                        <div className="signal-card-topline">
                          <span className={`signal-badge ${tone}`}>{action}</span>
                          <span className="signal-symbol">{scannedSymbol}</span>
                        </div>
                        <h3>{formatStrategy(sig.strategy)}</h3>
                        <p className="signal-price">{formatPrice(sig.price)}</p>
                        <div className="signal-meta">
                          <span>Confidence: <strong>{Number(sig.strength || 0.8) * 100}%</strong></span>
                          <span>{sig.date ? String(sig.date).split('T')[0] : 'Latest Bar'}</span>
                        </div>
                        {sig.explanation && (
                          <div
                            style={{
                              margin: '0.65rem 0',
                              padding: '0.55rem 0.75rem',
                              background: 'rgba(99, 102, 241, 0.08)',
                              border: '1px solid rgba(99, 102, 241, 0.2)',
                              borderRadius: '6px',
                              fontSize: '0.78rem',
                              color: 'var(--text-bright)',
                              lineHeight: 1.4,
                            }}
                          >
                            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#818cf8', display: 'flex', alignItems: 'center', gap: '0.25rem', marginBottom: '0.15rem' }}>
                              ✨ AI RATIONALE
                            </span>
                            {sig.explanation}
                          </div>
                        )}
                        {action !== 'HOLD' && (
                          <button
                            type="button"
                            className={`btn ${action === 'BUY' ? 'btn-primary' : 'btn-danger'} signal-trade-btn`}
                            onClick={() => openTradeDialog(sig)}
                          >
                            Execute Paper {action}
                          </button>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {!scanned && !loading && (
            <article className="card scanner-empty-state">
              <div className="empty-chart-icon">⚡</div>
              <h2>Ready to scan</h2>
              <p>Enter a symbol or click any stock chip above to see live candlestick charts, EMA lines, and strategy breakout signals.</p>
              <div className="scanner-steps">
                <span>1. Real-time OHLCV Data</span>
                <span>2. Multi-Strategy Analytics</span>
                <span>3. 1-Click Paper Execution</span>
              </div>
            </article>
          )}
        </>
      )}

      {/* TAB 2: MULTI-STOCK WATCHLIST SCREENER */}
      {activeTab === 'screener' && (
        <article className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
            <div>
              <h2>Nifty Watchlist Screener</h2>
              <p className="muted-copy">Real-time scan across all active watchlist equities.</p>
            </div>
            <button className="btn btn-primary btn-sm" onClick={runScreener} disabled={screenerLoading}>
              {screenerLoading ? 'Scanning Watchlist…' : '🔄 Refresh Screener'}
            </button>
          </div>

          {screenerError && (
            <div className="dashboard-alert" style={{ margin: '1rem 1.5rem' }}>{screenerError}</div>
          )}

          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>LTP (₹)</th>
                  <th>24h Change</th>
                  <th>Signal</th>
                  <th>Strategy</th>
                  <th>Confidence</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {screenerLoading ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-dim)' }}>
                      Scanning watchlist stocks against EMA Crossover, RSI, Supertrend, and VWAP…
                    </td>
                  </tr>
                ) : !screenerResults.length ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-dim)' }}>
                      No screener records available. Click 'Refresh Screener' to scan.
                    </td>
                  </tr>
                ) : (
                  screenerResults.map((item) => {
                    const signal = String(item.signal || 'HOLD').toUpperCase();
                    const isBuy = signal === 'BUY';
                    const isSell = signal === 'SELL';
                    return (
                      <tr key={item.symbol}>
                        <td><strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{item.symbol}</strong></td>
                        <td className="mono" style={{ color: 'var(--accent)' }}>{formatPrice(item.price)}</td>
                        <td className={`mono ${item.change_pct >= 0 ? 'positive-text' : 'negative-text'}`}>
                          {item.change_pct >= 0 ? `+${item.change_pct}%` : `${item.change_pct}%`}
                        </td>
                        <td>
                          <span className={`signal-badge ${isBuy ? 'buy' : isSell ? 'sell' : 'pending'}`}>
                            {signal}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{formatStrategy(item.strategy)}</td>
                        <td className="mono" style={{ fontSize: '0.82rem' }}>{item.confidence ? `${item.confidence}%` : '—'}</td>
                        <td>
                          {isBuy || isSell ? (
                            <button
                              className={`btn btn-sm ${isBuy ? 'btn-primary' : 'btn-danger'}`}
                              onClick={() => openTradeDialog({ symbol: item.symbol, action: signal, price: item.price, strategy: item.strategy })}
                            >
                              Trade
                            </button>
                          ) : (
                            <button
                              className="btn btn-outline btn-sm"
                              onClick={() => {
                                setSymbol(item.symbol);
                                setActiveTab('single');
                                scan(null, item.symbol);
                              }}
                            >
                              Chart
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </article>
      )}

      {/* Trade Execution Modal Dialog */}
      {tradeDialog && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-panel">
            <div className="modal-header">
              <h2>Confirm Paper Trade</h2>
              <button className="modal-close" onClick={closeTradeDialog} aria-label="Close dialog">×</button>
            </div>

            <div className="modal-body">
              <div className={`modal-signal-preview ${dialogSide.toLowerCase()}`}>
                <div className="modal-signal-topline">
                  <span className={`signal-badge ${dialogSide.toLowerCase()}`}>{dialogSide}</span>
                  <strong className="modal-signal-symbol">{tradeDialog.symbol}</strong>
                </div>
                <div className="modal-signal-strategy">{formatStrategy(tradeDialog.strategy || tradeDialog.strategy_name)}</div>
                <div className="modal-signal-price">{formatPrice(dialogPrice)}</div>
              </div>

              {!tradeResult && (
                <>
                  <div className="modal-field">
                    <label htmlFor="order-qty">Quantity (Shares)</label>
                    <input
                      id="order-qty"
                      type="number"
                      min="1"
                      className="input"
                      value={quantity}
                      onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      disabled={executing}
                    />
                  </div>

                  <div className="modal-summary">
                    <span>Estimated Total:</span>
                    <strong>{formatPrice(estimatedTotal)}</strong>
                  </div>
                </>
              )}

              {tradeResult && (
                <div className="modal-result">
                  <div className={`modal-result-icon ${tradeResult.ok ? 'success' : 'error'}`}>
                    {tradeResult.ok ? '✓' : '!'}
                  </div>
                  <p className="modal-result-msg">{tradeResult.message}</p>
                </div>
              )}
            </div>

            <div className="modal-footer">
              {!tradeResult ? (
                <>
                  <button className="btn btn-outline" onClick={closeTradeDialog} disabled={executing}>Cancel</button>
                  <button className={`btn ${dialogSide === 'BUY' ? 'btn-primary' : 'btn-danger'}`} onClick={confirmTrade} disabled={executing}>
                    {executing ? 'Placing…' : `Confirm ${dialogSide}`}
                  </button>
                </>
              ) : (
                <>
                  <button className="btn btn-outline" onClick={closeTradeDialog}>Close</button>
                  {tradeResult.ok && (
                    <button className="btn btn-primary" onClick={() => { closeTradeDialog(); navigate('/trades'); }}>
                      View in Trades
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
