import { useState, useEffect } from 'react';
import { api } from '../api';

const ALL_STRATEGIES = [
  { id: 'ema_crossover', name: 'EMA Crossover (9 / 21)', desc: 'Fast/Slow Exponential Moving Average trend crossover with RSI filter' },
  { id: 'rsi_reversal', name: 'RSI Reversal (14)', desc: 'Mean reversion strategy buying oversold (<30) and selling overbought (>70)' },
  { id: 'bollinger_breakout', name: 'Bollinger Breakout (20, 2)', desc: 'Volatility band breakout strategy during high momentum expansions' },
  { id: 'supertrend', name: 'Supertrend (10, 3)', desc: 'ATR-based trailing stop momentum indicator favored by Indian equity traders' },
  { id: 'vwap', name: 'VWAP + RSI Momentum', desc: 'Volume Weighted Average Price crossover with institutional flow confirmation' },
];

export default function Settings() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState({ type: '', text: '' });

  // Form states
  const [capital, setCapital] = useState(5000);
  const [maxPositionPct, setMaxPositionPct] = useState(25.0);
  const [maxDailyLossPct, setMaxDailyLossPct] = useState(2.0);
  const [maxOpenPositions, setMaxOpenPositions] = useState(2);
  const [stopLossPct, setStopLossPct] = useState(2.0);
  const [takeProfitPct, setTakeProfitPct] = useState(4.0);
  const [trailingStopLossPct, setTrailingStopLossPct] = useState(1.0);
  const [activeStrategies, setActiveStrategies] = useState(['ema_crossover']);
  const [watchlist, setWatchlist] = useState(['RELIANCE', 'SBIN', 'ITC', 'INFY', 'TCS', 'TATAMOTORS']);
  const [newSymbol, setNewSymbol] = useState('');

  // Telegram states
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [testingTelegram, setTestingTelegram] = useState(false);
  const [telegramStatus, setTelegramStatus] = useState('');

  // WhatsApp states
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [whatsappApiKey, setWhatsappApiKey] = useState('');
  const [testingWhatsapp, setTestingWhatsapp] = useState(false);
  const [whatsappStatus, setWhatsappStatus] = useState('');

  useEffect(() => {
    api.getSettings()
      .then((data) => {
        setConfig(data);
        if (data.risk) {
          setCapital(data.risk.capital ?? 5000);
          setMaxPositionPct(data.risk.max_position_pct ?? 25.0);
          setMaxDailyLossPct(data.risk.max_daily_loss_pct ?? 2.0);
          setMaxOpenPositions(data.risk.max_open_positions ?? 2);
          setStopLossPct(data.risk.stop_loss_pct ?? 2.0);
          setTakeProfitPct(data.risk.take_profit_pct ?? 4.0);
          setTrailingStopLossPct(data.risk.trailing_stop_loss_pct ?? 1.0);
        }
        if (data.strategies) {
          setActiveStrategies(data.strategies.active || ['ema_crossover']);
          setWatchlist(data.strategies.watchlist || ['RELIANCE', 'SBIN', 'ITC', 'INFY', 'TCS', 'TATAMOTORS']);
        }
        if (data.telegram) {
          setTelegramEnabled(Boolean(data.telegram.enabled));
          setTelegramToken(data.telegram.bot_token || '');
          setTelegramChatId(data.telegram.chat_id || '');
        }
        if (data.whatsapp) {
          setWhatsappEnabled(Boolean(data.whatsapp.enabled));
          setWhatsappPhone(data.whatsapp.phone || '');
          setWhatsappApiKey(data.whatsapp.api_key || '');
        }
      })
      .catch(() => setStatusMsg({ type: 'error', text: 'Could not load current settings from API server.' }))
      .finally(() => setLoading(false));
  }, []);

  const handleToggleStrategy = (stratId) => {
    setActiveStrategies((prev) =>
      prev.includes(stratId) ? prev.filter((id) => id !== stratId) : [...prev, stratId]
    );
  };

  const handleAddSymbol = (e) => {
    e.preventDefault();
    const sym = newSymbol.trim().toUpperCase();
    if (sym && !watchlist.includes(sym)) {
      setWatchlist([...watchlist, sym]);
      setNewSymbol('');
    }
  };

  const handleRemoveSymbol = (sym) => {
    setWatchlist(watchlist.filter((s) => s !== sym));
  };

  const handleSave = async () => {
    setSaving(true);
    setStatusMsg({ type: '', text: '' });

    const payload = {
      ...(config || {}),
      risk: {
        ...(config?.risk || {}),
        capital: Number(capital),
        max_position_pct: Number(maxPositionPct),
        max_daily_loss_pct: Number(maxDailyLossPct),
        max_open_positions: Number(maxOpenPositions),
        stop_loss_pct: Number(stopLossPct),
        take_profit_pct: Number(takeProfitPct),
        trailing_stop_loss_pct: Number(trailingStopLossPct),
      },
      strategies: {
        ...(config?.strategies || {}),
        active: activeStrategies,
        available: ALL_STRATEGIES.map((s) => s.id),
        watchlist: watchlist,
      },
      telegram: {
        enabled: telegramEnabled,
        bot_token: telegramToken.trim(),
        chat_id: telegramChatId.trim(),
      },
      whatsapp: {
        enabled: whatsappEnabled,
        phone: whatsappPhone.trim().replace('+', '').replace(/\s+/g, ''),
        api_key: whatsappApiKey.trim(),
      },
    };

    try {
      await api.updateSettings(payload);
      setStatusMsg({ type: 'success', text: 'Settings successfully saved and active!' });
    } catch {
      setStatusMsg({ type: 'error', text: 'Failed to save settings. Confirm API server is running.' });
    } finally {
      setSaving(false);
    }
  };

  const handleTestTelegram = async () => {
    if (!telegramToken.trim() || !telegramChatId.trim()) {
      setTelegramStatus('Please enter both Bot Token and Chat ID before testing.');
      return;
    }
    setTestingTelegram(true);
    setTelegramStatus('');
    try {
      const res = await api.testTelegram({ bot_token: telegramToken, chat_id: telegramChatId });
      setTelegramStatus(`✅ ${res.message || 'Test message sent to Telegram!'}`);
    } catch (err) {
      setTelegramStatus(`❌ Test failed: ${err.message || 'Check credentials'}`);
    } finally {
      setTestingTelegram(false);
    }
  };

  const handleTestWhatsApp = async () => {
    if (!whatsappPhone.trim() || !whatsappApiKey.trim()) {
      setWhatsappStatus('Enter Phone number with country code (e.g. 919876543210) and API Key.');
      return;
    }
    setTestingWhatsapp(true);
    setWhatsappStatus('');
    try {
      const res = await api.testWhatsApp({ phone: whatsappPhone, api_key: whatsappApiKey });
      setWhatsappStatus(`✅ ${res.message || 'Test message sent to your WhatsApp!'}`);
    } catch (err) {
      setWhatsappStatus(`❌ Test failed: ${err.message || 'Check phone or key'}`);
    } finally {
      setTestingWhatsapp(false);
    }
  };

  if (loading) {
    return (
      <div className="main">
        <p className="muted-copy">Loading configuration settings…</p>
      </div>
    );
  }

  return (
    <section className="settings-page" style={{ width: '100%' }}>
      <header className="page-heading">
        <div>
          <span className="eyebrow">SYSTEM CONFIGURATION</span>
          <h1>Settings</h1>
          <p className="page-subtitle">Manage trading capital, risk parameters, active strategies, Telegram & WhatsApp notifications.</p>
        </div>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving changes…' : 'Save Configuration'}
        </button>
      </header>

      {statusMsg.text && (
        <div className={`dashboard-alert ${statusMsg.type === 'error' ? '' : 'alert-success'}`} style={{ marginBottom: '1.5rem', background: statusMsg.type === 'error' ? 'rgba(255, 51, 102, 0.15)' : 'rgba(0, 230, 118, 0.15)', borderColor: statusMsg.type === 'error' ? 'var(--red)' : 'var(--green)', color: '#fff' }}>
          {statusMsg.text}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
        {/* 1. Capital & Risk Sizing */}
        <article className="card">
          <div className="panel-heading">
            <div>
              <h2>💰 Capital & Risk Sizing</h2>
              <p>Position sizing and account loss limits.</p>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="form-group">
              <label>Trading Capital (₹)</label>
              <input type="number" min="500" step="500" value={capital} onChange={(e) => setCapital(e.target.value)} className="input" />
              <small className="muted-copy" style={{ fontSize: '0.75rem', marginTop: '0.25rem', display: 'block' }}>Max ₹{(capital * (maxPositionPct / 100)).toFixed(0)} allocated per trade.</small>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div className="form-group">
                <label>Max Position %</label>
                <input type="number" min="1" max="100" step="1" value={maxPositionPct} onChange={(e) => setMaxPositionPct(e.target.value)} className="input" />
              </div>
              <div className="form-group">
                <label>Daily Loss Limit %</label>
                <input type="number" min="0.5" max="10" step="0.5" value={maxDailyLossPct} onChange={(e) => setMaxDailyLossPct(e.target.value)} className="input" />
              </div>
            </div>

            <div className="form-group">
              <label>Max Concurrent Open Trades</label>
              <input type="number" min="1" max="10" value={maxOpenPositions} onChange={(e) => setMaxOpenPositions(e.target.value)} className="input" />
            </div>
          </div>
        </article>

        {/* 2. Target & Stop-Loss */}
        <article className="card">
          <div className="panel-heading">
            <div>
              <h2>🎯 Target & Stop-Loss Rules</h2>
              <p>Automated profit-taking and loss prevention.</p>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div className="form-group">
                <label>Stop-Loss %</label>
                <input type="number" min="0.5" max="10" step="0.1" value={stopLossPct} onChange={(e) => setStopLossPct(e.target.value)} className="input" />
              </div>
              <div className="form-group">
                <label>Take-Profit %</label>
                <input type="number" min="0.5" max="20" step="0.1" value={takeProfitPct} onChange={(e) => setTakeProfitPct(e.target.value)} className="input" />
              </div>
            </div>

            <div className="form-group">
              <label>🛡️ Trailing Stop-Loss Trigger %</label>
              <input type="number" min="0.2" max="10" step="0.1" value={trailingStopLossPct} onChange={(e) => setTrailingStopLossPct(e.target.value)} className="input" />
              <small className="muted-copy" style={{ fontSize: '0.74rem', marginTop: '0.25rem', display: 'block' }}>
                When profit passes this %, stop-loss trails upward dynamically to lock in profit.
              </small>
            </div>

            <div style={{ padding: '0.85rem', background: 'var(--surface2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                <span>Risk-to-Reward Ratio:</span>
                <strong style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>1 : {(takeProfitPct / (stopLossPct || 1)).toFixed(1)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Square-off time:</span>
                <strong style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>15:15 IST (Auto EOD)</strong>
              </div>
            </div>
          </div>
        </article>
      </div>

      {/* 3. Active Strategies */}
      <article className="card" style={{ marginTop: '1.25rem' }}>
        <div className="panel-heading">
          <div>
            <h2>📈 Active Strategies ({activeStrategies.length} selected)</h2>
            <p>Select which algorithms evaluate stocks during market scans.</p>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.85rem' }}>
          {ALL_STRATEGIES.map((strat) => {
            const isActive = activeStrategies.includes(strat.id);
            return (
              <div
                key={strat.id}
                onClick={() => handleToggleStrategy(strat.id)}
                style={{
                  padding: '1rem',
                  borderRadius: 'var(--radius-md)',
                  border: `1px solid ${isActive ? 'rgba(0, 212, 255, 0.4)' : 'var(--border)'}`,
                  background: isActive ? 'rgba(0, 212, 255, 0.06)' : 'var(--surface2)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: '0.92rem', color: isActive ? 'var(--accent)' : 'var(--text)' }}>{strat.name}</strong>
                  <span style={{ fontSize: '0.72rem', padding: '0.15rem 0.45rem', borderRadius: '4px', background: isActive ? 'rgba(0, 212, 255, 0.2)' : 'rgba(255, 255, 255, 0.05)', color: isActive ? 'var(--accent)' : 'var(--text-dim)', fontWeight: 700 }}>
                    {isActive ? 'ACTIVE' : 'OFF'}
                  </span>
                </div>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.4rem', lineHeight: 1.4 }}>{strat.desc}</p>
              </div>
            );
          })}
        </div>
      </article>

      {/* 4. Telegram & WhatsApp Live Alerts Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem', marginTop: '1.25rem' }}>
        {/* WhatsApp Section */}
        <article className="card">
          <div className="panel-heading">
            <div>
              <h2>💬 WhatsApp Live Alerts</h2>
              <p>Receive trade signals & executions directly on WhatsApp.</p>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, color: whatsappEnabled ? 'var(--green)' : 'var(--text-dim)' }}>
              <input type="checkbox" checked={whatsappEnabled} onChange={(e) => setWhatsappEnabled(e.target.checked)} style={{ cursor: 'pointer' }} />
              {whatsappEnabled ? 'ENABLED' : 'DISABLED'}
            </label>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div className="form-group">
              <label>Phone Number (with Country Code)</label>
              <input
                type="text"
                value={whatsappPhone}
                onChange={(e) => setWhatsappPhone(e.target.value)}
                placeholder="e.g. 919876543210"
                className="input"
              />
              <small className="muted-copy" style={{ fontSize: '0.72rem', marginTop: '0.2rem', display: 'block' }}>Indian numbers start with 91 (e.g. 91XXXXXXXXXX).</small>
            </div>
            <div className="form-group">
              <label>CallMeBot WhatsApp API Key</label>
              <input
                type="password"
                value={whatsappApiKey}
                onChange={(e) => setWhatsappApiKey(e.target.value)}
                placeholder="Free API key from CallMeBot"
                className="input"
              />
              <small className="muted-copy" style={{ fontSize: '0.72rem', marginTop: '0.2rem', display: 'block' }}>
                Free key: WhatsApp message <code>"I allow callmebot to send me messages"</code> to <code>+34 644 59 87 53</code>.
              </small>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.35rem' }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleTestWhatsApp} disabled={testingWhatsapp}>
                {testingWhatsapp ? 'Sending…' : 'Send Test WhatsApp Alert'}
              </button>
              {whatsappStatus && <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{whatsappStatus}</span>}
            </div>
          </div>
        </article>

        {/* Telegram Section */}
        <article className="card">
          <div className="panel-heading">
            <div>
              <h2>📲 Telegram Live Alerts</h2>
              <p>Receive instant notifications on trades and signals.</p>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, color: telegramEnabled ? 'var(--green)' : 'var(--text-dim)' }}>
              <input type="checkbox" checked={telegramEnabled} onChange={(e) => setTelegramEnabled(e.target.checked)} style={{ cursor: 'pointer' }} />
              {telegramEnabled ? 'ENABLED' : 'DISABLED'}
            </label>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div className="form-group">
              <label>Bot Token</label>
              <input
                type="password"
                value={telegramToken}
                onChange={(e) => setTelegramToken(e.target.value)}
                placeholder="123456789:ABCdefGhIJKlmNoPQRstu"
                className="input"
              />
            </div>
            <div className="form-group">
              <label>Chat ID</label>
              <input
                type="text"
                value={telegramChatId}
                onChange={(e) => setTelegramChatId(e.target.value)}
                placeholder="-100123456789 or UserID"
                className="input"
              />
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.35rem' }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleTestTelegram} disabled={testingTelegram}>
                {testingTelegram ? 'Sending…' : 'Send Test Telegram Alert'}
              </button>
              {telegramStatus && <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{telegramStatus}</span>}
            </div>
          </div>
        </article>
      </div>

      {/* 5. Watchlist Manager */}
      <article className="card" style={{ marginTop: '1.25rem' }}>
        <div className="panel-heading">
          <div>
            <h2>📋 Watchlist Management ({watchlist.length} equities)</h2>
            <p>Stocks included in automatic and multi-stock screener scans.</p>
          </div>
        </div>
        <form onSubmit={handleAddSymbol} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', maxWidth: 450 }}>
          <input
            type="text"
            value={newSymbol}
            onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
            placeholder="Add symbol e.g. TATASTEEL"
            className="input"
            style={{ flex: 1 }}
          />
          <button type="submit" className="btn btn-secondary btn-sm">Add</button>
        </form>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', maxHeight: '180px', overflowY: 'auto', padding: '0.25rem 0' }}>
          {watchlist.map((sym) => (
            <span
              key={sym}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.3rem 0.65rem',
                borderRadius: 'var(--radius-pill)',
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                fontSize: '0.8rem',
                fontFamily: 'var(--font-mono)',
                fontWeight: 600,
                color: 'var(--text)',
              }}
            >
              {sym}
              <button
                type="button"
                onClick={() => handleRemoveSymbol(sym)}
                style={{ background: 'transparent', border: 0, color: 'var(--text-dim)', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: 0 }}
                title={`Remove ${sym}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </article>

      <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ minWidth: 160 }}>
          {saving ? 'Saving changes…' : 'Save Configuration'}
        </button>
      </div>
    </section>
  );
}
