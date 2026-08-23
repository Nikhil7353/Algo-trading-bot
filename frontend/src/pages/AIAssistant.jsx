import { useState, useEffect, useRef, useMemo } from 'react';
import { api } from '../api';

const PROMPT_CATEGORIES = [
  { label: '📊 Portfolio & P&L', prompt: 'What is my overall P&L, current capital, and win rate?' },
  { label: '⚡ Top Signals', prompt: "What are today's top strategy signals and why were they triggered?" },
  { label: '💼 Open Positions', prompt: 'Show all my active open positions and trailing risk.' },
  { label: '📰 Market Sentiment', prompt: 'Summarize news sentiment across RELIANCE, TCS, and INFY.' },
  { label: '🛡️ Risk Limits', prompt: 'What are our current stop-loss and daily drawdown rules?' },
];

export default function AIAssistant() {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: "👋 Welcome to the **StockBot AI Command Center**!\n\nI am connected directly to your PostgreSQL trading database, risk engine, and live market feeds. Ask me about your real-time portfolio P&L, active positions, strategy signals, or news sentiment.",
      tools_used: [],
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState({ available: false, model: 'openai/gpt-oss-20b', provider: 'groq' });
  const [sentiments, setSentiments] = useState([]);
  const [refreshingSentiment, setRefreshingSentiment] = useState(false);
  const [sentimentFilter, setSentimentFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [rightTab, setRightTab] = useState('sentiment'); // 'sentiment' | 'journal'
  const [journal, setJournal] = useState(null);
  const [generatingJournal, setGeneratingJournal] = useState(false);
  const [activeNewsModal, setActiveNewsModal] = useState(null);
  const [activeToolModal, setActiveToolModal] = useState(null);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const chatBoxRef = useRef(null);

  useEffect(() => {
    loadStatus();
    loadSentiments();
    loadDailyJournal();
  }, []);

  useEffect(() => {
    const box = chatBoxRef.current;
    if (!box) return;
    box.scrollTop = box.scrollHeight;
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
      setRightTab('journal');
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

  const handleCopy = (text, idx) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const filteredSentiments = useMemo(() => {
    return sentiments.filter((s) => {
      const matchesFilter =
        sentimentFilter === 'ALL' ||
        (sentimentFilter === 'BULLISH' && s.sentiment === 'BULLISH') ||
        (sentimentFilter === 'BEARISH' && s.sentiment === 'BEARISH') ||
        (sentimentFilter === 'NEUTRAL' && s.sentiment === 'NEUTRAL');

      const matchesSearch =
        !searchQuery.trim() ||
        s.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.rationale.toLowerCase().includes(searchQuery.toLowerCase());

      return matchesFilter && matchesSearch;
    });
  }, [sentiments, sentimentFilter, searchQuery]);

  const sentimentCounts = useMemo(() => {
    const counts = { ALL: sentiments.length, BULLISH: 0, BEARISH: 0, NEUTRAL: 0 };
    sentiments.forEach((s) => {
      if (counts[s.sentiment] !== undefined) counts[s.sentiment]++;
    });
    return counts;
  }, [sentiments]);

  const formatInline = (text) => {
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code style="background: rgba(255,255,255,0.08); padding: 0.15rem 0.35rem; border-radius: 4px; font-size: 0.84rem; color: #a5b4fc;">$1</code>');
  };

  const renderContent = (content) => {
    const lines = content.split('\n');
    const elements = [];
    let inTable = false;
    let tableRows = [];

    const flushTable = (key) => {
      if (tableRows.length === 0) return;
      const [headerRow, ...bodyRows] = tableRows;
      const headers = headerRow.split('|').map((h) => h.trim()).filter((h) => h !== '');
      const validBodyRows = bodyRows.filter((r) => !r.includes('---'));

      elements.push(
        <div key={key} style={{ overflowX: 'auto', margin: '0.75rem 0', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'rgba(99, 102, 241, 0.15)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                {headers.map((h, hidx) => (
                  <th key={hidx} style={{ padding: '0.55rem 0.75rem', fontWeight: 600, color: 'var(--text-bright)' }}>
                    <span dangerouslySetInnerHTML={{ __html: formatInline(h) }} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {validBodyRows.map((row, ridx) => {
                const cols = row.split('|').map((c) => c.trim()).filter((c) => c !== '');
                return (
                  <tr key={ridx} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: ridx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                    {cols.map((col, cidx) => (
                      <td key={cidx} style={{ padding: '0.5rem 0.75rem', color: 'var(--text-dim)' }}>
                        <span dangerouslySetInnerHTML={{ __html: formatInline(col) }} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
      tableRows = [];
      inTable = false;
    };

    lines.forEach((line, i) => {
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        inTable = true;
        tableRows.push(line.trim());
        return;
      }

      if (inTable) {
        flushTable(`table-${i}`);
      }

      if (line.startsWith('### ')) {
        elements.push(<h4 key={i} style={{ margin: '0.75rem 0 0.35rem', fontSize: '0.98rem', color: 'var(--accent)' }}>{line.replace('### ', '')}</h4>);
      } else if (line.startsWith('## ')) {
        elements.push(<h3 key={i} style={{ margin: '0.85rem 0 0.4rem', fontSize: '1.08rem', color: 'var(--text-bright)' }}>{line.replace('## ', '')}</h3>);
      } else if (line.startsWith('- ')) {
        elements.push(
          <div key={i} style={{ display: 'flex', gap: '0.45rem', margin: '0.22rem 0', paddingLeft: '0.4rem' }}>
            <span style={{ color: 'var(--accent)' }}>•</span>
            <span dangerouslySetInnerHTML={{ __html: formatInline(line.substring(2)) }} />
          </div>
        );
      } else if (line.startsWith('> ')) {
        elements.push(
          <blockquote key={i} style={{ borderLeft: '3px solid var(--accent)', margin: '0.5rem 0', paddingLeft: '0.75rem', color: 'var(--text-muted)', fontSize: '0.84rem' }}>
            <span dangerouslySetInnerHTML={{ __html: formatInline(line.substring(2)) }} />
          </blockquote>
        );
      } else if (line.trim()) {
        elements.push(
          <p key={i} style={{ margin: '0.35rem 0', lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: formatInline(line) }} />
        );
      }
    });

    if (inTable) {
      flushTable('table-end');
    }

    return elements;
  };

  const getSentimentBadge = (sent) => {
    if (sent === 'BULLISH') return <span className="badge badge-buy" style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }}>🟢 BULLISH</span>;
    if (sent === 'BEARISH') return <span className="badge badge-sell" style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }}>🔴 BEARISH</span>;
    return <span className="badge badge-neutral" style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }}>⚪ NEUTRAL</span>;
  };

  return (
    <div className="page-container" style={{ maxWidth: '1440px', margin: '0 auto', paddingBottom: '2.5rem' }}>
      {/* Top Header Banner */}
      <div className="page-header" style={{ marginBottom: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ margin: '0 0 0.25rem' }}>Copilot</h1>
          <p className="page-subtitle" style={{ margin: 0 }}>
            Desk chat with ledger tools · watchlist sentiment is in the right rail · {status.available ? 'Groq live' : 'local fallback'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleGenerateJournal}
            disabled={generatingJournal}
            style={{ fontSize: '0.8rem' }}
          >
            {generatingJournal ? 'Generating EOD Summary…' : '📝 Generate Daily Journal'}
          </button>
        </div>
      </div>

      {/* Main Grid: Left Chat, Right Analytics Panel */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)', gap: '1.25rem', alignItems: 'start' }}>
        
        {/* LEFT COLUMN: Conversational Agent */}
        <article className="card" style={{ height: '780px', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
          {/* Chat Header */}
          <div
            style={{
              padding: '1rem 1.25rem',
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12) 0%, rgba(56, 189, 248, 0.08) 100%)',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  background: 'linear-gradient(135deg, #c4b5fd 0%, #2dd4bf 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: '1.1rem',
                  boxShadow: '0 4px 12px rgba(99, 102, 241, 0.35)',
                }}
              >
                🤖
              </div>
              <div>
                <strong style={{ fontSize: '0.96rem', color: 'var(--text-bright)' }}>StockBot AI Conversational Agent</strong>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  Model: <code style={{ color: '#818cf8' }}>{status.model}</code> | Provider: <code style={{ color: '#38bdf8' }}>{status.provider}</code>
                </div>
              </div>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setMessages([{ role: 'assistant', content: 'Conversation reset. How can I assist you with your trading operations today?', tools_used: [] }])}
              style={{ fontSize: '0.74rem', padding: '0.3rem 0.65rem' }}
            >
              Clear Chat
            </button>
          </div>

          {/* Messages Container */}
          <div ref={chatBoxRef} style={{ flex: 1, overflowY: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
            {messages.map((m, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                {/* Message Box */}
                <div
                  style={{
                    position: 'relative',
                    maxWidth: '88%',
                    padding: '0.9rem 1.25rem',
                    borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    background: m.role === 'user' ? 'linear-gradient(135deg, #c4b5fd 0%, #2dd4bf 100%)' : 'rgba(255, 255, 255, 0.04)',
                    border: m.role === 'user' ? 'none' : '1px solid rgba(255, 255, 255, 0.08)',
                    boxShadow: m.role === 'user' ? '0 4px 14px rgba(124, 58, 237, 0.3)' : '0 2px 8px rgba(0, 0, 0, 0.2)',
                    color: m.role === 'user' ? '#0b0618' : '#fff',
                    fontSize: '0.88rem',
                  }}
                >
                  {renderContent(m.content)}

                  {/* Copy Button on Assistant Messages */}
                  {m.role === 'assistant' && idx > 0 && (
                    <button
                      type="button"
                      onClick={() => handleCopy(m.content, idx)}
                      style={{
                        position: 'absolute',
                        top: '0.5rem',
                        right: '0.5rem',
                        background: 'rgba(255, 255, 255, 0.08)',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '0.2rem 0.4rem',
                        fontSize: '0.7rem',
                        color: copiedIndex === idx ? 'var(--green)' : 'var(--text-muted)',
                        cursor: 'pointer',
                      }}
                      title="Copy response"
                    >
                      {copiedIndex === idx ? '✓ Copied' : '📋'}
                    </button>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.6rem 0.9rem', background: 'rgba(99, 102, 241, 0.08)', borderRadius: '8px', border: '1px solid rgba(99, 102, 241, 0.2)', width: 'fit-content' }}>
                <span className="mode-pulse"></span>
                <span style={{ fontSize: '0.84rem', color: '#a5b4fc' }}>Executing tools and formulating response…</span>
              </div>
            )}
          </div>

          {/* Categorized Quick Prompts */}
          <div
            style={{
              padding: '0.65rem 1rem',
              background: 'rgba(0, 0, 0, 0.25)',
              borderTop: '1px solid rgba(255, 255, 255, 0.06)',
              display: 'flex',
              gap: '0.45rem',
              overflowX: 'auto',
              whiteSpace: 'nowrap',
              scrollbarWidth: 'none',
            }}
          >
            {PROMPT_CATEGORIES.map((cat, idx) => (
              <button
                key={idx}
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => handleSend(cat.prompt)}
                style={{
                  fontSize: '0.74rem',
                  padding: '0.35rem 0.75rem',
                  borderRadius: '12px',
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  color: 'var(--text-dim)',
                  cursor: 'pointer',
                  flexShrink: 0,
                  transition: 'all 0.2s ease',
                }}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Chat Input Box */}
          <div
            style={{
              padding: '0.9rem 1.25rem',
              borderTop: '1px solid var(--border-color)',
              background: 'rgba(0, 0, 0, 0.35)',
              display: 'flex',
              gap: '0.75rem',
            }}
          >
            <input
              type="text"
              className="input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
              placeholder="Ask about your P&L, open positions, signals, or market sentiment…"
              disabled={loading}
              style={{ flex: 1, padding: '0.7rem 1.1rem', fontSize: '0.9rem', borderRadius: '8px' }}
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => handleSend()}
              disabled={loading || !input.trim()}
              style={{ padding: '0.7rem 1.4rem', fontWeight: 600 }}
            >
              {loading ? '…' : 'Ask AI'}
            </button>
          </div>
        </article>

        {/* RIGHT COLUMN: Tabbed Intelligence Panel */}
        <article className="card" style={{ height: '780px', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
          
          {/* Right Panel Tabs */}
          <div
            style={{
              padding: '0.75rem 1.25rem',
              background: 'rgba(255, 255, 255, 0.02)',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.5rem',
            }}
          >
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                className={`tab ${rightTab === 'sentiment' ? 'active' : ''}`}
                onClick={() => setRightTab('sentiment')}
                style={{ fontSize: '0.82rem', padding: '0.4rem 0.85rem' }}
              >
                📰 Watchlist Sentiment ({sentiments.length})
              </button>
              <button
                type="button"
                className={`tab ${rightTab === 'journal' ? 'active' : ''}`}
                onClick={() => setRightTab('journal')}
                style={{ fontSize: '0.82rem', padding: '0.4rem 0.85rem' }}
              >
                📊 Daily Journal {journal && `(${journal.date})`}
              </button>
            </div>

            {rightTab === 'sentiment' ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleRefreshSentiment}
                disabled={refreshingSentiment}
                style={{ fontSize: '0.74rem', padding: '0.3rem 0.65rem' }}
              >
                {refreshingSentiment ? 'Scanning…' : '🔄 Refresh'}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleGenerateJournal}
                disabled={generatingJournal}
                style={{ fontSize: '0.74rem', padding: '0.3rem 0.65rem' }}
              >
                {generatingJournal ? 'Summarizing…' : '⚡ Refresh Journal'}
              </button>
            )}
          </div>

          {/* TAB 1: WATCHLIST SENTIMENT MATRIX */}
          {rightTab === 'sentiment' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              
              {/* Search & Filter Controls */}
              <div style={{ padding: '0.75rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0, 0, 0, 0.15)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <input
                  type="text"
                  className="input"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="🔍 Search stock ticker (e.g. RELIANCE, TCS)…"
                  style={{ padding: '0.45rem 0.85rem', fontSize: '0.82rem', width: '100%' }}
                />

                {/* Filter Pills */}
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {[
                    { key: 'ALL', label: `All (${sentimentCounts.ALL})` },
                    { key: 'BULLISH', label: `🟢 Bullish (${sentimentCounts.BULLISH})` },
                    { key: 'BEARISH', label: `🔴 Bearish (${sentimentCounts.BEARISH})` },
                    { key: 'NEUTRAL', label: `⚪ Neutral (${sentimentCounts.NEUTRAL})` },
                  ].map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setSentimentFilter(f.key)}
                      style={{
                        fontSize: '0.72rem',
                        padding: '0.2rem 0.55rem',
                        borderRadius: '12px',
                        background: sentimentFilter === f.key ? 'var(--accent)' : 'rgba(255,255,255,0.04)',
                        color: sentimentFilter === f.key ? '#fff' : 'var(--text-dim)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        cursor: 'pointer',
                      }}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sentiment Items Scrollable List */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {filteredSentiments.length === 0 ? (
                  <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.86rem' }}>
                    {searchQuery ? 'No stocks match your search filter.' : 'No sentiment data found. Click "Refresh" above.'}
                  </div>
                ) : (
                  filteredSentiments.map((s, idx) => {
                    const score = Number(s.score || 0);
                    // Score percentage: map -1.0..+1.0 to 0%..100%
                    const scorePct = Math.max(0, Math.min(100, (score + 1.0) * 50));
                    const isBull = s.sentiment === 'BULLISH';
                    const isBear = s.sentiment === 'BEARISH';
                    const barColor = isBull ? '#22c55e' : isBear ? '#ef4444' : '#94a3b8';

                    return (
                      <div
                        key={idx}
                        style={{
                          padding: '0.85rem 1rem',
                          background: 'rgba(255, 255, 255, 0.02)',
                          border: '1px solid rgba(255, 255, 255, 0.06)',
                          borderRadius: '10px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.45rem',
                          transition: 'border-color 0.2s',
                        }}
                      >
                        {/* Top Line */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                            <strong style={{ fontSize: '0.98rem', color: 'var(--text-bright)' }}>{s.symbol}</strong>
                            {getSentimentBadge(s.sentiment)}
                          </div>
                          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: barColor }}>
                            Score: {score > 0 ? `+${score.toFixed(2)}` : score.toFixed(2)}
                          </span>
                        </div>

                        {/* Visual Sentiment Gauge Bar */}
                        <div style={{ position: 'relative', height: '6px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px', overflow: 'hidden' }}>
                          <div
                            style={{
                              position: 'absolute',
                              left: 0,
                              top: 0,
                              height: '100%',
                              width: `${scorePct}%`,
                              background: `linear-gradient(90deg, #ef4444 0%, #eab308 50%, #22c55e 100%)`,
                              borderRadius: '3px',
                            }}
                          />
                        </div>

                        {/* Rationale & Action */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem', marginTop: '0.2rem' }}>
                          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-dim)', lineHeight: 1.35, flex: 1 }}>
                            {s.rationale}
                          </p>

                          {s.headlines && s.headlines.length > 0 && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => setActiveNewsModal(s)}
                              style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem', flexShrink: 0 }}
                            >
                              Headlines ({s.headlines.length})
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 2: DAILY PERFORMANCE JOURNAL */}
          {rightTab === 'journal' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {!journal ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.86rem' }}>
                  No journal generated for today. Click "Refresh Journal" to summarize the session.
                </div>
              ) : (
                <>
                  {/* Summary Metric Cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.65rem' }}>
                    <div style={{ padding: '0.75rem', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Net Realized P&L</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: journal.total_pnl >= 0 ? 'var(--green)' : 'var(--red)', marginTop: '0.15rem' }}>
                        Rs{journal.total_pnl >= 0 ? `+${journal.total_pnl.toFixed(2)}` : journal.total_pnl.toFixed(2)}
                      </div>
                    </div>
                    <div style={{ padding: '0.75rem', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Win Rate</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-bright)', marginTop: '0.15rem' }}>
                        {journal.win_rate.toFixed(1)}%
                      </div>
                    </div>
                    <div style={{ padding: '0.75rem', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Trades (W/L)</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-bright)', marginTop: '0.15rem' }}>
                        {journal.winning_trades}W / {journal.losing_trades}L ({journal.trades_count})
                      </div>
                    </div>
                  </div>

                  {/* Executive Narrative */}
                  <div style={{ background: 'rgba(0, 0, 0, 0.2)', padding: '1rem 1.15rem', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.88rem', color: 'var(--accent)' }}>Executive Narrative</h4>
                    {journal.summary.split('\n').map((p, pidx) => (
                      <p key={pidx} style={{ margin: '0.4rem 0', fontSize: '0.85rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
                        {p}
                      </p>
                    ))}
                  </div>

                  {/* Key Takeaways */}
                  {journal.key_takeaways && journal.key_takeaways.length > 0 && (
                    <div style={{ background: 'rgba(99, 102, 241, 0.04)', padding: '0.85rem 1.15rem', borderRadius: '10px', border: '1px solid rgba(99, 102, 241, 0.15)' }}>
                      <h4 style={{ margin: '0 0 0.4rem', fontSize: '0.84rem', color: '#818cf8' }}>Quantitative Risk Takeaways</h4>
                      <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.82rem', color: 'var(--text-bright)' }}>
                        {journal.key_takeaways.map((k, kidx) => (
                          <li key={kidx} style={{ margin: '0.3rem 0' }}>{k}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </article>
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
                <h2>📰 {activeNewsModal.symbol} Tracked Headlines</h2>
                <p>Real-time news feeds analyzed by Groq AI NLP model.</p>
              </div>
              <button type="button" className="btn btn-icon btn-sm" onClick={() => setActiveNewsModal(null)}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {activeNewsModal.headlines.map((h, idx) => (
                <div key={idx} style={{ padding: '0.8rem', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-bright)', marginBottom: '0.3rem' }}>
                    {h.title}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                    <span>{h.date}</span>
                    {h.link && (
                      <a href={h.link} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
                        Read Original Article ↗
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tool Inspection Modal */}
      {activeToolModal && (
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
          onClick={() => setActiveToolModal(null)}
        >
          <div
            className="card"
            style={{ width: '560px', maxWidth: '100%', maxHeight: '80vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-heading" style={{ marginBottom: '1rem' }}>
              <div>
                <h2>⚡ Tool Execution Trace: <code>{activeToolModal.tool}()</code></h2>
                <p>Live parameters and PostgreSQL database response inspected by LLM.</p>
              </div>
              <button type="button" className="btn btn-icon btn-sm" onClick={() => setActiveToolModal(null)}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div>
                <strong style={{ fontSize: '0.82rem', color: 'var(--accent)' }}>Arguments Passed:</strong>
                <pre style={{ background: 'rgba(0,0,0,0.4)', padding: '0.75rem', borderRadius: '6px', fontSize: '0.78rem', color: '#a5b4fc', overflowX: 'auto', margin: '0.3rem 0 0' }}>
                  {JSON.stringify(activeToolModal.args || {}, null, 2)}
                </pre>
              </div>

              <div>
                <strong style={{ fontSize: '0.82rem', color: 'var(--accent)' }}>Database Result Preview:</strong>
                <pre style={{ background: 'rgba(0,0,0,0.4)', padding: '0.75rem', borderRadius: '6px', fontSize: '0.78rem', color: '#38bdf8', overflowX: 'auto', margin: '0.3rem 0 0', whiteSpace: 'pre-wrap' }}>
                  {activeToolModal.result_preview || JSON.stringify(activeToolModal.result || {}, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
