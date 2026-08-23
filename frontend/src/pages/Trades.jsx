import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import CalendarHeatmap from '../components/CalendarHeatmap';

const DISPLAY_LIMIT = 15;

function getList(response) {
  return Array.isArray(response) ? response : (response?.results || []);
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatName(value) {
  return String(value || 'manual').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function Trades() {
  const [positions, setPositions] = useState([]);
  const [trades, setTrades] = useState([]);
  const [orders, setOrders] = useState([]);
  const [tab, setTab] = useState('positions'); // 'positions' | 'trades' | 'journal' | 'orders'
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [closingSymbol, setClosingSymbol] = useState(null);
  const [alertMessage, setAlertMessage] = useState('');
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);

  const fetchHistory = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const [posResult, tradeResult, orderResult] = await Promise.all([
        api.positions().catch(() => []),
        api.trades(),
        api.orders(),
      ]);
      const openPos = getList(posResult).filter((p) => p.is_open);
      setPositions(openPos);
      setTrades(getList(tradeResult));
      setOrders(getList(orderResult));
      // Default to 'trades' tab if no open positions exist
      if (openPos.length === 0 && tab === 'positions') {
        setTab('trades');
      }
      setError('');
    } catch {
      setError('Trade history could not be loaded. Confirm that the API server is running on port 8000.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tab]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

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
      setAlertMessage(`Closed position: ${pos.symbol} (${pos.quantity} shares).`);
      await fetchHistory({ silent: true });
    } catch (err) {
      setError(`Failed to close ${pos.symbol}: ${err.message}`);
    } finally {
      setClosingSymbol(null);
      setTimeout(() => setAlertMessage(''), 5000);
    }
  };

  const totalPnl = trades.reduce((total, trade) => total + Number(trade.pnl || 0), 0);
  const winningTrades = trades.filter((trade) => Number(trade.pnl || 0) > 0).length;
  const winRate = trades.length > 0 ? ((winningTrades / trades.length) * 100).toFixed(1) : '0.0';

  const activeRecords = tab === 'trades' ? trades : tab === 'orders' ? orders : positions;
  const visibleRecords = showAll ? activeRecords : activeRecords.slice(0, DISPLAY_LIMIT);

  const switchTab = (nextTab) => {
    setTab(nextTab);
    setShowAll(false);
  };

  if (loading && !trades.length && !positions.length) {
    return <div className="loading" style={{ padding: '3rem', textAlign: 'center' }}>Loading trading activity…</div>;
  }

  return (
    <section className="history-page">
      <header className="page-heading history-heading">
        <div>
          <h1>Book</h1>
          <p className="page-subtitle">Open lots, closed SELL rows, and the daily journal</p>
        </div>
        <button className="btn btn-outline" onClick={() => fetchHistory({ silent: true })} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {error && <div className="dashboard-alert" role="alert">{error}</div>}
      {alertMessage && (
        <div className="dashboard-alert success-alert" role="status" style={{ background: '#0a3820', borderColor: '#00e676', color: '#b9f6ca', padding: '12px 16px', borderRadius: '8px', marginBottom: '16px' }}>
          {alertMessage}
        </div>
      )}

      {/* Top Stat Summary Grid */}
      <div className="history-summary" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.25rem' }}>
        <article className="card history-stat">
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Active Holdings</span>
          <strong style={{ fontSize: '1.4rem', color: positions.length > 0 ? 'var(--green)' : 'var(--text-bright)' }}>
            {positions.length}
          </strong>
        </article>
        <article className="card history-stat">
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Completed Trades</span>
          <strong style={{ fontSize: '1.4rem', color: 'var(--text-bright)' }}>{trades.length}</strong>
        </article>
        <article className="card history-stat">
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Win Rate</span>
          <strong className="positive-text" style={{ fontSize: '1.4rem' }}>{winRate}% ({winningTrades}W)</strong>
        </article>
        <article className="card history-stat">
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Realized P&amp;L</span>
          <strong className={totalPnl >= 0 ? 'positive-text' : 'negative-text'} style={{ fontSize: '1.4rem' }}>
            {formatCurrency(totalPnl)}
          </strong>
        </article>
      </div>

      {/* Tab Navigation */}
      <div className="tabs history-tabs" role="tablist" aria-label="Trade activity tabs">
        <button
          className={`tab ${tab === 'positions' ? 'active' : ''}`}
          onClick={() => switchTab('positions')}
          role="tab"
          aria-selected={tab === 'positions'}
        >
          ⚡ Open Positions <span className="tab-badge">{positions.length}</span>
        </button>
        <button
          className={`tab ${tab === 'trades' ? 'active' : ''}`}
          onClick={() => switchTab('trades')}
          role="tab"
          aria-selected={tab === 'trades'}
        >
          📜 Trade Log <span className="tab-badge">{trades.length}</span>
        </button>
        <button
          className={`tab ${tab === 'journal' ? 'active' : ''}`}
          onClick={() => switchTab('journal')}
          role="tab"
          aria-selected={tab === 'journal'}
        >
          📅 Daily P&L Journal
        </button>
        <button
          className={`tab ${tab === 'orders' ? 'active' : ''}`}
          onClick={() => switchTab('orders')}
          role="tab"
          aria-selected={tab === 'orders'}
        >
          📋 Orders <span className="tab-badge">{orders.length}</span>
        </button>
      </div>

      {/* TAB CONTENT: Daily Journal */}
      {tab === 'journal' && <CalendarHeatmap />}

      {/* TAB CONTENT: Open Positions */}
      {tab === 'positions' && (
        <article className="card history-table-card">
          <div className="history-table-heading">
            <div>
              <h2>⚡ Active Open Positions & Live Tracking</h2>
              <p>{positions.length ? `Tracking ${positions.length} active market position${positions.length === 1 ? '' : 's'}.` : 'No open positions right now.'}</p>
            </div>
          </div>

          {!positions.length ? (
            <div className="history-empty-state">
              <strong>No open positions</strong>
              <p>Scan signals or activate AutoBot to open new trades.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="table history-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Side</th>
                    <th>Qty</th>
                    <th>Entry Price</th>
                    <th>Live CMP</th>
                    <th>Unrealized P&L</th>
                    <th>Stop Loss</th>
                    <th>Take Profit</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((pos) => {
                    const entry = Number(pos.entry_price || 0);
                    const cmp = Number(pos.current_price || entry);
                    const pnl = Number(pos.unrealized_pnl || 0);
                    const pnlPct = Number(pos.unrealized_pnl_pct || 0);
                    const isClosing = closingSymbol === pos.symbol;

                    const priceChange = cmp - entry;
                    const priceTone = priceChange > 0 ? 'var(--green)' : priceChange < 0 ? 'var(--red)' : 'var(--accent)';
                    const priceArrow = priceChange > 0 ? '▲' : priceChange < 0 ? '▼' : '';

                    const slDist = entry > 0 && pos.stop_loss ? (((cmp - Number(pos.stop_loss)) / cmp) * 100).toFixed(1) : null;
                    const tpDist = entry > 0 && pos.take_profit ? (((Number(pos.take_profit) - cmp) / cmp) * 100).toFixed(1) : null;

                    return (
                      <tr key={pos.id || pos.symbol}>
                        <td className="mono" style={{ fontWeight: 700, color: 'var(--text-bright)' }}>{pos.symbol}</td>
                        <td><span className={`signal-badge ${pos.side?.toLowerCase()}`}>{pos.side}</span></td>
                        <td className="mono">{pos.quantity}</td>
                        <td className="mono" style={{ color: 'var(--text-dim)' }}>₹{entry.toFixed(2)}</td>
                        <td className="mono" style={{ color: priceTone, fontWeight: 700 }}>
                          ₹{cmp.toFixed(2)} <small style={{ fontSize: '0.72rem' }}>{priceArrow}</small>
                        </td>
                        <td className={`mono pnl-value ${pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : ''}`} style={{ fontWeight: 700 }}>
                          {pnl >= 0 ? `+₹${pnl.toFixed(2)}` : `-₹${Math.abs(pnl).toFixed(2)}`} ({pnlPct >= 0 ? `+${pnlPct.toFixed(2)}` : pnlPct.toFixed(2)}%)
                        </td>
                        <td className="mono" style={{ color: 'var(--red)', fontSize: '0.82rem' }}>
                          ₹{Number(pos.stop_loss || 0).toFixed(2)}
                          {slDist && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{slDist}% buffer</div>}
                        </td>
                        <td className="mono" style={{ color: 'var(--green)', fontSize: '0.82rem' }}>
                          ₹{Number(pos.take_profit || 0).toFixed(2)}
                          {tpDist && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{tpDist}% target</div>}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => handleClosePosition(pos)}
                            disabled={isClosing}
                            style={{ padding: '0.28rem 0.75rem', fontSize: '0.74rem' }}
                          >
                            {isClosing ? 'Closing…' : '✕ Close'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </article>
      )}

      {/* TAB CONTENT: Completed Trades or Orders */}
      {(tab === 'trades' || tab === 'orders') && (
        <article className="card history-table-card">
          <div className="history-table-heading">
            <div>
              <h2>{tab === 'trades' ? 'Completed Trades' : 'Order Activity'}</h2>
              <p>{activeRecords.length ? `Showing ${visibleRecords.length} of ${activeRecords.length} most recent records.` : 'No records have been created yet.'}</p>
            </div>
          </div>

          {!activeRecords.length ? (
            <div className="history-empty-state">
              <strong>{tab === 'trades' ? 'No completed trades yet' : 'No orders yet'}</strong>
              <p>{tab === 'trades' ? 'Signals and paper executions will appear here once a position is closed.' : 'Paper orders will appear here after execution.'}</p>
            </div>
          ) : (
            <>
              <div className="table-scroll">
                {tab === 'trades' ? (
                  <table className="table history-table">
                    <thead>
                      <tr>
                        <th>Time / Date</th>
                        <th>Symbol</th>
                        <th>Side</th>
                        <th>Qty</th>
                        <th>Entry Price</th>
                        <th>Exit Price</th>
                        <th>Realized P&amp;L</th>
                        <th>Strategy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRecords.map((trade, index) => {
                        const pnl = Number(trade.pnl || 0);
                        const timeStr = trade.created_at ? new Date(trade.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : (trade.exit_date || '—');
                        return (
                          <tr key={trade.id || `${trade.symbol}-${trade.exit_date || index}`}>
                            <td className="mono" style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{timeStr}</td>
                            <td className="mono" style={{ fontWeight: 600, color: 'var(--text-bright)' }}>{trade.symbol || '—'}</td>
                            <td><span className={`signal-badge ${(trade.side || '').toLowerCase()}`}>{trade.side || '—'}</span></td>
                            <td className="mono">{trade.quantity ?? trade.qty ?? '—'}</td>
                            <td className="mono">{formatCurrency(trade.entry_price)}</td>
                            <td className="mono">{formatCurrency(trade.exit_price)}</td>
                            <td className={`mono pnl-value ${pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : ''}`} style={{ fontWeight: 700 }}>
                              {formatCurrency(pnl)}
                            </td>
                            <td>{formatName(trade.strategy)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <table className="table history-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Order ID</th>
                        <th>Symbol</th>
                        <th>Side</th>
                        <th>Qty</th>
                        <th>Price</th>
                        <th>Status</th>
                        <th>Mode</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRecords.map((order, index) => {
                        const timeStr = order.created_at ? new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
                        return (
                          <tr key={order.id || `${order.symbol}-${index}`}>
                            <td className="mono" style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{timeStr}</td>
                            <td className="mono" style={{ fontSize: '0.76rem', color: 'var(--accent)' }}>{order.broker_order_id || `ORD-${order.id}`}</td>
                            <td className="mono" style={{ fontWeight: 600, color: 'var(--text-bright)' }}>{order.symbol || '—'}</td>
                            <td><span className={`signal-badge ${(order.side || '').toLowerCase()}`}>{order.side || '—'}</span></td>
                            <td className="mono">{order.quantity ?? '—'}</td>
                            <td className="mono">{formatCurrency(order.price)}</td>
                            <td><span className={`status-badge ${(order.status || '').toLowerCase()}`}>{order.status || '—'}</span></td>
                            <td>{formatName(order.mode)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
              {activeRecords.length > DISPLAY_LIMIT && (
                <button className="history-show-more" onClick={() => setShowAll((current) => !current)}>
                  {showAll ? 'Show latest 15' : `Show all ${activeRecords.length} records`}
                </button>
              )}
            </>
          )}
        </article>
      )}
    </section>
  );
}
