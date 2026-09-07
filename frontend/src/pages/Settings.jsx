import { useState, useEffect } from 'react';
import { api } from '../api';

const ALL_STRATEGIES = [
  { id: 'ema_crossover', name: 'EMA Crossover (9 / 21)', desc: 'Fast/Slow Exponential Moving Average trend crossover with RSI filter' },
  { id: 'rsi_reversal', name: 'RSI Reversal (14)', desc: 'Mean reversion strategy buying oversold (<30) and selling overbought (>70)' },
  { id: 'bollinger_breakout', name: 'Bollinger Breakout (20, 2)', desc: 'Volatility band breakout strategy during high momentum expansions' },
  { id: 'supertrend', name: 'Supertrend (10, 3)', desc: 'ATR-based trailing stop momentum indicator favored by Indian equity traders' },
  { id: 'vwap', name: 'VWAP + RSI Momentum', desc: 'Volume Weighted Average Price crossover with institutional flow confirmation' },
];

const RISK_PROFILES = [
  { name: '🛡️ Conservative', desc: 'Capital preservation focus',   sl: 1.0, tp: 2.0, tsl: 0.8, posPct: 15, dailyLimit: 3.0 },
  { name: '⚡ Balanced (Default)', desc: '2:1 R:R optimal growth', sl: 2.0, tp: 4.0, tsl: 1.0, posPct: 25, dailyLimit: 5.0 },
  { name: '🚀 Aggressive', desc: 'High momentum breakouts',        sl: 3.0, tp: 6.0, tsl: 1.5, posPct: 35, dailyLimit: 8.0 },
];

const CAPITAL_PRESETS = [10000, 25000, 50000, 100000];

const FORM_DEFAULTS = {
  // Risk
  capital: 25000,
  maxPositionPct: 25.0,
  maxDailyLossPct: 5.0,
  maxOpenPositions: 5,
  stopLossPct: 2.0,
  takeProfitPct: 4.0,
  trailingStopLossPct: 1.0,
  // Strategy
  activeStrategies: ['ema_crossover', 'supertrend'],
  watchlist: ['RELIANCE', 'SBIN', 'ITC', 'INFY', 'TCS', 'TATAMOTORS'],
  newSymbol: '',
  // Telegram
  telegramEnabled: false,
  telegramToken: '',
  telegramChatId: '',
  // WhatsApp
  whatsappEnabled: false,
  whatsappPhone: '',
  whatsappApiKey: '',
};

