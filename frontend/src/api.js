const BASE = '/api';
const tradingHeaders = import.meta.env.VITE_STOCKBOT_API_KEY
  ? { 'X-API-Key': import.meta.env.VITE_STOCKBOT_API_KEY }
  : {};

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!res.ok) {
    let errorMsg = `${res.status} ${res.statusText}`;
    try {
      const errData = await res.json();
      if (errData?.error) errorMsg = errData.error;
    } catch {}
    const err = new Error(errorMsg);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export const api = {
  portfolio: () => request('/portfolio/'),
  strategies: () => request('/strategies/'),
  signals: () => request('/signals/'),
  orders: () => request('/orders/'),
  positions: () => request('/positions/'),
  trades: () => request('/trades/'),
  performance: () => request('/performance/'),
  scan: (symbol) => request(`/scan/?symbol=${encodeURIComponent(symbol || '')}`, { headers: tradingHeaders }),
  backtest: (payload) => request('/backtest/', { method: 'POST', body: JSON.stringify(payload) }),
  execute: (payload) => request('/execute/', { method: 'POST', headers: tradingHeaders, body: JSON.stringify(payload) }),
  emergencySquareOff: () => request('/emergency-squareoff/', { method: 'POST', headers: tradingHeaders }),
  scanWatchlist: () => request('/scan-watchlist/', { headers: tradingHeaders }),
  getSettings: () => request('/settings/'),
  updateSettings: (payload) => request('/settings/', { method: 'POST', body: JSON.stringify(payload) }),
  testTelegram: (payload) => request('/telegram-test/', { method: 'POST', body: JSON.stringify(payload) }),
  testWhatsApp: (payload) => request('/whatsapp-test/', { method: 'POST', body: JSON.stringify(payload) }),
  getAutoTraderStatus: () => request('/autotrader/status/'),
  toggleAutoTrader: (payload = {}) => request('/autotrader/toggle/', { method: 'POST', body: JSON.stringify(payload) }),
  getTradesCalendar: (days = 90) => request(`/trades-calendar/?days=${days}`),
  
  // AI Assistant APIs
  chatAssistant: (message, history = []) =>
    request('/assistant/chat/', { method: 'POST', body: JSON.stringify({ message, history }) }),
  getAssistantStatus: () => request('/assistant/status/'),
  getDailySummary: () => request('/assistant/daily-summary/'),
  generateDailySummary: (sendAlerts = false) =>
    request('/assistant/daily-summary/', { method: 'POST', body: JSON.stringify({ send_alerts: sendAlerts }) }),
  getSentiment: (symbol = '') =>
    request(`/assistant/sentiment/${symbol ? `?symbol=${encodeURIComponent(symbol)}` : ''}`),
  refreshSentiment: (symbol = '') =>
    request('/assistant/sentiment/', { method: 'POST', body: JSON.stringify({ symbol }) }),
  explainSignal: (payload) =>
    request('/assistant/explain-signal/', { method: 'POST', body: JSON.stringify(payload) }),
};
