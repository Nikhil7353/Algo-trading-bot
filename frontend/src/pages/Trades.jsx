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
  const [trades, setTrades] = useState([]);
  const [orders, setOrders] = useState([]);
  const [tab, setTab] = useState('trades');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);

  const fetchHistory = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const [tradeResult, orderResult] = await Promise.all([api.trades(), api.orders()]);
      setTrades(getList(tradeResult));
      setOrders(getList(orderResult));
      setError('');
    } catch {
      setError('Trade history could not be loaded. Confirm that the API server is running on port 8000.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const totalPnl = trades.reduce((total, trade) => total + Number(trade.pnl || 0), 0);
  const winningTrades = trades.filter((trade) => Number(trade.pnl || 0) > 0).length;
  const activeRecords = tab === 'trades' ? trades : orders;
  const visibleRecords = showAll ? activeRecords : activeRecords.slice(0, DISPLAY_LIMIT);

  const switchTab = (nextTab) => {
    setTab(nextTab);
    setShowAll(false);
  };

  if (loading) return <div className="loading">Loading trade history…</div>;

  return (
    <section className="history-page">
      <header className="page-heading history-heading">
        <div>
          <span className="eyebrow">Paper trading activity</span>
          <h1>Trade history</h1>
          <p className="page-subtitle">Review completed trades, daily P&L calendar journal, and every submitted paper order.</p>
        </div>
        <button className="btn btn-outline" onClick={() => fetchHistory({ silent: true })} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {error && <div className="dashboard-alert" role="alert">{error}</div>}

      <div className="history-summary">
        <article className="card history-stat"><span>Completed trades</span><strong>{trades.length}</strong></article>
        <article className="card history-stat"><span>Winning trades</span><strong className="positive-text">{winningTrades}</strong></article>
        <article className="card history-stat"><span>Recorded P&amp;L</span><strong className={totalPnl >= 0 ? 'positive-text' : 'negative-text'}>{formatCurrency(totalPnl)}</strong></article>
      </div>

      <div className="tabs history-tabs" role="tablist" aria-label="Trade history">
        <button className={`tab ${tab === 'trades' ? 'active' : ''}`} onClick={() => switchTab('trades')} role="tab" aria-selected={tab === 'trades'}>Trade log <span className="tab-badge">{trades.length}</span></button>
        <button className={`tab ${tab === 'journal' ? 'active' : ''}`} onClick={() => switchTab('journal')} role="tab" aria-selected={tab === 'journal'}>📅 Daily P&L Journal</button>
        <button className={`tab ${tab === 'orders' ? 'active' : ''}`} onClick={() => switchTab('orders')} role="tab" aria-selected={tab === 'orders'}>Orders <span className="tab-badge">{orders.length}</span></button>
      </div>

      {tab === 'journal' ? (
        <CalendarHeatmap />
      ) : (
        <article className="card history-table-card">
          <div className="history-table-heading">
            <div><h2>{tab === 'trades' ? 'Completed trades' : 'Order activity'}</h2><p>{activeRecords.length ? `Showing ${visibleRecords.length} of ${activeRecords.length} most recent records.` : 'No records have been created yet.'}</p></div>
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
                    <thead><tr><th>Symbol</th><th>Side</th><th>Qty</th><th>Entry</th><th>Exit</th><th>P&amp;L</th><th>Strategy</th></tr></thead>
                    <tbody>{visibleRecords.map((trade, index) => {
                      const pnl = Number(trade.pnl || 0);
                      return <tr key={trade.id || `${trade.symbol}-${trade.exit_date || index}`}><td className="mono">{trade.symbol || '—'}</td><td><span className={`signal-badge ${(trade.side || '').toLowerCase()}`}>{trade.side || '—'}</span></td><td className="mono">{trade.quantity ?? trade.qty ?? '—'}</td><td className="mono">{formatCurrency(trade.entry_price)}</td><td className="mono">{formatCurrency(trade.exit_price)}</td><td className={`mono pnl-value ${pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : ''}`}>{formatCurrency(pnl)}</td><td>{formatName(trade.strategy)}</td></tr>;
                    })}</tbody>
                  </table>
                ) : (
                  <table className="table history-table">
                    <thead><tr><th>Symbol</th><th>Side</th><th>Qty</th><th>Price</th><th>Status</th><th>Mode</th></tr></thead>
                    <tbody>{visibleRecords.map((order, index) => <tr key={order.id || `${order.symbol}-${index}`}><td className="mono">{order.symbol || '—'}</td><td><span className={`signal-badge ${(order.side || '').toLowerCase()}`}>{order.side || '—'}</span></td><td className="mono">{order.quantity ?? '—'}</td><td className="mono">{formatCurrency(order.price)}</td><td><span className={`status-badge ${(order.status || '').toLowerCase()}`}>{order.status || '—'}</span></td><td>{formatName(order.mode)}</td></tr>)}</tbody>
                  </table>
                )}
              </div>
              {activeRecords.length > DISPLAY_LIMIT && <button className="history-show-more" onClick={() => setShowAll((current) => !current)}>{showAll ? 'Show latest 15' : `Show all ${activeRecords.length} records`}</button>}
            </>
          )}
        </article>
      )}
    </section>
  );
}
