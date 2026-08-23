import { useState, useEffect } from 'react';
import { api } from '../api';

function formatCurrency(value) {
  const amount = Number(value || 0);
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function CalendarHeatmap() {
  const [calendar, setCalendar] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await api.getTradesCalendar();
        if (res?.calendar) {
          setCalendar(res.calendar);
          if (res.calendar.length > 0) {
            setSelectedDay(res.calendar[0]);
          }
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading trading journal…</div>;
  }

  const totalPnL = calendar.reduce((acc, d) => acc + (d.pnl || 0), 0);
  const totalTrades = calendar.reduce((acc, d) => acc + (d.total_trades || 0), 0);
  const winDays = calendar.filter((d) => d.pnl > 0).length;
  const lossDays = calendar.filter((d) => d.pnl < 0).length;

  return (
    <article className="card calendar-journal-card">
      <div className="panel-heading">
        <div>
          <h2>📅 Daily P&L Trading Journal & Calendar</h2>
          <p>Historical trading breakdown and win/loss day streaks.</p>
        </div>
        <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center' }}>
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 700 }}>NET REALIZED P&L</span>
            <strong style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '1.15rem', color: totalPnL >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {totalPnL >= 0 ? '+' : ''}{formatCurrency(totalPnL)}
            </strong>
          </div>
        </div>
      </div>

      <div className="calendar-stats-row">
        <div className="journal-stat-box">
          <span className="stat-lbl">TRADING DAYS</span>
          <strong className="stat-val">{calendar.length}</strong>
        </div>
        <div className="journal-stat-box">
          <span className="stat-lbl">WIN DAYS 🏆</span>
          <strong className="stat-val" style={{ color: 'var(--green)' }}>{winDays}</strong>
        </div>
        <div className="journal-stat-box">
          <span className="stat-lbl">LOSS DAYS 🛡️</span>
          <strong className="stat-val" style={{ color: 'var(--red)' }}>{lossDays}</strong>
        </div>
        <div className="journal-stat-box">
          <span className="stat-lbl">TOTAL TRADES</span>
          <strong className="stat-val">{totalTrades}</strong>
        </div>
      </div>

      {calendar.length === 0 ? (
        <div className="trade-empty-state" style={{ padding: '2.5rem 1rem' }}>
          <strong>No historical closed trades recorded</strong>
          <p>Completed trades will automatically generate daily P&L cards and streaks here.</p>
        </div>
      ) : (
        <div className="calendar-grid-container">
          <div className="calendar-tiles-grid">
            {calendar.map((day) => {
              const isWin = day.pnl > 0;
              const isLoss = day.pnl < 0;
              const isSelected = selectedDay?.date === day.date;
              return (
                <div
                  key={day.date}
                  className={`calendar-day-tile ${isWin ? 'win' : isLoss ? 'loss' : 'neutral'} ${isSelected ? 'selected' : ''}`}
                  onClick={() => setSelectedDay(day)}
                >
                  <span className="tile-date">{day.date.slice(5)}</span>
                  <strong className="tile-pnl">{isWin ? '+' : ''}{Math.round(day.pnl)}</strong>
                  <span className="tile-counts">{day.wins}W / {day.losses}L</span>
                </div>
              );
            })}
          </div>

          {selectedDay && (
            <div className="calendar-selected-day-details">
              <div className="day-detail-header">
                <div>
                  <strong style={{ fontSize: '1rem', color: 'var(--text)' }}>Trades on {selectedDay.date}</strong>
                  <span style={{ marginLeft: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    ({selectedDay.total_trades} trades · {selectedDay.wins} Wins, {selectedDay.losses} Losses)
                  </span>
                </div>
                <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', color: selectedDay.pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {selectedDay.pnl >= 0 ? '+' : ''}{formatCurrency(selectedDay.pnl)}
                </strong>
              </div>

              <div className="table-scroll" style={{ marginTop: '0.75rem' }}>
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Symbol</th>
                      <th>Strategy</th>
                      <th>Entry</th>
                      <th>Exit</th>
                      <th>P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedDay.trades.map((t) => (
                      <tr key={t.id}>
                        <td style={{ color: 'var(--text-dim)', fontSize: '0.78rem' }}>{t.time}</td>
                        <td className="mono" style={{ fontWeight: 700 }}>{t.symbol}</td>
                        <td><span className="strategy-chip" style={{ fontSize: '0.7rem', padding: '0.15rem 0.45rem' }}>{t.strategy}</span></td>
                        <td className="mono">₹{t.entry_price.toFixed(2)}</td>
                        <td className="mono">₹{t.exit_price.toFixed(2)}</td>
                        <td className={`mono ${t.pnl >= 0 ? 'positive' : 'negative'}`} style={{ fontWeight: 700 }}>
                          {t.pnl >= 0 ? '+' : ''}{formatCurrency(t.pnl)} ({t.pnl_pct >= 0 ? '+' : ''}{t.pnl_pct.toFixed(2)}%)
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
