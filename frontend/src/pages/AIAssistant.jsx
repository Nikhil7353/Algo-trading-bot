import { useState, useEffect, useRef, useMemo } from 'react';
import { api } from '../api';

const PROMPT_CATEGORIES = [
  { label: '📊 Portfolio & P&L', prompt: 'What is my overall P&L, current capital, and win rate?' },
  { label: '⚡ Top Signals', prompt: "What are today's top strategy signals and why were they triggered?" },
  { label: '💼 Open Positions', prompt: 'Show all my active open positions and trailing risk.' },
  { label: '📰 Market Sentiment', prompt: 'Summarize news sentiment across RELIANCE, TCS, and INFY.' },
  { label: '🛡️ Risk Limits', prompt: 'What are our current stop-loss and daily drawdown rules?' },
];

const CAPABILITY_CARDS = [
  {
    icon: '📊',
    title: 'Portfolio & P&L Audit',
    desc: 'Get real-time capital, unrealized & realized returns, and lot exposure.',
    prompt: 'What is my overall P&L, current capital, and win rate?',
  },
  {
    icon: '⚡',
    title: 'Scan Breakout Signals',
    desc: 'Audit all active algorithms for EMA, RSI, and VWAP entry triggers.',
    prompt: "What are today's top strategy signals and why were they triggered?",
  },
  {
    icon: '📰',
    title: 'Market Sentiment Digest',
    desc: 'Synthesize live financial headlines into institutional sentiment scores.',
    prompt: 'Summarize news sentiment across RELIANCE, TCS, and INFY.',
  },
  {
    icon: '🛡️',
    title: 'Risk Envelope Check',
    desc: 'Review stop-loss, take-profit R:R ratio, and daily loss circuit breakers.',
    prompt: 'What are our current stop-loss and daily drawdown rules?',
  },
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
  const [status, setStatus] = useState({ available: false, model: 'llama-3.3-70b-versatile', provider: 'groq' });
  // Always display friendly model label regardless of raw backend model string
  const modelLabel = 'LLaMA 3.3 70B · Groq Engine';
  const [sentiments, setSentiments] = useState([]);
  const [refreshingSentiment, setRefreshingSentiment] = useState(false);
  const [sentimentFilter, setSentimentFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [rightTab, setRightTab] = useState('sentiment'); // 'sentiment' | 'journal'
  const [journal, setJournal] = useState(null);
  const [generatingJournal, setGeneratingJournal] = useState(false);
  const [activeNewsModal, setActiveNewsModal] = useState(null);
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
  }, [messages, loading]);

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

  const bullishCount = sentiments.filter((s) => s.sentiment === 'BULLISH').length;
  const bearishCount = sentiments.filter((s) => s.sentiment === 'BEARISH').length;
  const neutralCount = sentiments.filter((s) => s.sentiment === 'NEUTRAL').length;

  // Parses inline markdown tokens (**bold**, *italic*, `code`, plain text)
  const parseInline = (text) => {
    if (!text) return null;
    const parts = [];
    // Regex: **bold**, *italic*, `code`
    const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
      const token = match[0];
      if (token.startsWith('**') && token.endsWith('**')) {
        parts.push(<strong key={match.index} style={{ fontWeight: 700, color: '#ffffff' }}>{token.slice(2, -2)}</strong>);
      } else if (token.startsWith('`') && token.endsWith('`')) {
        parts.push(<code key={match.index} style={{ background: 'rgba(196,181,253,0.15)', color: '#2dd4bf', padding: '0.1em 0.35em', borderRadius: '4px', fontSize: '0.82em', fontFamily: 'var(--font-mono)' }}>{token.slice(1, -1)}</code>);
      } else if (token.startsWith('*') && token.endsWith('*')) {
        parts.push(<em key={match.index} style={{ color: '#c4b5fd', fontStyle: 'italic' }}>{token.slice(1, -1)}</em>);
      } else {
        parts.push(token);
      }
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) parts.push(text.slice(lastIndex));
    return parts;
  };

  const renderContent = (content) => {
    if (!content) return null;
    const lines = content.split('\n');
    const elements = [];
    let currentTable = null;
    let listItems = [];
    let listType = null; // 'ul' | 'ol'

    const flushList = (key) => {
      if (listItems.length > 0) {
        const Tag = listType === 'ol' ? 'ol' : 'ul';
        elements.push(
          <Tag key={key} style={{ margin: '0.4rem 0 0.4rem 1.4rem', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {listItems}
          </Tag>
        );
        listItems = [];
        listType = null;
      }
    };

    const flushTable = (key) => {
      if (currentTable) {
        elements.push(
          <div key={key} style={{ overflowX: 'auto', margin: '0.65rem 0' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', overflow: 'hidden' }}>
              <thead>
                <tr style={{ background: 'rgba(196,181,253,0.1)' }}>
                  {currentTable.headers.map((h, i) => (
                    <th key={i} style={{ padding: '0.45rem 0.75rem', textAlign: 'left', color: '#c4b5fd', fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>{parseInline(h.trim())}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {currentTable.rows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    {r.map((c, j) => (
                      <td key={j} style={{ padding: '0.4rem 0.75rem', color: '#e2d9f8' }}>{parseInline(c.trim())}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        currentTable = null;
      }
    };

    lines.forEach((line, idx) => {
      // Pipe table rows
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        flushList(`list-${idx}`);
        const parts = line.split('|').filter((_, i, arr) => i > 0 && i < arr.length - 1);
        if (parts.every((p) => p.trim().match(/^:?-+:?$/))) return; // separator row
        if (!currentTable) currentTable = { headers: parts, rows: [] };
        else currentTable.rows.push(parts);
        return;
      }

      flushTable(`table-${idx}`);

      // Horizontal rule
      if (line.trim().match(/^-{3,}$/) || line.trim().match(/^={3,}$/)) {
        flushList(`list-${idx}`);
        elements.push(<hr key={idx} style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.1)', margin: '0.6rem 0' }} />);
        return;
      }

      // Headings
      if (line.startsWith('### ')) {
        flushList(`list-${idx}`);
        elements.push(<h3 key={idx} style={{ margin: '0.75rem 0 0.35rem', fontSize: '0.96rem', color: '#c4b5fd', fontWeight: 700 }}>{parseInline(line.slice(4))}</h3>);
        return;
      }
      if (line.startsWith('## ')) {
        flushList(`list-${idx}`);
        elements.push(<h2 key={idx} style={{ margin: '0.85rem 0 0.4rem', fontSize: '1.05rem', color: '#2dd4bf', fontWeight: 700 }}>{parseInline(line.slice(3))}</h2>);
        return;
      }
      if (line.startsWith('# ')) {
        flushList(`list-${idx}`);
        elements.push(<h1 key={idx} style={{ margin: '1rem 0 0.5rem', fontSize: '1.2rem', color: '#ffffff', fontWeight: 700 }}>{parseInline(line.slice(2))}</h1>);
        return;
      }

      // Blockquote
      if (line.startsWith('> ')) {
        flushList(`list-${idx}`);
        elements.push(
          <blockquote key={idx} style={{ borderLeft: '3px solid #c4b5fd', paddingLeft: '0.75rem', margin: '0.3rem 0', color: '#b3a6d4', fontSize: '0.84rem', lineHeight: 1.4 }}>
            {parseInline(line.slice(2))}
          </blockquote>
        );
        return;
      }

      // Ordered list  (1. 2. 3.)
      const olMatch = line.match(/^(\d+)\. (.+)/);
      if (olMatch) {
        if (listType !== 'ol') { flushList(`list-${idx}`); listType = 'ol'; }
        listItems.push(
         <li key={idx} style={{ fontSize: '0.86rem', color: 'inherit', lineHeight: 1.45 }}>
            {parseInline(olMatch[2])}
          </li>
        );
        return;
      }

      // Unordered list (- or *)
      if (line.match(/^[\-\*] /)) {
        if (listType !== 'ul') { flushList(`list-${idx}`); listType = 'ul'; }
        listItems.push(
         <li key={idx} style={{ fontSize: '0.86rem', color: 'inherit', lineHeight: 1.45 }}>
            {parseInline(line.slice(2))}
          </li>
        );
        return;
      }

      // Empty line
      if (line.trim() === '') {
        flushList(`list-${idx}`);
        elements.push(<div key={idx} style={{ height: '0.3rem' }} />);
        return;
      }

      // Plain paragraph
      flushList(`list-${idx}`);
      elements.push(
         <p key={idx} style={{ margin: '0.2rem 0', fontSize: '0.86rem', color: 'inherit', lineHeight: 1.5 }}>
          {parseInline(line)}
        </p>
      );
    });

    flushList('list-end');
    flushTable('table-end');
    return elements;
  };

  const getSentimentBadge = (sent) => {
    if (sent === 'BULLISH') return <span className="badge badge-success" style={{ fontSize: '0.68rem', padding: '0.15rem 0.5rem' }}>🟢 BULLISH</span>;
    if (sent === 'BEARISH') return <span className="badge badge-danger" style={{ fontSize: '0.68rem', padding: '0.15rem 0.5rem' }}>🔴 BEARISH</span>;
    return <span className="badge" style={{ fontSize: '0.68rem', padding: '0.15rem 0.5rem', background: 'rgba(255,255,255,0.08)', color: '#b3a6d4' }}>⚪ NEUTRAL</span>;
  };

  return (
    <div className="page-container" style={{ width: '100%' }}>
      {/* Top Header Banner */}
      <header className="page-heading" style={{ marginBottom: '12px' }}>
        <div>
          <h1>AI Copilot</h1>
          <p className="page-subtitle">Desk chat with database tools &amp; live watchlist sentiment</p>
        </div>
        <div className="header-chips">
          <span className="chip mode-chip">
            <i className="mode-pulse" /> Groq LLaMA 3.3 70B · Live
          </span>
          <button
            type="button"
            className="chip refresh-chip"
            onClick={handleGenerateJournal}
            disabled={generatingJournal}
          >
            {generatingJournal ? 'Generating EOD Summary…' : '📝 Generate Daily Journal'}
          </button>
        </div>
      </header>

      {/* Main Grid: Left Chat, Right Analytics Panel */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.35fr) minmax(360px, 1fr)', gap: '14px', alignItems: 'start' }}>
        
        {/* LEFT COLUMN: Conversational Agent */}
        <article className="card" style={{ height: 'calc(100vh - 140px)', minHeight: '520px', maxHeight: '760px', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden', borderRadius: '18px' }}>
          {/* Chat Header */}
          <div
            style={{
              padding: '10px 16px',
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(45, 212, 191, 0.08) 100%)',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '10px',
                  background: 'linear-gradient(135deg, #c4b5fd 0%, #2dd4bf 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1rem',
                  boxShadow: '0 4px 12px rgba(124, 58, 237, 0.35)',
                }}
              >
                ✨
              </div>
              <div>
                <strong style={{ fontSize: '0.92rem', color: '#ffffff' }}>StockBot AI Copilot</strong>
                <div style={{ fontSize: '0.72rem', color: '#8b7db0' }}>
                  Model: <code style={{ color: '#2dd4bf' }}>{modelLabel}</code> · <span style={{ color: '#4ade80' }}>⬤ Connected to DB</span>
                </div>
              </div>
            </div>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setMessages([{ role: 'assistant', content: 'Conversation reset. How can I assist you with your trading operations today?', tools_used: [] }])}
              style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem' }}
            >
              Clear Chat
            </button>
          </div>

          {/* Messages Container */}
          <div ref={chatBoxRef} style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
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
                    padding: '10px 14px',
                    borderRadius: m.role === 'user' ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
                    background: m.role === 'user'
                      ? 'linear-gradient(135deg, #7c3aed 0%, #0ea5e9 100%)'
                      : 'rgba(255, 255, 255, 0.05)',
                    border: m.role === 'user' ? '1px solid rgba(139,92,246,0.4)' : '1px solid rgba(255, 255, 255, 0.1)',
                    boxShadow: m.role === 'user' ? '0 4px 18px rgba(124, 58, 237, 0.45)' : '0 2px 8px rgba(0, 0, 0, 0.3)',
                    color: m.role === 'user' ? '#ffffff' : '#e2d9f8',
                    fontSize: '0.86rem',
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
                        top: '0.4rem',
                        right: '0.4rem',
                        background: 'rgba(255, 255, 255, 0.08)',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '0.15rem 0.35rem',
                        fontSize: '0.68rem',
                        color: copiedIndex === idx ? '#4ade80' : '#8b7db0',
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

            {/* Empty State Capability Cards Grid */}
            {messages.length <= 1 && !loading && (
              <div style={{ marginTop: '10px', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                {CAPABILITY_CARDS.map((card, cIdx) => (
                  <div
                    key={cIdx}
                    className="ai-cap-card"
                    onClick={() => handleSend(card.prompt)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && handleSend(card.prompt)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                      <span className="cap-icon">{card.icon}</span>
                      <strong className="cap-title">{card.title}</strong>
                    </div>
                    <p className="cap-desc">{card.desc}</p>
                  </div>
                ))}
              </div>
            )}

            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0.85rem', background: 'rgba(99, 102, 241, 0.1)', borderRadius: '8px', border: '1px solid rgba(99, 102, 241, 0.25)', width: 'fit-content' }}>
                <span className="mode-pulse"></span>
                <span style={{ fontSize: '0.8rem', color: '#c4b5fd' }}>Executing tool queries &amp; formulating quant analysis…</span>
              </div>
            )}
          </div>

          {/* Categorized Quick Prompts */}
          <div
            style={{
              padding: '6px 12px',
              background: 'rgba(0, 0, 0, 0.3)',
              borderTop: '1px solid rgba(255, 255, 255, 0.06)',
              display: 'flex',
              gap: '6px',
              overflowX: 'auto',
              whiteSpace: 'nowrap',
              scrollbarWidth: 'none',
            }}
          >
            {PROMPT_CATEGORIES.map((cat, idx) => (
              <button
                key={idx}
                type="button"
                className="stock-chip-btn"
                onClick={() => handleSend(cat.prompt)}
                style={{ fontSize: '0.72rem', padding: '0.2rem 0.6rem' }}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Chat Input Box */}
          <div
            style={{
              padding: '10px 14px',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              background: 'rgba(0, 0, 0, 0.4)',
              display: 'flex',
              gap: '8px',
            }}
          >
            <input
              type="text"
              className="scanner-main-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
              placeholder="Ask about your P&amp;L, open positions, signals, or market sentiment…"
              disabled={loading}
              style={{
                flex: 1,
                padding: '0.6rem 1rem',
                fontSize: '0.88rem',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '10px',
              }}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => handleSend()}
              disabled={loading || !input.trim()}
              style={{ padding: '0 1.25rem', fontWeight: 700 }}
            >
              Ask AI
            </button>
          </div>
        </article>

        {/* RIGHT COLUMN: Market Sentiment & Daily Journal Hub */}
        <article className="card" style={{ height: 'calc(100vh - 140px)', minHeight: '520px', maxHeight: '760px', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden', borderRadius: '18px' }}>
          {/* Header Tabs */}
          <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0, 0, 0, 0.2)' }}>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                className={`tab ${rightTab === 'sentiment' ? 'active' : ''}`}
                onClick={() => setRightTab('sentiment')}
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.8rem' }}
              >
                📰 Watchlist Sentiment ({sentiments.length})
              </button>
              <button
                type="button"
                className={`tab ${rightTab === 'journal' ? 'active' : ''}`}
                onClick={() => setRightTab('journal')}
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.8rem' }}
              >
                📊 Daily Journal
              </button>
            </div>
            {rightTab === 'sentiment' && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={handleRefreshSentiment}
                disabled={refreshingSentiment}
                style={{ fontSize: '0.74rem', padding: '0.25rem 0.6rem' }}
              >
                {refreshingSentiment ? 'Scraping…' : '🔄 Refresh'}
              </button>
            )}
          </div>

          {/* TAB 1: WATCHLIST SENTIMENT */}
          {rightTab === 'sentiment' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '12px 14px' }}>
              {/* Search & Filter bar */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <input
                  type="text"
                  placeholder="Filter ticker (e.g. RELIANCE, TCS)…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="input mono"
                  style={{ fontSize: '0.78rem', padding: '0.35rem 0.75rem', flex: 1 }}
                />
              </div>

              {/* Sentiment Summary Meter */}
              <div style={{ display: 'flex', gap: '4px', marginBottom: '10px', flexWrap: 'wrap' }}>
                {[['ALL', `All (${sentiments.length})`], ['BULLISH', `🟢 ${bullishCount} Bullish`], ['BEARISH', `🔴 ${bearishCount} Bearish`], ['NEUTRAL', `⚪ ${neutralCount} Neutral`]].map(([f, label]) => (
                  <button
                    key={f}
                    type="button"
                    className={`chip-sm${sentimentFilter === f ? ' active' : ''}`}
                    onClick={() => setSentimentFilter(f)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Scrollable Sentiment List */}
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '4px' }}>
                {filteredSentiments.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '2rem', color: '#8b7db0', fontSize: '0.84rem' }}>
                    No matching sentiment records found.
                  </div>
                ) : (
                  filteredSentiments.map((s) => {
                    const score = Number(s.score || 0);
                    return (
                      <div
                        key={s.symbol}
                        style={{
                          padding: '10px 12px',
                          borderRadius: '12px',
                          background: 'rgba(255, 255, 255, 0.03)',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <strong className="mono" style={{ fontSize: '0.94rem', color: '#ffffff' }}>{s.symbol}</strong>
                            {getSentimentBadge(s.sentiment)}
                          </div>
                          <span className="mono" style={{ fontSize: '0.74rem', color: score > 0 ? '#4ade80' : score < 0 ? '#fb7185' : '#8b7db0' }}>
                            Score: {score > 0 ? `+${score.toFixed(2)}` : score.toFixed(2)}
                          </span>
                        </div>

                        {/* Progress Bar */}
                        <div style={{ width: '100%', height: '4px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '99px', overflow: 'hidden' }}>
                          <div
                            style={{
                              height: '100%',
                              width: `${Math.min(100, Math.max(10, ((score + 1) / 2) * 100))}%`,
                              background: score > 0 ? '#4ade80' : score < 0 ? '#fb7185' : '#fbbf24',
                            }}
                          />
                        </div>

                        <p style={{ fontSize: '0.74rem', color: '#b3a6d4', margin: 0, lineHeight: 1.35 }}>
                          {s.rationale}
                        </p>

                        {s.news && s.news.length > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              onClick={() => setActiveNewsModal(s)}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: '#2dd4bf',
                                fontSize: '0.7rem',
                                cursor: 'pointer',
                                padding: 0,
                                fontWeight: 600,
                              }}
                            >
                              Headlines ({s.news.length}) ↗
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 2: DAILY JOURNAL */}
          {rightTab === 'journal' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px' }}>
              {journal ? (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <h2 style={{ fontSize: '0.96rem', margin: 0 }}>Executive EOD Briefing</h2>
                    <span className="mono" style={{ fontSize: '0.74rem', color: '#8b7db0' }}>{journal.date}</span>
                  </div>
                  <div style={{ fontSize: '0.82rem', color: '#e2d9f8', lineHeight: 1.45 }}>
                    {renderContent(journal.summary)}
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: '#8b7db0' }}>
                  <p>No Daily Journal generated yet today.</p>
                  <button type="button" className="btn btn-primary btn-sm" onClick={handleGenerateJournal} disabled={generatingJournal} style={{ marginTop: '8px' }}>
                    {generatingJournal ? 'Generating Briefing…' : 'Generate Daily Journal'}
                  </button>
                </div>
              )}
            </div>
          )}
        </article>
      </div>

      {/* News Modal */}
      {activeNewsModal && (
        <div className="trade-modal-backdrop" onClick={() => setActiveNewsModal(null)}>
          <div className="trade-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>{activeNewsModal.symbol} Market Headlines</h2>
                <p>Scraped financial news items used for sentiment calculation</p>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setActiveNewsModal(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ maxHeight: '340px', overflowY: 'auto' }}>
              {(activeNewsModal.news || []).map((n, i) => (
                <div key={i} style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <strong style={{ fontSize: '0.82rem', color: '#ffffff' }}>{n.title || n}</strong>
                  {n.source && <span style={{ display: 'block', fontSize: '0.7rem', color: '#8b7db0', marginTop: '2px' }}>{n.source} · {n.time || 'Recent'}</span>}
                </div>
              ))}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={() => setActiveNewsModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
