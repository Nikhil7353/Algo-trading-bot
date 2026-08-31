import { useState, useEffect } from 'react';
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

const QUICK_STOCKS = [
  { sym: 'RELIANCE', sector: 'Energy & Retail' },
  { sym: 'SBIN', sector: 'Public Banking' },
  { sym: 'TCS', sector: 'IT Services' },
  { sym: 'INFY', sector: 'Tech & Cloud' },
  { sym: 'ITC', sector: 'FMCG & Hotels' },
  { sym: 'TATAMOTORS', sector: 'Automotive & EV' },
];

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
  const [activeStrategies, setActiveStrategies] = useState([]);
  const [availableStrategies, setAvailableStrategies] = useState([]);

  useEffect(() => {
    api.strategies()
      .then((data) => {
        const active = data?.active || [];
        setActiveStrategies(active);
        setAvailableStrategies(data?.available || active);
      })
      .catch(() => {});
  }, []);

  // Trade Execution Dialog state
  const [tradeDialog, setTradeDialog] = useState(null);
  const [quantity, setQuantity] = useState(DEFAULT_QUANTITY);
  const [executing, setExecuting] = useState(false);
  const [tradeResult, setTradeResult] = useState(null);

  const scan = async (event, stockToScan) => {
    event?.preventDefault();
    const requestedSymbol = (stockToScan || symbol || '').trim().toUpperCase();
    if (!requestedSymbol) {
      setError('Please enter a stock symbol (e.g. RELIANCE, SBIN, TCS) or select one of the quick stock chips.');
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
      const orderId = response?.order_id || 'ORD';
      setTradeResult({
        ok: true,
        message: `${side} order for ${qty} share(s) of ${tradeDialog.symbol} @ ${formatPrice(price)} submitted successfully (ID: ${orderId}).`,
      });
    } catch (tradeError) {
      setTradeResult({
        ok: false,
        message: tradeError?.message || 'Execution failed. Confirm backend trading server is active.',
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
      {/* Header */}
      <header className="page-heading signals-heading">
        <div>
          <h1>Scanner</h1>
          <p className="page-subtitle">Multi-Strategy Breakout Scanner & Live Technical Charts</p>
        </div>
        <div className="header-chips">
          <span className="chip mode-chip">
            <i className="mode-pulse" /> Live Market Feed
          </span>
          <span className="chip">
            {activeStrategies.length} Strategies Active
          </span>
        </div>
      </header>

      {/* Sleek Active Strategy Engine Ribbon */}
      <div className="strategy-engine-ribbon">
        <div className="ribbon-left">
          <span className="engine-pulse-dot" />
          <strong className="engine-title">Active Strategy Engine:</strong>
          <div className="strategy-tags-list">
            {activeStrategies.map((s) => (
              <span key={s} className="active-strat-tag">{formatStrategy(s)}</span>
            ))}
          </div>
        </div>
        <button type="button" className="btn-link-settings" onClick={() => navigate('/settings')}>
          Configure in Controls ↗
        </button>
      </div>

      {/* Mode Switcher Tabs */}
      <div className="scanner-tabs-row">
        <div className="tabs">
          <button
            type="button"
            className={`tab ${activeTab === 'single' ? 'active' : ''}`}
            onClick={() => setActiveTab('single')}
          >
            📊 Single Symbol Chart & Scanner
          </button>
          <button
            type="button"
            className={`tab ${activeTab === 'screener' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('screener');
              if (screenerResults.length === 0) runScreener();
            }}
          >
            ⚡ Multi-Stock Watchlist Screener
          </button>
        </div>
      </div>

      {/* TAB 1: SINGLE SYMBOL SCANNER */}
      {activeTab === 'single' && (
        <>
          <article className="card scanner-search-card">
            <form className="scanner-form" onSubmit={scan}>
              <div className="search-input-wrapper">
                <svg className="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  id="symbol"
                  className="scanner-main-input"
                  value={symbol}
                  onChange={(event) => setSymbol(event.target.value.toUpperCase())}
                  placeholder="Enter NSE Symbol (e.g. RELIANCE, TCS, SBIN, INFY, ITC, TATAMOTORS)"
                  autoComplete="off"
                  spellCheck="false"
                />
                <button className="btn btn-primary scan-submit-btn" type="submit" disabled={loading}>
                  {loading ? (
                    <>
                      <span className="spinner-sm" /> Scanning…
                    </>
                  ) : (
                    '⚡ Scan Stock'
                  )}
                </button>
              </div>

              {/* Quick Stock Chips with Sectors */}
              <div className="quick-symbol-chips-grid">
                <span className="chips-label">Quick Scan:</span>
                {QUICK_STOCKS.map((s) => (
                  <button
                    key={s.sym}
                    type="button"
                    className={`stock-chip-btn ${symbol === s.sym ? 'active' : ''}`}
                    onClick={(e) => {
                      setSymbol(s.sym);
                      scan(e, s.sym);
                    }}
                  >
                    <strong>{s.sym}</strong>
                    <span className="chip-sector">{s.sector}</span>
                  </button>
                ))}
              </div>
            </form>
          </article>

          {error && (
            <div className="scanner-error" role="alert">
              <div>
                <strong>Scan Notice</strong>
                <p>{error}</p>
              </div>
              <button className="btn btn-outline btn-sm" onClick={scan} disabled={loading}>
                Try again
              </button>
            </div>
          )}

          {/* Interactive Candlestick Chart when candles exist */}
          {scanned && candles.length > 0 && (
            <article className="card scanner-chart-card">
              <div className="chart-header-actions">
                <div className="chart-title-box">
                  <h2>{scannedSymbol} Live TradingView Chart</h2>
                  <span className="cmp-badge">
                    LTP: <strong className="mono">₹{candles[candles.length - 1]?.close?.toFixed(2) || '0.00'}</strong>
                  </span>
                </div>
                <div className="chart-quick-trade-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() =>
                      openTradeDialog({
                        symbol: scannedSymbol,
                        action: 'BUY',
                        price: candles[candles.length - 1]?.close || 100,
                        strategy: 'discretionary_buy',
                      })
                    }
                  >
                    🟢 Quick BUY {scannedSymbol}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() =>
                      openTradeDialog({
                        symbol: scannedSymbol,
                        action: 'SELL',
                        price: candles[candles.length - 1]?.close || 100,
                        strategy: 'discretionary_sell',
                      })
                    }
                  >
                    🔴 Quick SELL {scannedSymbol}
                  </button>
                </div>
              </div>
              <CandlestickChart data={candles} symbol={scannedSymbol} height={340} />
            </article>
          )}

          {/* Signals Results */}
          {scanned && (
            <section className="signal-results-section">
              <div className="results-heading">
                <div>
                  <h2>Breakout & Indicator Signals</h2>
                  <p>{scannedSymbol} · Evaluated against {activeStrategies.length} active strategies</p>
                </div>
                <span className="results-count">
                  {signals.length ? `⚡ ${signals.length} Signal${signals.length === 1 ? '' : 's'} Triggered` : 'No Active Breakout (Consolidating)'}
                </span>
              </div>

              {!signals.length ? (
                <article className="card scanner-empty-state compact-empty">
                  <div className="empty-chart-icon">⚖️</div>
                  <h2>No Breakout Signal (Market Consolidating)</h2>
                  <p>Neither EMA crossover, RSI reversal, nor Supertrend triggered a trade setup on {scannedSymbol}. Price is within normal volatility bands.</p>
                  <div className="empty-manual-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() =>
                        openTradeDialog({
                          symbol: scannedSymbol,
                          action: 'BUY',
                          price: candles[candles.length - 1]?.close || 100,
                          strategy: 'manual_entry',
                        })
                      }
                    >
                      🟢 Place Manual BUY Order
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() =>
                        openTradeDialog({
                          symbol: scannedSymbol,
                          action: 'SELL',
                          price: candles[candles.length - 1]?.close || 100,
                          strategy: 'manual_entry',
                        })
                      }
                    >
                      🔴 Place Manual SELL Order
                    </button>
                  </div>
                </article>
              ) : (
                <div className="signal-results-grid">
                  {signals.map((sig, index) => {
                    const action = String(sig.action || sig.side || 'HOLD').toUpperCase();
                    const tone = action === 'BUY' ? 'buy' : action === 'SELL' ? 'sell' : 'hold';
                    const confidence = Math.round(Number(sig.strength || 0.85) * 100);

                    return (
                      <article key={`${sig.strategy}-${index}`} className={`card signal-result-card ${tone}`}>
                        <div className="signal-card-topline">
                          <span className={`signal-badge ${tone}`}>{action}</span>
                          <span className="signal-symbol">{scannedSymbol}</span>
                        </div>
                        <h3>{formatStrategy(sig.strategy)}</h3>
                        <p className="signal-price">{formatPrice(sig.price)}</p>

                        <div className="signal-meta-row">
                          <div className="confidence-meter-box">
                            <span className="meter-label">Confidence: {confidence}%</span>
                            <div className="confidence-bar">
                              <i style={{ width: `${confidence}%`, background: action === 'BUY' ? '#4ade80' : '#fb7185' }} />
                            </div>
                          </div>
                          <span className="bar-timestamp">{sig.date ? String(sig.date).split('T')[0] : 'Latest Bar'}</span>
                        </div>

                        {sig.explanation && (
                          <div className="ai-rationale-box">
                            <span className="ai-tag">✨ AI RATIONALE</span>
                            <p>{sig.explanation}</p>
                          </div>
                        )}

                        <div className="signal-actions-row">
                          <button
                            type="button"
                            className={`btn ${action === 'BUY' ? 'btn-primary' : 'btn-danger'} signal-trade-btn`}
                            onClick={() => openTradeDialog(sig)}
                          >
                            ⚡ 1-Click {action} Execution
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* Empty State / Watchlist Radar */}
          {!scanned && !loading && (
            <article className="card scanner-radar-hub">
              <div className="radar-header">
                <div>
                  <h2>⚡ Watchlist Radar & Top Movers</h2>
                  <p>Click any instrument below for instant technical breakout analysis & live charts</p>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    setActiveTab('screener');
                    runScreener();
                  }}
                >
                  ⚡ Scan Entire Watchlist (6 Stocks)
                </button>
              </div>

              <div className="radar-grid">
                {QUICK_STOCKS.map((stk) => (
                  <div
                    key={stk.sym}
                    className="radar-stock-card"
                    onClick={(e) => {
                      setSymbol(stk.sym);
                      scan(e, stk.sym);
                    }}
                  >
                    <div className="radar-card-top">
                      <strong className="radar-sym">{stk.sym}</strong>
                      <span className="radar-chip-sec">{stk.sector}</span>
                    </div>
                    <div className="radar-card-action">
                      <span>Click to scan breakout ↗</span>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          )}
        </>
      )}

      {/* TAB 2: MULTI-STOCK WATCHLIST SCREENER */}
      {activeTab === 'screener' && (
        <article className="card screener-table-card">
          <div className="screener-table-header">
            <div>
              <h2>Nifty Watchlist Screener</h2>
              <p>Concurrent multi-strategy scan across all 6 core equities.</p>
            </div>
            <button className="btn btn-primary btn-sm" onClick={runScreener} disabled={screenerLoading}>
              {screenerLoading ? 'Scanning Watchlist…' : '🔄 Refresh Screener'}
            </button>
          </div>

          {screenerError && (
            <div className="dashboard-alert" style={{ margin: '1rem 1.5rem' }}>{screenerError}</div>
          )}

          <div className="table-scroll">
            <table className="table screener-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Last Price</th>
                  <th>Breakout Signal</th>
                  <th>Triggering Strategy</th>
                  <th>Confidence</th>
                  <th style={{ textAlign: 'right' }}>Quick Execution</th>
                </tr>
              </thead>
              <tbody>
                {screenerLoading ? (
                  <tr>
                    <td colSpan="6" style={{ textAlign: 'center', padding: '2.5rem' }}>
                      <span className="spinner-sm" /> Scanning all watchlist instruments concurrently…
                    </td>
                  </tr>
                ) : screenerResults.length > 0 ? (
                  screenerResults.map((row) => {
                    const primarySignal = row.signals && row.signals.length > 0 ? row.signals[0] : null;
                    const action = primarySignal ? String(primarySignal.action || primarySignal.side || 'HOLD').toUpperCase() : 'HOLD';
                    const tone = action === 'BUY' ? 'buy' : action === 'SELL' ? 'sell' : 'hold';
                    const price = row.price || primarySignal?.price || 0;

                    return (
                      <tr key={row.symbol}>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <strong className="mono" style={{ color: '#ffffff', fontSize: '0.95rem' }}>{row.symbol}</strong>
                            <span style={{ fontSize: '0.7rem', color: '#8b7db0' }}>NSE Equity</span>
                          </div>
                        </td>
                        <td className="mono" style={{ fontWeight: 700, color: '#f7f4ff' }}>
                          {formatPrice(price)}
                        </td>
                        <td>
                          <span className={`signal-badge ${tone}`}>{action}</span>
                        </td>
                        <td>
                          {primarySignal ? formatStrategy(primarySignal.strategy) : <span style={{ color: '#8b7db0' }}>Consolidating</span>}
                        </td>
                        <td>
                          {primarySignal ? (
                            <span style={{ color: '#4ade80', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                              {Math.round(Number(primarySignal.strength || 0.85) * 100)}%
                            </span>
                          ) : (
                            <span style={{ color: '#8b7db0' }}>—</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '6px' }}>
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              onClick={() => {
                                setSymbol(row.symbol);
                                setActiveTab('single');
                                scan(null, row.symbol);
                              }}
                            >
                              📊 Chart
                            </button>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() =>
                                openTradeDialog({
                                  symbol: row.symbol,
                                  action: 'BUY',
                                  price,
                                  strategy: primarySignal?.strategy || 'screener_buy',
                                })
                              }
                            >
                              BUY
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              onClick={() =>
                                openTradeDialog({
                                  symbol: row.symbol,
                                  action: 'SELL',
                                  price,
                                  strategy: primarySignal?.strategy || 'screener_sell',
                                })
                              }
                            >
                              SELL
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan="6" style={{ textAlign: 'center', padding: '2rem', color: '#8b7db0' }}>
                      Click "Refresh Screener" to run a scan across all active watchlist equities.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      )}

      {/* Trade Execution Modal Dialog */}
      {tradeDialog && (
        <div className="trade-modal-backdrop" onClick={closeTradeDialog}>
          <div className="trade-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>⚡ 1-Click Order Execution</h2>
                <p>Submit simulated order to Paper Portfolio</p>
              </div>
              <button type="button" className="modal-close-btn" onClick={closeTradeDialog}>✕</button>
            </div>

            <div className="modal-body">
              <div className="order-summary-box">
                <div className="summary-row">
                  <span>Instrument:</span>
                  <strong className="mono">{tradeDialog.symbol} (NSE)</strong>
                </div>
                <div className="summary-row">
                  <span>Order Action:</span>
                  <span className={`signal-badge ${dialogSide.toLowerCase()}`}>{dialogSide}</span>
                </div>
                <div className="summary-row">
                  <span>Execution CMP:</span>
                  <strong className="mono">{formatPrice(dialogPrice)}</strong>
                </div>
              </div>

              <div className="form-group" style={{ marginTop: '12px' }}>
                <label style={{ fontSize: '0.78rem', color: '#8b7db0', fontWeight: 650 }}>ORDER QUANTITY (SHARES)</label>
                <div className="qty-stepper-row">
                  <button type="button" className="qty-step-btn" onClick={() => setQuantity(Math.max(1, quantity - 1))}>−</button>
                  <input
                    type="number"
                    min="1"
                    className="input qty-input mono"
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
                  />
                  <button type="button" className="qty-step-btn" onClick={() => setQuantity(quantity + 1)}>+</button>
                </div>
                <div className="quick-qty-chips">
                  {[1, 5, 10, 25, 50].map((q) => (
                    <button
                      key={q}
                      type="button"
                      className={`chip-sm ${quantity === q ? 'active' : ''}`}
                      onClick={() => setQuantity(q)}
                    >
                      {q} sh
                    </button>
                  ))}
                </div>
              </div>

              <div className="estimated-cost-box">
                <span>Estimated Required Margin:</span>
                <strong className="mono">{formatPrice(estimatedTotal)}</strong>
              </div>

              {tradeResult && (
                <div className={`dashboard-alert ${tradeResult.ok ? 'success-alert' : 'danger-alert'}`} style={{ marginTop: '12px' }}>
                  {tradeResult.message}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={closeTradeDialog}>
                Cancel
              </button>
              <button
                type="button"
                className={`btn ${dialogSide === 'BUY' ? 'btn-primary' : 'btn-danger'}`}
                onClick={confirmTrade}
                disabled={executing}
              >
                {executing ? 'Executing Order…' : `Confirm Paper ${dialogSide}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
