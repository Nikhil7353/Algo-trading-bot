import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import CalendarHeatmap from '../components/CalendarHeatmap';
import { formatCurrency } from '../utils.js';

const DISPLAY_LIMIT = 20;

function getList(response) {
  return Array.isArray(response) ? response : (response?.results || []);
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

  const exportToCSV = () => {
    if (tab === 'orders') {
      const headers = ['Time', 'Order ID', 'Symbol', 'Side', 'Quantity', 'Price', 'Status', 'Mode'];
      const rows = orders.map((o) => [
        o.created_at || '',
        o.order_id || '',
        o.symbol || '',
        o.side || '',
        o.quantity || '',
        o.price || '',
        o.status || '',
        o.is_paper ? 'Paper' : 'Live',
      ]);
      const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `stockbot_orders_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      const headers = ['Time', 'Symbol', 'Side', 'Quantity', 'Entry Price', 'Exit Price', 'Realized PnL', 'Strategy'];
      const rows = trades.map((t) => [
        t.exit_time || t.created_at || '',
        t.symbol || '',
        t.side || '',
        t.quantity || '',
        t.entry_price || '',
        t.exit_price || '',
        t.pnl || '',
        t.strategy || '',
      ]);
      const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `stockbot_trades_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const totalPnl = trades.reduce((total, trade) => total + Number(trade.pnl || 0), 0);
  const winningTrades = trades.filter((trade) => Number(trade.pnl || 0) > 0).length;
  const losingTrades = trades.filter((trade) => Number(trade.pnl || 0) < 0).length;
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
          <h1>Trade Book</h1>
          <p className="page-subtitle">Executed trades, daily P&amp;L journal, and live order records</p>
        </div>
        <div className="header-chips">
          <button
            type="button"
            className="chip refresh-chip"
            onClick={exportToCSV}
            title="Download CSV report for taxation and analysis"
          >
            📥 Export CSV
          </button>
          <button
            type="button"
            className="chip refresh-chip"
            onClick={() => fetchHistory({ silent: true })}
            disabled={refreshing}
          >
            {refreshing ? 'Syncing…' : '🔄 Refresh'}
          </button>
        </div>
      </header>

      {error && <div className="dashboard-alert" role="alert">{error}</div>}
      {alertMessage && (
        <div className="dashboard-alert success-alert" role="status" style={{ background: '#0a3820', borderColor: '#00e676', color: '#b9f6ca', padding: '12px 16px', borderRadius: '8px', marginBottom: '16px' }}>
          {alertMessage}
        </div>
      )}

      {/* Top Stat Summary Grid with Glowing Top Borders */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '10px', marginBottom: '14px' }}>
        <article className="card stat-card stat-card-default">
          <span className="stat-label">Active Holdings</span>
          <strong className="stat-value">{positions.length} Lots</strong>
          <span className="stat-detail">{positions.length === 0 ? 'No Open Risk' : 'In Market'}</span>
        </article>
        <article className="card stat-card stat-card-default">
          <span className="stat-label">Completed Trades</span>
          <strong className="stat-value">{trades.length} Closed</strong>
          <span className="stat-detail">{orders.length} Total Orders</span>
        </article>
        <article className={`card stat-card ${Number(winRate) > 50 ? 'stat-card-positive' : 'stat-card-default'}`}>
          <span className="stat-label">Win Rate</span>
          <strong className="stat-value">{winRate}%</strong>
          <span className="stat-detail">{winningTrades}W · {losingTrades}L</span>
        </article>
        <article className={`card stat-card ${totalPnl > 0 ? 'stat-card-positive' : totalPnl < 0 ? 'stat-card-negative' : 'stat-card-default'}`}>
          <span className="stat-label">Realized P&amp;L</span>
          <strong className={`stat-value ${totalPnl > 0 ? 'positive' : totalPnl < 0 ? 'negative' : ''}`}>
            {totalPnl >= 0 ? '+' : ''}{formatCurrency(totalPnl)}
          </strong>
          <span className="stat-detail">Net Session Closed Return</span>
        </article>
      </div>

      {/* Tab Navigation */}
      <div className="tabs history-tabs" role="tablist" aria-label="Trade activity tabs" style={{ marginBottom: '14px' }}>
        <button
          type="button"
          className={`tab ${tab === 'positions' ? 'active' : ''}`}
          onClick={() => switchTab('positions')}
        >
          ⚡ Open Positions <span className="tab-badge">{positions.length}</span>
        </button>
        <button
          type="button"
          className={`tab ${tab === 'trades' ? 'active' : ''}`}
          onClick={() => switchTab('trades')}
        >
          📜 Trade Log <span className="tab-badge">{trades.length}</span>
        </button>
        <button
          type="button"
          className={`tab ${tab === 'journal' ? 'active' : ''}`}
          onClick={() => switchTab('journal')}
        >
          📅 Daily P&amp;L Journal
        </button>
        <button
          type="button"
          className={`tab ${tab === 'orders' ? 'active' : ''}`}
          onClick={() => switchTab('orders')}
        >
          📋 Orders <span className="tab-badge">{orders.length}</span>
        </button>
      </div>

      {/* TAB CONTENT: Daily Journal */}
      {tab === 'journal' && <CalendarHeatmap />}

      {/* TAB CONTENT: Open Positions */}
      {tab === 'positions' && (
        <article className="card history-table-card">
          <div className="history-table-heading" style={{ padding: '14px 18px' }}>
            <div>
              <h2>⚡ Active Open Positions &amp; Live Tracking</h2>
              <p>{positions.length ? `Tracking ${positions.length} active market position${positions.length === 1 ? '' : 's'}.` : 'No open positions right now.'}</p>
            </div>
          </div>

          {!positions.length ? (
            <div className="history-empty-state">
              <div style={{ fontSize: '2rem', marginBottom: '6px' }}>💼</div>
              <strong>No open positions</strong>
              <p>Scan signals or activate AutoBot to open new automated trades.</p>
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
                    <th>Current LTP</th>
                    <th>Stop Loss</th>
                    <th>Take Profit</th>
                    <th>Unrealized P&amp;L</th>
                    <th style={{ textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((pos) => {
                    const pnl = Number(pos.unrealized_pnl || 0);
                    const isClosing = closingSymbol === pos.symbol;
                    return (
                      <tr key={pos.id || pos.symbol}>
                        <td className="mono" style={{ fontWeight: 700, color: '#ffffff' }}>{pos.symbol}</td>
                        <td><span className={`signal-badge ${String(pos.side).toLowerCase()}`}>{pos.side}</span></td>
                        <td className="mono">{pos.quantity}</td>
                        <td className="mono">{formatCurrency(pos.entry_price)}</td>
                        <td className="mono" style={{ color: 'var(--accent)' }}>{formatCurrency(pos.current_price || pos.entry_price)}</td>
                        <td className="mono" style={{ color: '#fb7185' }}>{Number(pos.stop_loss || 0).toFixed(2)}</td>
                        <td className="mono" style={{ color: '#4ade80' }}>{Number(pos.take_profit || 0).toFixed(2)}</td>
                        <td className={`mono ${pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : ''}`} style={{ fontWeight: 700 }}>
                          {pnl >= 0 ? '+' : ''}{formatCurrency(pnl)}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => handleClosePosition(pos)}
                            disabled={isClosing}
                          >
                            {isClosing ? 'Closing…' : 'Square Off'}
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

      {/* TAB CONTENT: Completed Trades */}
      {tab === 'trades' && (
        <article className="card history-table-card">
          <div className="history-table-heading" style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2>Completed Trade Log</h2>
              <p>Showing {visibleRecords.length} of {trades.length} closed trade records.</p>
            </div>
          </div>

          {!trades.length ? (
            <div className="history-empty-state">
              <div style={{ fontSize: '2rem', marginBottom: '6px' }}>📜</div>
              <strong>No completed trades yet</strong>
              <p>Positions will appear here once squared off or exited.</p>
            </div>
          ) : (
            <div className="table-scroll">
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
                  {visibleRecords.map((trade, idx) => {
                    const pnl = Number(trade.pnl || 0);
                    const timeStr = trade.exit_time || trade.created_at ? String(trade.exit_time || trade.created_at).slice(11, 16) : '—';
                    return (
                      <tr key={trade.id || idx}>
                        <td className="mono" style={{ color: '#8b7db0' }}>{timeStr}</td>
                        <td className="mono" style={{ fontWeight: 700, color: '#ffffff' }}>{trade.symbol}</td>
                        <td><span className={`signal-badge ${String(trade.side).toLowerCase()}`}>{trade.side}</span></td>
                        <td className="mono">{trade.quantity}</td>
                        <td className="mono">{formatCurrency(trade.entry_price)}</td>
                        <td className="mono">{formatCurrency(trade.exit_price)}</td>
                        <td className={`mono ${pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : ''}`} style={{ fontWeight: 700 }}>
                          {pnl >= 0 ? '+' : ''}{formatCurrency(pnl)}
                        </td>
                        <td style={{ color: '#b3a6d4' }}>{formatName(trade.strategy)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {trades.length > DISPLAY_LIMIT && (
            <button
              type="button"
              className="history-show-more"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? 'Show Fewer Records' : `View All ${trades.length} Completed Trades`}
            </button>
          )}
        </article>
      )}

      {/* TAB CONTENT: Orders */}
      {tab === 'orders' && (
        <article className="card history-table-card">
          <div className="history-table-heading" style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2>Order Activity Ledger</h2>
              <p>Showing {visibleRecords.length} of {orders.length} order requests.</p>
            </div>
          </div>

          {!orders.length ? (
            <div className="history-empty-state">
              <div style={{ fontSize: '2rem', marginBottom: '6px' }}>📋</div>
              <strong>No orders found</strong>
              <p>Submitted orders will appear in this ledger.</p>
            </div>
          ) : (
            <div className="table-scroll">
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
                  {visibleRecords.map((order, idx) => {
                    const timeStr = order.created_at ? String(order.created_at).slice(11, 19) : '—';
                    const isFilled = String(order.status).toUpperCase() === 'EXECUTED' || String(order.status).toUpperCase() === 'COMPLETE';
                    return (
                      <tr key={order.order_id || idx}>
                        <td className="mono" style={{ color: '#8b7db0' }}>{timeStr}</td>
                        <td className="mono" style={{ fontSize: '0.8rem', color: '#c4b5fd' }}>{order.order_id || 'ORD'}</td>
                        <td className="mono" style={{ fontWeight: 700, color: '#ffffff' }}>{order.symbol}</td>
                        <td><span className={`signal-badge ${String(order.side).toLowerCase()}`}>{order.side}</span></td>
                        <td className="mono">{order.quantity}</td>
                        <td className="mono">{formatCurrency(order.price)}</td>
                        <td>
                          <span className={`badge ${isFilled ? 'badge-success' : 'badge-idle'}`} style={{ fontSize: '0.72rem' }}>
                            {order.status}
                          </span>
                        </td>
                        <td style={{ color: '#8b7db0', fontSize: '0.8rem' }}>{order.is_paper ? 'Paper' : 'Live'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {orders.length > DISPLAY_LIMIT && (
            <button
              type="button"
              className="history-show-more"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? 'Show Fewer Records' : `View All ${orders.length} Orders`}
            </button>
          )}
        </article>
      )}
    </section>
  );
}
