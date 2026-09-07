import { useState, useEffect } from 'react';
import { api } from '../api';

export default function MarketTicker() {
  // Start empty — show nothing until live data arrives (no hardcoded stale prices)
  const [tickers, setTickers] = useState([]);

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      api.scanWatchlist()
        .then((data) => {
          if (cancelled || !Array.isArray(data) || data.length === 0) return;
          setTickers(data.slice(0, 8).map((item) => ({
            symbol: item.symbol,
            price: Number(item.price || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
            change: item.change_pct == null ? 'flat' : item.change_pct >= 0 ? `+${item.change_pct}%` : `${item.change_pct}%`,
            positive: Number(item.change_pct || 0) >= 0,
            flat: item.change_pct == null || Number(item.change_pct) === 0,
          })));
        })
        .catch(() => {});
    };

    // Small initial delay so the app shell renders first, then refresh every 60s
    const initial = setTimeout(load, 3000);
    const interval = setInterval(load, 60_000);
    return () => { cancelled = true; clearTimeout(initial); clearInterval(interval); };
  }, []);

  const row = (prefix) => tickers.map((t, idx) => (
    <div key={`${prefix}-${t.symbol}-${idx}`} className="ticker-item">
      <span className="ticker-sym">{t.symbol}</span>
      <span className="ticker-price">{t.price}</span>
      <span className={`ticker-change ${t.flat ? '' : t.positive ? 'pos' : 'neg'}`}>{t.change}</span>
    </div>
  ));

  return (
    <div className="market-ticker-bar">
      <div className="ticker-track">
        <div className="ticker-content">{row('a')}</div>
        <div className="ticker-content" aria-hidden="true">{row('b')}</div>
      </div>
    </div>
  );
}
