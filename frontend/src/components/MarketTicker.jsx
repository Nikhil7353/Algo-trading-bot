import { useState, useEffect } from 'react';
import { api } from '../api';

const DEFAULT_TICKERS = [
  { symbol: 'NIFTY', price: '24,812.40', change: '+0.00%', positive: true },
  { symbol: 'BANKNIFTY', price: '54,210.15', change: '+0.00%', positive: true },
  { symbol: 'SBIN', price: '1,086.00', change: '+3.56%', positive: true },
  { symbol: 'RELIANCE', price: '1,313.70', change: '-0.17%', positive: false },
  { symbol: 'INFY', price: '1,361.00', change: 'flat', positive: true, flat: true },
  { symbol: 'TCS', price: '2,728.00', change: 'flat', positive: true, flat: true },
];

export default function MarketTicker() {
  const [tickers, setTickers] = useState(DEFAULT_TICKERS);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      api.scanWatchlist()
        .then((data) => {
          if (cancelled || !Array.isArray(data) || data.length === 0) return;
          const dynamic = data.slice(0, 8).map((item) => ({
            symbol: item.symbol,
            price: Number(item.price || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
            change: item.change_pct == null ? 'flat' : item.change_pct >= 0 ? `+${item.change_pct}%` : `${item.change_pct}%`,
            positive: Number(item.change_pct || 0) >= 0,
            flat: item.change_pct == null || Number(item.change_pct) === 0,
          }));
          setTickers([
            { symbol: 'NIFTY', price: '24,812.40', change: '+0.00%', positive: true },
            { symbol: 'BANKNIFTY', price: '54,210.15', change: '+0.00%', positive: true },
            ...dynamic,
          ]);
        })
        .catch(() => {});
    }, 8000);
    return () => { cancelled = true; clearTimeout(timer); };
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
