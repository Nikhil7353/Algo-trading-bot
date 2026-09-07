import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';

export default function AutoTraderWidget({ compact = false }) {
  const [status, setStatus] = useState({
    is_running: false,
    scan_interval: 60,
    trades_executed_today: 0,
    active_positions_count: 0,
    logs: [],
    last_scan_time: null,
  });
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState('');

  const fetchStatus = useCallback(async () => {
    try {
      const res = await api.getAutoTraderStatus();
      setStatus(res);
      setError('');
    } catch {
      // ignore transient poll error
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleToggle = async () => {
    setToggling(true);
    try {
      const action = status.is_running ? 'stop' : 'start';
      const res = await api.toggleAutoTrader({ action });
      if (res.state) {
        setStatus(res.state);
      }
    } catch (err) {
      setError(`Failed to toggle: ${err.message}`);
    } finally {
      setToggling(false);
    }
  };

  if (compact) {
    return (
      <button
        type="button"
        className="autotrader-compact-pill"
        onClick={handleToggle}
        aria-label={`Auto-Trader is ${status.is_running ? 'running' : 'stopped'}. Click to ${status.is_running ? 'stop' : 'start'}.`}
        aria-pressed={status.is_running}
        title="Click to toggle Auto-Trading Bot"
      >
        <span className={`autotrader-dot ${status.is_running ? 'running' : 'stopped'}`} />
        <span style={{ fontWeight: 600, fontSize: '0.74rem' }}>
          AutoBot: {status.is_running ? 'ACTIVE' : 'OFF'}
        </span>
      </button>
    );
  }

  return (
    <article className="card autotrader-card">
      <div className="panel-heading">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <div className={`autotrader-indicator ${status.is_running ? 'running' : 'stopped'}`}>
            <span className="pulse-ring" />
            <span className="dot" />
          </div>
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              🤖 Autonomous Auto-Trader Daemon
              <span className={`badge ${status.is_running ? 'badge-success' : 'badge-idle'}`} style={{ fontSize: '0.68rem', padding: '0.15rem 0.5rem' }}>
                {status.is_running ? 'RUNNING' : 'STOPPED'}
              </span>
            </h2>
            <p>Scans watchlist every {status.scan_interval}s, auto-executes breakouts, and trails stop-losses.</p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            className={`btn ${status.is_running ? 'btn-danger' : 'btn-primary'}`}
            onClick={handleToggle}
            disabled={toggling}
            style={{ minWidth: 140, fontWeight: 700 }}
          >
            {toggling ? 'Updating…' : status.is_running ? '⏹ Stop AutoBot' : '▶ Start Auto-Trading'}
          </button>
        </div>
      </div>

      {error && <div className="dashboard-alert" style={{ marginTop: '0.75rem' }}>{error}</div>}

      <div className="autotrader-metrics-row">
        <div className="autotrader-metric">
          <span className="metric-label">TRADES TODAY</span>
          <strong className="metric-val">{status.trades_executed_today}</strong>
        </div>
        <div className="autotrader-metric">
          <span className="metric-label">ACTIVE POSITIONS</span>
          <strong className="metric-val">{status.active_positions_count}</strong>
        </div>
        <div className="autotrader-metric">
          <span className="metric-label">SCAN INTERVAL</span>
          <strong className="metric-val">{status.scan_interval}s</strong>
        </div>
        <div className="autotrader-metric">
          <span className="metric-label">LAST SCAN</span>
          <strong className="metric-val" style={{ fontSize: '0.85rem' }}>{status.last_scan_time ? status.last_scan_time.split(' ')[1] : 'Waiting…'}</strong>
        </div>
      </div>

      <div className="autotrader-terminal-box">
        <div className="terminal-header">
          <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: '0.72rem', letterSpacing: '0.08em' }}>● LIVE AUTOBOT DECISION STREAM</span>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>Auto-refreshes live</span>
        </div>
        <div className="terminal-body">
          {status.logs && status.logs.length > 0 ? (
            status.logs.slice(0, 8).map((log, idx) => (
              <div key={`${log.timestamp}-${idx}`} className={`terminal-log-line ${log.level}`}>
                <span className="log-time">[{log.timestamp}]</span>
                <span className="log-msg">{log.message}</span>
              </div>
            ))
          ) : (
            <div className="terminal-empty">Auto-Trader is idle. Click "Start Auto-Trading" to begin automated scanning & execution.</div>
          )}
        </div>
      </div>
    </article>
  );
}
