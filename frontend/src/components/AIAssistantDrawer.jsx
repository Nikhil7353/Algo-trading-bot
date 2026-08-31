import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api';

const QUICK_PROMPTS = [
  "What is my P&L today?",
  "Show my open positions",
  "What are today's top signals?",
  "What is the sentiment for RELIANCE?",
  "Summarize our risk settings",
];

export default function AIAssistantDrawer() {
  const location = useLocation();
  const hideFab = location.pathname === '/assistant' || location.pathname === '/';
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: "👋 Hello! I'm **NikhilAlgo AI**, your quantitative trading copilot. I can query real-time portfolio P&L, active holdings, breakout signals, and news sentiment. How can I help you today?",
      tools_used: [],
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState({ available: false, model: 'llama-3.3-70b-versatile', provider: 'groq' });
  const modelLabel = 'LLaMA 3.3 70B · Groq Engine';
  const chatBoxRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    api.getAssistantStatus()
      .then((data) => setStatus(data))
      .catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const box = chatBoxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages, isOpen, loading]);

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
          content: `⚠️ **Error communicating with AI service:** ${err.message || 'Check API connectivity.'}`,
          tools_used: [],
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const parseInline = (text) => {
    const tokens = [];
    const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
    let lastIndex = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        tokens.push(text.slice(lastIndex, match.index));
      }
      const raw = match[0];
      if (raw.startsWith('**') && raw.endsWith('**')) {
        tokens.push(<strong key={match.index} style={{ color: '#ffffff', fontWeight: 700 }}>{raw.slice(2, -2)}</strong>);
      } else if (raw.startsWith('*') && raw.endsWith('*')) {
        tokens.push(<em key={match.index} style={{ color: '#c4b5fd' }}>{raw.slice(1, -1)}</em>);
      } else if (raw.startsWith('`') && raw.endsWith('`')) {
        tokens.push(
          <code key={match.index} style={{ background: 'rgba(196,181,253,0.15)', color: '#2dd4bf', padding: '0.1rem 0.35rem', borderRadius: '4px', fontSize: '0.78rem', fontFamily: 'monospace' }}>
            {raw.slice(1, -1)}
          </code>
        );
      }
      lastIndex = pattern.lastIndex;
    }
    if (lastIndex < text.length) {
      tokens.push(text.slice(lastIndex));
    }
    return tokens;
  };

  const renderContent = (content) => {
    const lines = content.split('\n');
    const elements = [];
    let currentTable = null;
    let listItems = [];
    let listType = null;

    const flushList = (key) => {
      if (listItems.length > 0) {
        if (listType === 'ol') {
          elements.push(<ol key={key} style={{ margin: '0.3rem 0', paddingLeft: '1.2rem' }}>{listItems}</ol>);
        } else {
          elements.push(<ul key={key} style={{ margin: '0.3rem 0', paddingLeft: '1.2rem' }}>{listItems}</ul>);
        }
        listItems = [];
        listType = null;
      }
    };

    const flushTable = (key) => {
      if (currentTable) {
        elements.push(
          <div key={key} style={{ overflowX: 'auto', margin: '0.5rem 0' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', background: 'rgba(0,0,0,0.35)', borderRadius: '8px', overflow: 'hidden' }}>
              <thead>
                <tr style={{ background: 'rgba(196,181,253,0.12)' }}>
                  {currentTable.headers.map((h, i) => (
                    <th key={i} style={{ padding: '0.35rem 0.6rem', textAlign: 'left', color: '#c4b5fd', fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>{parseInline(h.trim())}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {currentTable.rows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    {r.map((c, j) => (
                      <td key={j} style={{ padding: '0.3rem 0.6rem', color: '#e2d9f8' }}>{parseInline(c.trim())}</td>
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
        if (parts.every((p) => p.trim().match(/^:?-+:?$/))) return;
        if (!currentTable) currentTable = { headers: parts, rows: [] };
        else currentTable.rows.push(parts);
        return;
      }

      flushTable(`table-${idx}`);

      // Horizontal rule
      if (line.trim().match(/^-{3,}$/) || line.trim().match(/^={3,}$/)) {
        flushList(`list-${idx}`);
        elements.push(<hr key={idx} style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.1)', margin: '0.5rem 0' }} />);
        return;
      }

      // Headings
      if (line.startsWith('### ')) {
        flushList(`list-${idx}`);
        elements.push(<h3 key={idx} style={{ margin: '0.6rem 0 0.25rem', fontSize: '0.9rem', color: '#c4b5fd', fontWeight: 700 }}>{parseInline(line.slice(4))}</h3>);
        return;
      }
      if (line.startsWith('## ')) {
        flushList(`list-${idx}`);
        elements.push(<h2 key={idx} style={{ margin: '0.7rem 0 0.3rem', fontSize: '0.96rem', color: '#2dd4bf', fontWeight: 700 }}>{parseInline(line.slice(3))}</h2>);
        return;
      }

      // Blockquote
      if (line.startsWith('> ')) {
        flushList(`list-${idx}`);
        elements.push(
          <blockquote key={idx} style={{ borderLeft: '3px solid #c4b5fd', paddingLeft: '0.6rem', margin: '0.3rem 0', color: '#b3a6d4', fontSize: '0.8rem', lineHeight: 1.4 }}>
            {parseInline(line.slice(2))}
          </blockquote>
        );
        return;
      }

      // Lists
      const olMatch = line.match(/^(\d+)\. (.+)/);
      if (olMatch) {
        if (listType !== 'ol') { flushList(`list-${idx}`); listType = 'ol'; }
        listItems.push(<li key={idx} style={{ fontSize: '0.82rem', color: 'inherit', lineHeight: 1.4 }}>{parseInline(olMatch[2])}</li>);
        return;
      }
      if (line.match(/^[\-\*] /)) {
        if (listType !== 'ul') { flushList(`list-${idx}`); listType = 'ul'; }
        listItems.push(<li key={idx} style={{ fontSize: '0.82rem', color: 'inherit', lineHeight: 1.4 }}>{parseInline(line.slice(2))}</li>);
        return;
      }

      if (line.trim() === '') {
        flushList(`list-${idx}`);
        elements.push(<div key={idx} style={{ height: '0.25rem' }} />);
        return;
      }

      flushList(`list-${idx}`);
      elements.push(
        <p key={idx} style={{ margin: '0.2rem 0', fontSize: '0.83rem', color: 'inherit', lineHeight: 1.45 }}>
          {parseInline(line)}
        </p>
      );
    });

    flushList('list-end');
    flushTable('table-end');
    return elements;
  };

  if (hideFab) return null;

  return (
    <>
      {/* Floating Launcher Button */}
      <button
        type="button"
        className="ai-floating-btn"
        onClick={() => setIsOpen(!isOpen)}
        title="Open NikhilAlgo AI Assistant"
        style={{
          position: 'fixed',
          bottom: '1.75rem',
          right: '1.75rem',
          width: '54px',
          height: '54px',
          borderRadius: '50%',
          background: isOpen ? 'rgba(30, 20, 60, 0.95)' : 'linear-gradient(135deg, #7c3aed 0%, #0ea5e9 100%)',
          color: '#fff',
          border: isOpen ? '1px solid rgba(196, 181, 253, 0.4)' : 'none',
          boxShadow: '0 8px 24px rgba(124, 58, 237, 0.5), 0 0 12px rgba(45, 212, 191, 0.3)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 999,
          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          transform: isOpen ? 'scale(0.95)' : 'scale(1)',
        }}
      >
        {isOpen ? (
          <span style={{ fontSize: '1.2rem', color: '#c4b5fd', lineHeight: 1 }}>✕</span>
        ) : (
          <span style={{ fontSize: '1.35rem', lineHeight: 1 }}>✨</span>
        )}
      </button>

      {/* Slide-out Glassmorphic Chat Drawer */}
      {isOpen && (
        <div
          className="ai-chat-drawer card"
          style={{
            position: 'fixed',
            bottom: '5.5rem',
            right: '1.75rem',
            width: '380px',
            maxWidth: 'calc(100vw - 2.5rem)',
            height: '460px',
            maxHeight: 'calc(100vh - 7rem)',
            zIndex: 998,
            display: 'flex',
            flexDirection: 'column',
            padding: 0,
            borderRadius: '18px',
            boxShadow: '0 24px 60px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(196, 181, 253, 0.25)',
            overflow: 'hidden',
            background: 'linear-gradient(180deg, #120d2e 0%, #090618 100%)',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '0.85rem 1rem',
              background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.2) 0%, rgba(45, 212, 191, 0.1) 100%)',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '10px',
                  background: 'linear-gradient(135deg, #7c3aed 0%, #0ea5e9 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: '0.95rem',
                  boxShadow: '0 0 10px rgba(124, 58, 237, 0.5)',
                }}
              >
                ✨
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#ffffff' }}>
                  NikhilAlgo AI
                  <span className="badge" style={{ fontSize: '0.62rem', background: 'rgba(74, 222, 128, 0.15)', color: '#4ade80', border: '1px solid rgba(74, 222, 128, 0.3)', padding: '0.1rem 0.4rem' }}>
                    ● GROQ ONLINE
                  </span>
                </h3>
                <span style={{ fontSize: '0.7rem', color: '#8b7db0' }}>
                  {modelLabel}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              style={{
                background: 'rgba(255, 255, 255, 0.06)',
                border: 'none',
                borderRadius: '6px',
                width: '26px',
                height: '26px',
                color: '#b3a6d4',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.8rem',
              }}
            >
              ✕
            </button>
          </div>

          {/* Chat Messages */}
          <div
            ref={chatBoxRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '0.85rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
            }}
          >
            {messages.map((m, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                {/* Message Bubble */}
                <div
                  style={{
                    maxWidth: '88%',
                    padding: '0.65rem 0.9rem',
                    borderRadius: m.role === 'user' ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
                    background: m.role === 'user'
                      ? 'linear-gradient(135deg, #7c3aed 0%, #0ea5e9 100%)'
                      : 'rgba(255, 255, 255, 0.05)',
                    border: m.role === 'user' ? '1px solid rgba(139,92,246,0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
                    boxShadow: m.role === 'user' ? '0 4px 14px rgba(124, 58, 237, 0.4)' : '0 2px 8px rgba(0, 0, 0, 0.3)',
                    color: m.role === 'user' ? '#ffffff' : '#e2d9f8',
                    fontSize: '0.84rem',
                  }}
                >
                  {renderContent(m.content)}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.75rem', color: '#c4b5fd', fontSize: '0.78rem', background: 'rgba(124,58,237,0.1)', borderRadius: '8px', width: 'fit-content' }}>
                <span className="mode-pulse"></span>
                <span>Formulating quant analysis…</span>
              </div>
            )}
          </div>

          {/* Suggested Quick Prompts */}
          <div
            style={{
              padding: '0.45rem 0.75rem',
              background: 'rgba(0, 0, 0, 0.3)',
              borderTop: '1px solid rgba(255, 255, 255, 0.05)',
              display: 'flex',
              gap: '0.35rem',
              overflowX: 'auto',
              whiteSpace: 'nowrap',
              scrollbarWidth: 'none',
            }}
          >
            {QUICK_PROMPTS.map((qp, idx) => (
              <button
                key={idx}
                type="button"
                className="stock-chip-btn"
                onClick={() => handleSend(qp)}
                style={{
                  fontSize: '0.7rem',
                  padding: '0.2rem 0.55rem',
                }}
              >
                {qp}
              </button>
            ))}
          </div>

          {/* Input Box */}
          <div
            style={{
              padding: '0.65rem 0.85rem',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              background: 'rgba(0, 0, 0, 0.4)',
              display: 'flex',
              gap: '0.45rem',
              alignItems: 'center',
            }}
          >
            <input
              type="text"
              className="scanner-main-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything (P&L, trades, signals)…"
              disabled={loading}
              style={{
                flex: 1,
                fontSize: '0.84rem',
                padding: '0.5rem 0.75rem',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '8px',
              }}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => handleSend()}
              disabled={loading || !input.trim()}
              style={{ padding: '0.5rem 0.85rem', fontSize: '0.82rem', fontWeight: 700 }}
            >
              {loading ? '…' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
