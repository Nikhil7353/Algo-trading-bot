import { useState, useEffect } from 'react';
import { api } from '../api';

const DEFAULT_TICKERS = [
  { symbol: 'NIFTY 50', price: '24,852.15', change: '+0.45%', positive: true },
  { symbol: 'BANKNIFTY', price: '51,280.40', change: '+0.32%', positive: true },
  { symbol: 'RELIANCE', price: '₹1,316.00', change: '+0.80%', positive: true },
  { symbol: 'SBIN', price: '₹632.50', change: '+1.15%', positive: true },
  { symbol: 'TCS', price: '₹4,120.00', change: '-0.25%', positive: false },
  { symbol: 'INFY', price: '₹1,885.50', change: '+0.60%', positive: true },
  { symbol: 'TATAMOTORS', price: '₹980.20', change: '+1.40%', positive: true },
  { symbol: 'ITC', price: '₹495.30', change: '+0.10%', positive: true },
  { symbol: 'HDFCBANK', price: '₹1,640.80', change: '-0.15%', positive: false },
];

export default function MarketTicker() {
  const [tickers, setTickers] = useState(DEFAULT_TICKERS);

  useEffect(() => {
    // Optionally fetch dynamic watchlist prices from screener
    api.scanWatchlist()
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          const dynamic = data.slice(0, 8).map((item) => ({
            symbol: item.symbol,
            price: `₹${Number(item.price || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
            change: item.change_pct >= 0 ? `+${item.change_pct}%` : `${item.change_pct}%`,
            positive: item.change_pct >= 0,
          }));
          setTickers([
            { symbol: 'NIFTY 50', price: '24,852.15', change: '+0.45%', positive: true },
            { symbol: 'BANKNIFTY', price: '51,280.40', change: '+0.32%', positive: true },
            ...dynamic,
          ]);
        }
      })
      .catch(() => {
        // keep defaults if server is starting
      });
  }, []);

  return (
    <div className="market-ticker-bar">
      <div className="ticker-label">
        <span className="ticker-pulse-dot" />
        <span>NSE LIVE</span>
      </div>
      <div className="ticker-track">
        <div className="ticker-content">
          {tickers.map((t, idx) => (
            <div key={`${t.symbol}-${idx}`} className="ticker-item">
              <span className="ticker-sym">{t.symbol}</span>
              <span className="ticker-price">{t.price}</span>
              <span className={`ticker-change ${t.positive ? 'pos' : 'neg'}`}>
                {t.change}
              </span>
            </div>
          ))}
        </div>
        <div className="ticker-content" aria-hidden="true">
          {tickers.map((t, idx) => (
            <div key={`dup-${t.symbol}-${idx}`} className="ticker-item">
              <span className="ticker-sym">{t.symbol}</span>
              <span className="ticker-price">{t.price}</span>
              <span className={`ticker-change ${t.positive ? 'pos' : 'neg'}`}>
                {t.change}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