export default function Settings() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState({ type: '', text: '' });

  // Single form state object replaces 14 separate useState calls
  const [form, setForm] = useState(FORM_DEFAULTS);
  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  // Per-action UI states (not part of the form payload)
  const [testingTelegram, setTestingTelegram] = useState(false);
  const [telegramStatus, setTelegramStatus] = useState('');
  const [testingWhatsapp, setTestingWhatsapp] = useState(false);
  const [whatsappStatus, setWhatsappStatus] = useState('');

  useEffect(() => {
    api.getSettings()
      .then((data) => {
        setConfig(data);
        // Reset all form fields in a single call
        setForm({
          ...FORM_DEFAULTS,
          ...(data.risk ? {
            capital: data.risk.capital ?? FORM_DEFAULTS.capital,
            maxPositionPct: data.risk.max_position_pct ?? FORM_DEFAULTS.maxPositionPct,
            maxDailyLossPct: data.risk.max_daily_loss_pct ?? FORM_DEFAULTS.maxDailyLossPct,
            maxOpenPositions: data.risk.max_open_positions ?? FORM_DEFAULTS.maxOpenPositions,
            stopLossPct: data.risk.stop_loss_pct ?? FORM_DEFAULTS.stopLossPct,
            takeProfitPct: data.risk.take_profit_pct ?? FORM_DEFAULTS.takeProfitPct,
            trailingStopLossPct: data.risk.trailing_stop_loss_pct ?? FORM_DEFAULTS.trailingStopLossPct,
          } : {}),
          ...(data.strategies ? {
            activeStrategies: data.strategies.active || FORM_DEFAULTS.activeStrategies,
            watchlist: data.strategies.watchlist || FORM_DEFAULTS.watchlist,
          } : {}),
          ...(data.telegram ? {
            telegramEnabled: Boolean(data.telegram.enabled),
            telegramToken: data.telegram.bot_token || '',
            telegramChatId: data.telegram.chat_id || '',
          } : {}),
          ...(data.whatsapp ? {
            whatsappEnabled: Boolean(data.whatsapp.enabled),
            whatsappPhone: data.whatsapp.phone || '',
            whatsappApiKey: data.whatsapp.api_key || '',
          } : {}),
        });
      })
      .catch(() => setStatusMsg({ type: 'error', text: 'Could not load current settings from API server.' }))
      .finally(() => setLoading(false));
  }, []);

  const applyRiskProfile = (profile) => {
    setForm((prev) => ({
      ...prev,
      stopLossPct: profile.sl,
      takeProfitPct: profile.tp,
      trailingStopLossPct: profile.tsl,
      maxPositionPct: profile.posPct,
      maxDailyLossPct: profile.dailyLimit,
    }));
    setStatusMsg({ type: 'success', text: `Applied ${profile.name} risk profile parameters.` });
    setTimeout(() => setStatusMsg({ type: '', text: '' }), 3500);
  };

  const handleToggleStrategy = (stratId) => {
    setForm((prev) => ({
      ...prev,
      activeStrategies: prev.activeStrategies.includes(stratId)
        ? prev.activeStrategies.filter((id) => id !== stratId)
        : [...prev.activeStrategies, stratId],
    }));
  };

  const handleAddSymbol = (e) => {
    e.preventDefault();
    const sym = form.newSymbol.trim().toUpperCase();
    if (sym && !form.watchlist.includes(sym)) {
      setForm((prev) => ({ ...prev, watchlist: [...prev.watchlist, sym], newSymbol: '' }));
    }
  };

  const handleRemoveSymbol = (sym) => {
    setForm((prev) => ({ ...prev, watchlist: prev.watchlist.filter((s) => s !== sym) }));
  };

  const handleSave = async () => {
    setSaving(true);
    setStatusMsg({ type: '', text: '' });

    const payload = {
      ...(config || {}),
      risk: {
        ...(config?.risk || {}),
        capital: Number(form.capital),
        max_position_pct: Number(form.maxPositionPct),
        max_daily_loss_pct: Number(form.maxDailyLossPct),
        max_open_positions: Number(form.maxOpenPositions),
        stop_loss_pct: Number(form.stopLossPct),
        take_profit_pct: Number(form.takeProfitPct),
        trailing_stop_loss_pct: Number(form.trailingStopLossPct),
      },
      strategies: {
        ...(config?.strategies || {}),
        active: form.activeStrategies,
        available: ALL_STRATEGIES.map((s) => s.id),
        watchlist: form.watchlist,
      },
      telegram: {
        enabled: form.telegramEnabled,
        bot_token: form.telegramToken.trim(),
        chat_id: form.telegramChatId.trim(),
      },
      whatsapp: {
        enabled: form.whatsappEnabled,
        phone: form.whatsappPhone.trim().replace('+', '').replace(/\s+/g, ''),
        api_key: form.whatsappApiKey.trim(),
      },
    };

    try {
      await api.updateSettings(payload);
      setStatusMsg({ type: 'success', text: 'Settings successfully saved and active across all engines!' });
    } catch {
      setStatusMsg({ type: 'error', text: 'Failed to save settings. Confirm API server is running.' });
    } finally {
      setSaving(false);
    }
  };

  const handleTestTelegram = async () => {
    if (!form.telegramToken.trim() || !form.telegramChatId.trim()) {
      setTelegramStatus('Please enter both Bot Token and Chat ID before testing.');
      return;
    }
    setTestingTelegram(true);
    setTelegramStatus('');
    try {
      const res = await api.testTelegram({ bot_token: form.telegramToken, chat_id: form.telegramChatId });
      setTelegramStatus(`✅ ${res.message || 'Test message sent to Telegram!'}`);
    } catch (err) {
      setTelegramStatus(`❌ Test failed: ${err.message || 'Check credentials'}`);
    } finally {
      setTestingTelegram(false);
    }
  };

  const handleTestWhatsApp = async () => {
    if (!form.whatsappPhone.trim() || !form.whatsappApiKey.trim()) {
      setWhatsappStatus('Enter Phone number with country code (e.g. 919876543210) and API Key.');
      return;
    }
    setTestingWhatsapp(true);
    setWhatsappStatus('');
    try {
      const res = await api.testWhatsApp({ phone: form.whatsappPhone, api_key: form.whatsappApiKey });
      setWhatsappStatus(`✅ ${res.message || 'Test message sent to your WhatsApp!'}`);
    } catch (err) {
      setWhatsappStatus(`❌ Test failed: ${err.message || 'Check phone or key'}`);
    } finally {
      setTestingWhatsapp(false);
    }
  };

  const maxTradeAllocation = (Number(form.capital) * (Number(form.maxPositionPct) / 100)).toFixed(0);
  const maxDailyLossAmount = (Number(form.capital) * (Number(form.maxDailyLossPct) / 100)).toFixed(0);
  const riskRewardRatio = (Number(form.takeProfitPct) / (Number(form.stopLossPct) || 1)).toFixed(1);

  if (loading) {
    return (
      <div className="main" style={{ padding: '3rem', textAlign: 'center' }}>
        <p className="muted-copy">Loading configuration settings…</p>
      </div>
    );
  }

  return (
    <section className="settings-page" style={{ width: '100%' }}>
      <header className="page-heading">
        <div>
          <h1>Controls</h1>
          <p className="page-subtitle">Risk Envelope, Strategy Rules &amp; Real-time Alerting</p>
        </div>
        <div className="header-chips">
          <span className="chip mode-chip">
            <i className="mode-pulse" /> Angel One SmartAPI · 42ms Ping
          </span>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ padding: '0.5rem 1.25rem', fontWeight: 700 }}>
            {saving ? 'Saving changes…' : '💾 Save Configuration'}
          </button>
        </div>
      </header>

      {/* Risk Profile Presets Banner */}
      <article className="card" style={{ padding: '14px 18px', marginBottom: '14px', borderRadius: '16px' }}>
        <div className="panel-heading" style={{ marginBottom: '10px' }}>
          <div>
            <h2>🛡️ One-Click Risk Profiles</h2>
            <p>Select an institutional risk envelope preset or fine-tune with the visual sliders below.</p>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
          {RISK_PROFILES.map((p) => {
            const isMatch = Number(form.stopLossPct) === p.sl && Number(form.takeProfitPct) === p.tp;
            return (
              <button
                key={p.name}
                type="button"
                onClick={() => applyRiskProfile(p)}
                style={{
                  padding: '10px 14px',
                  borderRadius: '12px',
                  border: `1px solid ${isMatch ? '#2dd4bf' : 'rgba(255,255,255,0.1)'}`,
                  background: isMatch ? 'rgba(45,212,191,0.12)' : 'rgba(255,255,255,0.04)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  textAlign: 'left',
                  color: 'inherit',
                  font: 'inherit',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: '0.88rem', color: isMatch ? '#2dd4bf' : '#ffffff' }}>{p.name}</strong>
                  <span style={{ fontSize: '0.7rem', color: '#b3a6d4', fontFamily: 'var(--font-mono)' }}>{p.sl}% SL / {p.tp}% TP</span>
                </div>
                <p style={{ fontSize: '0.74rem', color: '#8b7db0', margin: '4px 0 0' }}>{p.desc}</p>
              </button>
            );
          })}
        </div>
      </article>

      {statusMsg.text && (
        <div className={`dashboard-alert ${statusMsg.type === 'error' ? '' : 'alert-success'}`} style={{ marginBottom: '14px', background: statusMsg.type === 'error' ? 'rgba(255,51,102,0.15)' : 'rgba(0,230,118,0.15)', borderColor: statusMsg.type === 'error' ? 'var(--red)' : 'var(--green)', color: '#fff' }}>
          {statusMsg.text}
        </div>
      )}

      {/* Core Risk Sizing & Target Sliders */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '14px', marginBottom: '14px' }}>
        {/* 1. Capital & Risk Sizing */}
        <article className="card" style={{ padding: '16px 18px', borderRadius: '16px' }}>
          <div className="panel-heading" style={{ marginBottom: '12px' }}>
            <div>
              <h2>💰 Capital Sizing &amp; Drawdown Circuit Breaker</h2>
              <p>Dynamic position allocation and account protection.</p>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <label style={{ margin: 0 }}>Trading Capital (₹)</label>
                <strong className="mono" style={{ color: '#2dd4bf', fontSize: '0.92rem' }}>₹{Number(form.capital).toLocaleString('en-IN')}</strong>
              </div>
              <input
                type="number"
                min="1000"
                step="1000"
                value={form.capital}
                onChange={(e) => set('capital', Number(e.target.value))}
                className="input mono"
              />
              <div className="quick-qty-chips" style={{ marginTop: '6px' }}>
                {CAPITAL_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`chip-sm ${Number(form.capital) === c ? 'active' : ''}`}
                    onClick={() => set('capital', c)}
                  >
                    ₹{(c / 1000).toFixed(0)}k
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <label style={{ margin: 0 }}>Max Position Sizing: <strong className="mono" style={{ color: '#c4b5fd' }}>{form.maxPositionPct}%</strong></label>
                <span className="mono" style={{ fontSize: '0.74rem', color: '#8b7db0' }}>Max ₹{maxTradeAllocation} / trade</span>
              </div>
              <input type="range" min="5" max="50" step="1" value={form.maxPositionPct} onChange={(e) => set('maxPositionPct', Number(e.target.value))} style={{ width: '100%', accentColor: '#c4b5fd', cursor: 'pointer' }} />
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <label style={{ margin: 0 }}>Daily Loss Halt Limit: <strong className="mono" style={{ color: '#fb7185' }}>{form.maxDailyLossPct}%</strong></label>
                <span className="mono" style={{ fontSize: '0.74rem', color: '#fb7185' }}>Halts @ -₹{maxDailyLossAmount} loss</span>
              </div>
              <input type="range" min="1" max="15" step="0.5" value={form.maxDailyLossPct} onChange={(e) => set('maxDailyLossPct', Number(e.target.value))} style={{ width: '100%', accentColor: '#fb7185', cursor: 'pointer' }} />
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <label style={{ margin: 0 }}>Max Concurrent Open Positions</label>
                <strong className="mono" style={{ color: '#ffffff' }}>{form.maxOpenPositions} Lots</strong>
              </div>
              <input type="range" min="1" max="10" step="1" value={form.maxOpenPositions} onChange={(e) => set('maxOpenPositions', Number(e.target.value))} style={{ width: '100%', accentColor: '#2dd4bf', cursor: 'pointer' }} />
            </div>
          </div>
        </article>

        {/* 2. Target & Stop-Loss */}
        <article className="card" style={{ padding: '16px 18px', borderRadius: '16px' }}>
          <div className="panel-heading" style={{ marginBottom: '12px' }}>
            <div>
              <h2>🎯 Target &amp; Stop-Loss Rules</h2>
              <p>Dynamic profit-taking, loss prevention &amp; trailing stops.</p>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <label style={{ margin: 0 }}>Stop-Loss (SL): <strong className="mono" style={{ color: '#fb7185' }}>{form.stopLossPct}%</strong></label>
                <span className="mono" style={{ fontSize: '0.74rem', color: '#8b7db0' }}>Cap per-trade downside</span>
              </div>
              <input type="range" min="0.5" max="10" step="0.1" value={form.stopLossPct} onChange={(e) => set('stopLossPct', Number(e.target.value))} style={{ width: '100%', accentColor: '#fb7185', cursor: 'pointer' }} />
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <label style={{ margin: 0 }}>Take-Profit (TP): <strong className="mono" style={{ color: '#4ade80' }}>{form.takeProfitPct}%</strong></label>
                <span className="mono" style={{ fontSize: '0.74rem', color: '#8b7db0' }}>Automated profit target</span>
              </div>
              <input type="range" min="1" max="20" step="0.2" value={form.takeProfitPct} onChange={(e) => set('takeProfitPct', Number(e.target.value))} style={{ width: '100%', accentColor: '#4ade80', cursor: 'pointer' }} />
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <label style={{ margin: 0 }}>🛡️ Trailing Stop Trigger: <strong className="mono" style={{ color: '#2dd4bf' }}>{form.trailingStopLossPct}%</strong></label>
                <span className="mono" style={{ fontSize: '0.74rem', color: '#8b7db0' }}>Locks in upside run</span>
              </div>
              <input type="range" min="0.5" max="5" step="0.1" value={form.trailingStopLossPct} onChange={(e) => set('trailingStopLossPct', Number(e.target.value))} style={{ width: '100%', accentColor: '#2dd4bf', cursor: 'pointer' }} />
            </div>

            <div style={{ padding: '10px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)', fontSize: '0.8rem', color: '#b3a6d4' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span>Risk-to-Reward Ratio:</span>
                <strong style={{ color: Number(riskRewardRatio) >= 2 ? '#4ade80' : '#fbbf24', fontFamily: 'var(--font-mono)' }}>1 : {riskRewardRatio}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Auto Intraday Square-off:</span>
                <strong style={{ color: '#ffffff', fontFamily: 'var(--font-mono)' }}>15:15 IST (Auto EOD)</strong>
              </div>
            </div>
          </div>
        </article>
      </div>

      {/* 3. Active Strategies */}
      <article className="card" style={{ marginBottom: '14px', borderRadius: '16px', padding: '16px 18px' }}>
        <div className="panel-heading" style={{ marginBottom: '12px' }}>
          <div>
            <h2>📈 Active Strategies ({form.activeStrategies.length} selected)</h2>
            <p>Select which algorithms evaluate stocks during market scans and live execution.</p>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px' }}>
          {ALL_STRATEGIES.map((strat) => {
            const isActive = form.activeStrategies.includes(strat.id);
            return (
              <button
                key={strat.id}
                type="button"
                onClick={() => handleToggleStrategy(strat.id)}
                style={{
                  padding: '12px 14px',
                  borderRadius: '12px',
                  border: `1px solid ${isActive ? 'rgba(45,212,191,0.45)' : 'rgba(255,255,255,0.08)'}`,
                  background: isActive ? 'rgba(45,212,191,0.08)' : 'rgba(255,255,255,0.03)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  textAlign: 'left',
                  color: 'inherit',
                  font: 'inherit',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: '0.9rem', color: isActive ? '#2dd4bf' : '#ffffff' }}>{strat.name}</strong>
                  <span style={{ fontSize: '0.68rem', padding: '0.15rem 0.5rem', borderRadius: '6px', background: isActive ? 'rgba(45,212,191,0.2)' : 'rgba(255,255,255,0.06)', color: isActive ? '#2dd4bf' : '#8b7db0', fontWeight: 700 }}>
                    {isActive ? 'ACTIVE' : 'OFF'}
                  </span>
                </div>
                <p style={{ fontSize: '0.74rem', color: '#b3a6d4', marginTop: '4px', lineHeight: 1.35 }}>{strat.desc}</p>
              </button>
            );
          })}
        </div>
      </article>

      {/* 4. Telegram & WhatsApp Live Alerts Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '14px', marginBottom: '14px' }}>
        {/* WhatsApp Section */}
        <article className="card" style={{ padding: '16px 18px', borderRadius: '16px' }}>
          <div className="panel-heading" style={{ marginBottom: '10px' }}>
            <div>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                💬 WhatsApp Notifications
                <span className="badge" style={{ fontSize: '0.64rem', background: 'rgba(56,189,248,0.15)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.3)' }}>
                  🔒 Stored in .env
                </span>
              </h2>
              <p>Receive trade signals &amp; executions directly on WhatsApp.</p>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, color: form.whatsappEnabled ? '#4ade80' : '#8b7db0' }}>
              <input type="checkbox" checked={form.whatsappEnabled} onChange={(e) => set('whatsappEnabled', e.target.checked)} style={{ cursor: 'pointer' }} />
              {form.whatsappEnabled ? 'ENABLED' : 'DISABLED'}
            </label>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div className="form-group">
              <label>Phone Number (with Country Code)</label>
              <input type="text" placeholder="e.g. 919876543210" value={form.whatsappPhone} onChange={(e) => set('whatsappPhone', e.target.value)} className="input mono" />
              <small className="muted-copy" style={{ fontSize: '0.72rem', marginTop: '2px', display: 'block' }}>Indian numbers start with 91 (e.g. 91XXXXXXXXXX).</small>
            </div>
            <div className="form-group">
              <label>CallMeBot WhatsApp API Key</label>
              <input type="password" placeholder="Free API key from CallMeBot" value={form.whatsappApiKey} onChange={(e) => set('whatsappApiKey', e.target.value)} className="input mono" />
              <small className="muted-copy" style={{ fontSize: '0.72rem', marginTop: '2px', display: 'block' }}>
                Free key: WhatsApp message "I allow callmebot to send me messages" to +34 644 59 87 53.
              </small>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
              <button type="button" className="btn btn-outline btn-sm" onClick={handleTestWhatsApp} disabled={testingWhatsapp}>
                {testingWhatsapp ? 'Sending…' : 'Send Test WhatsApp Alert'}
              </button>
              {whatsappStatus && <span style={{ fontSize: '0.76rem', color: whatsappStatus.includes('✅') ? '#4ade80' : '#fb7185' }}>{whatsappStatus}</span>}
            </div>
          </div>
        </article>

        {/* Telegram Section */}
        <article className="card" style={{ padding: '16px 18px', borderRadius: '16px' }}>
          <div className="panel-heading" style={{ marginBottom: '10px' }}>
            <div>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                📲 Telegram Live Alerts
                <span className="badge" style={{ fontSize: '0.64rem', background: 'rgba(56,189,248,0.15)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.3)' }}>
                  🔒 Stored in .env
                </span>
              </h2>
              <p>Receive instant notifications on trades and signals.</p>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, color: form.telegramEnabled ? '#4ade80' : '#8b7db0' }}>
              <input type="checkbox" checked={form.telegramEnabled} onChange={(e) => set('telegramEnabled', e.target.checked)} style={{ cursor: 'pointer' }} />
              {form.telegramEnabled ? 'ENABLED' : 'DISABLED'}
            </label>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div className="form-group">
              <label>Bot Token</label>
              <input type="password" placeholder="123456789:ABCdefGhIJKlmNoPQrStu" value={form.telegramToken} onChange={(e) => set('telegramToken', e.target.value)} className="input mono" />
            </div>
            <div className="form-group">
              <label>Chat ID</label>
              <input type="text" placeholder="-100123456789 or UserID" value={form.telegramChatId} onChange={(e) => set('telegramChatId', e.target.value)} className="input mono" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
              <button type="button" className="btn btn-outline btn-sm" onClick={handleTestTelegram} disabled={testingTelegram}>
                {testingTelegram ? 'Sending…' : 'Send Test Telegram Alert'}
              </button>
              {telegramStatus && <span style={{ fontSize: '0.76rem', color: telegramStatus.includes('✅') ? '#4ade80' : '#fb7185' }}>{telegramStatus}</span>}
            </div>
          </div>
        </article>
      </div>

      {/* 5. Watchlist Management */}
      <article className="card" style={{ padding: '16px 18px', borderRadius: '16px', marginBottom: '14px' }}>
        <div className="panel-heading" style={{ marginBottom: '10px' }}>
          <div>
            <h2>📋 Watchlist Management ({form.watchlist.length} equities)</h2>
            <p>Stocks included in automatic and multi-stock screener scans.</p>
          </div>
        </div>
        <form onSubmit={handleAddSymbol} style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <input
            type="text"
            placeholder="Add symbol e.g. TATASTEEL"
            value={form.newSymbol}
            onChange={(e) => set('newSymbol', e.target.value.toUpperCase())}
            className="input mono"
            style={{ maxWidth: '280px' }}
          />
          <button type="submit" className="btn btn-primary btn-sm" style={{ padding: '0 1.25rem' }}>
            Add
          </button>
        </form>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {form.watchlist.map((sym) => (
            <span
              key={sym}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '0.25rem 0.65rem', borderRadius: '8px',
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                color: '#ffffff', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: 650,
              }}
            >
              {sym}
              <button
                type="button"
                onClick={() => handleRemoveSymbol(sym)}
                style={{ background: 'transparent', border: 0, color: '#fb7185', cursor: 'pointer', padding: 0, fontSize: '0.88rem', lineHeight: 1 }}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      </article>

      {/* Sticky Bottom Save Action Bar */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ padding: '0.75rem 2rem', fontSize: '0.94rem', fontWeight: 700 }}>
          {saving ? 'Saving changes…' : '💾 Save Configuration'}
        </button>
      </div>
    </section>
  );
}
