import { useState, useEffect, useRef } from 'react';
import { api } from '../api';

const QUICK_PROMPTS = [
  "What is my overall P&L and win rate?",
  "Analyze open positions and trailing risk",
  "Summarize today's strategy signals",
  "Show latest sentiment for RELIANCE & TCS",
  "How are our daily drawdown limits holding up?",
];

export default function AIAssistant() {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: "👋 Welcome to the **StockBot AI Command Center**!\n\nI am connected directly to your trading database, risk engine, and market data feeds. You can query me about your live positions, past trade logs, strategy setups, or stock news sentiment in natural language.",
      tools_used: [],
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState({ available: false, model: 'llama-3.3-70b-versatile', provider: 'groq' });
  const [sentiments, setSentiments] = useState([]);
  const [refreshingSentiment, setRefreshingSentiment] = useState(false);
  const [journal, setJournal] = useState(null);
  const [generatingJournal, setGeneratingJournal] = useState(false);
  const [activeNewsModal, setActiveNewsModal] = useState(null);
  const chatEndRef = useRef(null);

  useEffect(() => {
    loadStatus();
    loadSentiments();
    loadDailyJournal();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadStatus = () => {
    api.getAssistantStatus()
      .then((data) => setStatus(data))
      .catch(() => {});
  };

  const loadSentiments = () => {
    api.getSentiment()
      .then((data) => setSentiments(Array.isArray(data) ? data : []))
      .catch(() => {});
  };

  const loadDailyJournal = () => {
    api.getDailySummary()
      .then((data) => {
        if (data.latest) setJournal(data.latest);
        else if (data.journals && data.journals.length > 0) setJournal(data.journals[0]);
      })
      .catch(() => {});
  };

  const handleRefreshSentiment = async () => {
    setRefreshingSentiment(true);
    try {
      await api.refreshSentiment();
      await loadSentiments();
    } catch (err) {
      console.error(err);
    } finally {
      setRefreshingSentiment(false);
    }
  };

  const handleGenerateJournal = async () => {
    setGeneratingJournal(true);
    try {
      const res = await api.generateDailySummary(true);
      if (res.journal) setJournal(res.journal);
    } catch (err) {
      console.error(err);
    } finally {
      setGeneratingJournal(false);
    }
  };

  const handleSend = async (userText = null) => {
    const textToSend = typeof userText === 'string' ? userText : input;
    if (!textToSend.trim() || loading) return;

    const userMsg = { role: 'user', content: textToSend.trim() };
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInput('');
    setLoading(true);

    try {
      const historyPayload = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await api.chatAssistant(textToSend.trim(), historyPayload);
      setMessages([
        ...newHistory,
        {
          role: 'assistant',
          content: res.response || 'No response text received.',
          tools_used: res.tools_used || [],
        },
      ]);
    } catch (err) {
      setMessages([
        ...newHistory,
        {
          role: 'assistant',
          content: `⚠️ **AI Service Communication Error:** ${err.message || 'Check network connection or API server.'}`,
          tools_used: [],
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const formatInline = (text) => {
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code style="background: rgba(255,255,255,0.08); padding: 0.15rem 0.35rem; border-radius: 4px; font-size: 0.84rem;">$1</code>');
  };

  const renderContent = (content) => {
    return content.split('\n').map((line, i) => {
      if (line.startsWith('### ')) {
        return <h4 key={i} style={{ margin: '0.75rem 0 0.4rem', fontSize: '1rem', color: 'var(--accent)' }}>{line.replace('### ', '')}</h4>;
      }
      if (line.startsWith('- ')) {
        return (
          <div key={i} style={{ display: 'flex', gap: '0.4rem', margin: '0.25rem 0', paddingLeft: '0.5rem' }}>
            <span>•</span>
            <span dangerouslySetInnerHTML={{ __html: formatInline(line.substring(2)) }} />
          </div>
        );
      }
      if (line.startsWith('> ')) {
        return (
          <blockquote key={i} style={{ borderLeft: '3px solid var(--accent)', margin: '0.5rem 0', paddingLeft: '0.75rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            <span dangerouslySetInnerHTML={{ __html: formatInline(line.substring(2)) }} />
          </blockquote>
        );
      }
      return (
        <p key={i} style={{ margin: '0.4rem 0', lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: formatInline(line) }} />
      );
    });
  };

  const getSentimentBadge = (sent) => {
    if (sent === 'BULLISH') {
      return <span className="badge badge-buy" style={{ fontSize: '0.72rem' }}>🟢 BULLISH</span>;
    }
    if (sent === 'BEARISH') {
      return <span className="badge badge-sell" style={{ fontSize: '0.72rem' }}>🔴 BEARISH</span>;
    }
    return <span className="badge badge-neutral" style={{ fontSize: '0.72rem' }}>⚪ NEUTRAL</span>;
  };

  return (
    <div className="page-container" style={{ maxWidth: '1440px', margin: '0 auto', paddingBottom: '2.5rem' }}>
      {/* Top Banner */}
      <div className="page-header" style={{ marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            ✨ AI Assistant & Intelligence Hub
            <span className="badge" style={{ fontSize: '0.72rem', background: status.available ? 'rgba(34, 197, 94, 0.15)' : 'rgba(234, 179, 8, 0.15)', color: status.available ? 'var(--green)' : '#eab308', border: `1px solid ${status.available ? 'rgba(34, 197, 94, 0.3)' : 'rgba(234, 179, 8, 0.3)'}` }}>
              {status.available ? '⚡ GROQ ENGINE ACTIVE' : '⚠️ LOCAL FALLBACK MODE'}
            </span>
          </h1>
          <p className="page-desc">
            Natural language conversational assistant with real database tool calling, watchlist sentiment feeds, and automated daily journals.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleGenerateJournal}
            disabled={generatingJournal}
          >
            {generatingJournal ? 'Generating EOD Summary…' : '📝 Generate Daily Journal'}
          </button>
        </div>
      </div>

      {/* Main Grid: Left Chat, Right Analytics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.35fr) minmax(0, 1fr)', gap: '1.25rem', alignItems: 'start' }}>
        
        {/* LEFT COLUMN: AI Chat Assistant */}
        <article className="card" style={{ height: '760px', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
          {/* Chat Header */}
          <div
            style={{
              padding: '1rem 1.25rem',
              background: 'rgba(255, 255, 255, 0.02)',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <span style={{ fontSize: '1.2rem' }}>🤖</span>
              <div>
                <strong style={{ fontSize: '0.95rem' }}>StockBot AI Conversational Agent</strong>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  Model: <code>{status.model}</code> | Provider: <code>{status.provider}</code>
                </div>
              </div>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setMessages([{ role: 'assistant', content: 'Conversation reset. How can I assist you with your trading operations today?', tools_used: [] }])}
              style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem' }}
            >
              Clear Chat
            </button>
          </div>

          {/* Messages Area */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {messages.map((m, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                {/* Tool Executions Badge */}
                {m.tools_used && m.tools_used.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.4rem' }}>
                    {m.tools_used.map((t, tidx) => (
                      <span
                        key={tidx}
                        style={{
                          fontSize: '0.7rem',
                          background: 'rgba(99, 102, 241, 0.15)',
                          color: '#818cf8',
                          border: '1px solid rgba(99, 102, 241, 0.3)',
                          borderRadius: '4px',
                          padding: '0.15rem 0.45rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                        }}
                      >
                        ⚡ <code>{t.tool}()</code>
                      </span>
                    ))}
                  </div>
                )}

                {/* Message Bubble */}
                <div
                  style={{
                    maxWidth: '85%',
                    padding: '0.85rem 1.15rem',
                    borderRadius: m.role === 'user' ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
                    background: m.role === 'user' ? 'linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%)' : 'rgba(255, 255, 255, 0.04)',
                    border: m.role === 'user' ? 'none' : '1px solid rgba(255, 255, 255, 0.08)',
                    color: '#fff',
                    fontSize: '0.88rem',
                  }}
                >
                  {renderContent(m.content)}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.8rem', color: 'var(--text-muted)', fontSize: '0.84rem' }}>
                <span className="mode-pulse"></span>
                <span>Executing tools and formulating response…</span>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Quick Prompts Bar */}
          <div
            style={{
              padding: '0.6rem 1rem',
              background: 'rgba(0, 0, 0, 0.2)',
              borderTop: '1px solid rgba(255, 255, 255, 0.05)',
              display: 'flex',
              gap: '0.45rem',
              overflowX: 'auto',
              whiteSpace: 'nowrap',
              scrollbarWidth: 'none',
            }}
          >
            {QUICK_PROMPTS.map((qp, idx) => (
              <button
                key={idx}
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => handleSend(qp)}
                style={{
                  fontSize: '0.74rem',
                  padding: '0.3rem 0.65rem',
                  borderRadius: '12px',
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  color: 'var(--text-dim)',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                {qp}
              </button>
            ))}
          </div>

          {/* Chat Input */}
          <div
            style={{
              padding: '0.85rem 1.15rem',
              borderTop: '1px solid var(--border-color)',
              background: 'rgba(0, 0, 0, 0.3)',
              display: 'flex',
              gap: '0.65rem',
            }}
          >
            <input
              type="text"
              className="input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
              placeholder="Ask anything about trades, P&L, signals, or market sentiment…"
              disabled={loading}
              style={{ flex: 1, padding: '0.65rem 1rem', fontSize: '0.88rem' }}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => handleSend()}
              disabled={loading || !input.trim()}
              style={{ padding: '0.65rem 1.25rem' }}
            >
              {loading ? '…' : 'Ask AI'}
            </button>
          </div>
        </article>

        {/* RIGHT COLUMN: Sentiment Matrix + Daily Journal */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          
          {/* 1. Watchlist News Sentiment Card */}
          <article className="card">
            <div className="panel-heading">
              <div>
                <h2>📰 Watchlist News & Sentiment Matrix</h2>
                <p>Real-time NLP sentiment scoring & headline tracking across watchlist equities.</p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleRefreshSentiment}
                disabled={refreshingSentiment}
                style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem' }}
              >
                {refreshingSentiment ? 'Scanning Headlines…' : '🔄 Refresh Feeds'}
              </button>
            </div>

            {sentiments.length === 0 ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                No sentiment data available. Click "Refresh Feeds" to fetch news headlines for your watchlist.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginTop: '0.5rem' }}>
                {sentiments.map((s, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '0.75rem 1rem',
                      background: 'rgba(255, 255, 255, 0.02)',
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.75rem',
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                        <strong style={{ fontSize: '0.92rem' }}>{s.symbol}</strong>
                        {getSentimentBadge(s.sentiment)}
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          Score: {s.score > 0 ? `+${s.score.toFixed(2)}` : s.score.toFixed(2)}
                        </span>
                      </div>
                      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-dim)', lineHeight: 1.35 }}>
                        {s.rationale}
                      </p>
                    </div>

                    {s.headlines && s.headlines.length > 0 && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setActiveNewsModal(s)}
                        style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem', flexShrink: 0 }}
                      >
                        Headlines ({s.headlines.length})
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </article>

          {/* 2. Daily Performance Journal Card */}
          <article className="card">
            <div className="panel-heading">
              <div>
                <h2>📊 AI Daily Trading Journal</h2>
                <p>Executive performance review & risk takeaway log.</p>
              </div>
              {journal && (
                <span className="badge" style={{ fontSize: '0.72rem', background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8' }}>
                  {journal.date}
                </span>
              )}
            </div>

            {!journal ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                No journal generated for today. Click "Generate Daily Journal" above to summarize today's session.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                {/* Metric Summary Bar */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.65rem' }}>
                  <div style={{ padding: '0.65rem 0.85rem', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '6px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Net Realized P&L</div>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: journal.total_pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      Rs{journal.total_pnl >= 0 ? `+${journal.total_pnl.toFixed(2)}` : journal.total_pnl.toFixed(2)}
                    </div>
                  </div>
                  <div style={{ padding: '0.65rem 0.85rem', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '6px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Win Rate</div>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-bright)' }}>
                      {journal.win_rate.toFixed(1)}%
                    </div>
                  </div>
                  <div style={{ padding: '0.65rem 0.85rem', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '6px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Trades (W/L)</div>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-bright)' }}>
                      {journal.winning_trades}W / {journal.losing_trades}L ({journal.trades_count})
                    </div>
                  </div>
                </div>

                {/* Narrative Summary */}
                <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', lineHeight: 1.5, background: 'rgba(0, 0, 0, 0.15)', padding: '0.85rem 1rem', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.04)' }}>
                  {journal.summary.split('\n').map((p, pidx) => (
                    <p key={pidx} style={{ margin: '0.35rem 0' }}>{p}</p>
                  ))}
                </div>

                {/* Key Takeaways */}
                {journal.key_takeaways && journal.key_takeaways.length > 0 && (
                  <div>
                    <h4 style={{ margin: '0.4rem 0 0.3rem', fontSize: '0.82rem', color: 'var(--accent)' }}>Key Takeaways & Discipline</h4>
                    <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                      {journal.key_takeaways.map((k, kidx) => (
                        <li key={kidx} style={{ margin: '0.2rem 0' }}>{k}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </article>
        </div>
      </div>

      {/* News Modal */}
      {activeNewsModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1.5rem',
          }}
          onClick={() => setActiveNewsModal(null)}
        >
          <div
            className="card"
            style={{ width: '540px', maxWidth: '100%', maxHeight: '80vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-heading" style={{ marginBottom: '1rem' }}>
              <div>
                <h2>📰 {activeNewsModal.symbol} Headlines</h2>
                <p>Tracked news articles analyzed by AI.</p>
              </div>
              <button type="button" className="btn btn-icon btn-sm" onClick={() => setActiveNewsModal(null)}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {activeNewsModal.headlines.map((h, idx) => (
                <div key={idx} style={{ padding: '0.75rem', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '6px' }}>
                  <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-bright)', marginBottom: '0.2rem' }}>
                    {h.title}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    <span>{h.date}</span>
                    {h.link && (
                      <a href={h.link} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                        Read Article ↗
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
