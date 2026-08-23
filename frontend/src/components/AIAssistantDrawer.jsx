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
      content: "👋 Hello! I'm **StockBot AI**, your quantitative algorithmic assistant. I can query real-time portfolio P&L, open positions, trade history, signals, and market sentiment. How can I help you today?",
      tools_used: [],
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState({ available: false, model: 'llama-3.3-70b-versatile', provider: 'groq' });
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
  }, [messages, isOpen]);

  const handleSend = async (userText = null) => {
    const textToSend = typeof userText === 'string' ? userText : input;
    if (!textToSend.trim() || loading) return;

    const userMsg = { role: 'user', content: textToSend.trim() };
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInput('');
    setLoading(true);

    try {
      // Send message along with previous conversation history
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

  const renderContent = (content) => {
    // Basic Markdown formatting helper
    return content.split('\n').map((line, i) => {
      let formatted = line;
      if (line.startsWith('### ')) {
        return <h4 key={i} style={{ margin: '0.6rem 0 0.3rem', fontSize: '0.95rem', color: 'var(--accent)' }}>{line.replace('### ', '')}</h4>;
      }
      if (line.startsWith('- ')) {
        return (
          <div key={i} style={{ display: 'flex', gap: '0.4rem', margin: '0.2rem 0', paddingLeft: '0.5rem' }}>
            <span>•</span>
            <span dangerouslySetInnerHTML={{ __html: formatInline(line.substring(2)) }} />
          </div>
        );
      }
      if (line.startsWith('> ')) {
        return (
          <blockquote key={i} style={{ borderLeft: '3px solid var(--accent)', margin: '0.4rem 0', paddingLeft: '0.6rem', color: 'var(--text-muted)', fontSize: '0.8rem', fontStyle: 'italic' }}>
            <span dangerouslySetInnerHTML={{ __html: formatInline(line.substring(2)) }} />
          </blockquote>
        );
      }
      return (
        <p key={i} style={{ margin: '0.35rem 0', lineHeight: 1.45 }} dangerouslySetInnerHTML={{ __html: formatInline(formatted) }} />
      );
    });
  };

  const formatInline = (text) => {
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code style="background: rgba(255,255,255,0.08); padding: 0.15rem 0.35rem; border-radius: 4px; font-size: 0.82rem;">$1</code>');
  };

  if (hideFab) return null;

  return (
    <>
      {/* Floating Launcher Button */}
      <button
        type="button"
        className="ai-floating-btn"
        onClick={() => setIsOpen(!isOpen)}
        title="Open StockBot AI Assistant"
        style={{
          position: 'fixed',
          bottom: '1.75rem',
          right: '1.75rem',
          width: '54px',
          height: '54px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #c4b5fd 0%, #2dd4bf 100%)',
          color: '#fff',
          border: 'none',
          boxShadow: '0 8px 24px rgba(99, 102, 241, 0.45)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 999,
          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          transform: isOpen ? 'scale(0.94)' : 'scale(1)',
        }}
      >
        {isOpen ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"></path>
            <rect x="4" y="8" width="16" height="12" rx="2"></rect>
            <path d="M9 13v2"></path>
            <path d="M15 13v2"></path>
          </svg>
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
            width: '360px',
            maxWidth: 'calc(100vw - 2.5rem)',
            height: '340px',
            maxHeight: 'min(340px, calc(100vh - 9rem))',
            zIndex: 998,
            display: 'flex',
            flexDirection: 'column',
            padding: 0,
            borderRadius: '16px',
            boxShadow: '0 20px 48px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.1)',
            overflow: 'hidden',
            background: 'var(--bg-panel, #121826)',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '1rem 1.25rem',
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(56, 189, 248, 0.1) 100%)',
              borderBottom: '1px solid var(--border-color)',
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
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, #c4b5fd 0%, #2dd4bf 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: '0.9rem',
                }}
              >
                🤖
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  StockBot AI
                  <span className="badge" style={{ fontSize: '0.65rem', background: status.available ? 'rgba(34, 197, 94, 0.2)' : 'rgba(234, 179, 8, 0.2)', color: status.available ? 'var(--green)' : '#eab308' }}>
                    {status.available ? 'GROQ ONLINE' : 'LOCAL ENGINE'}
                  </span>
                </h3>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {status.model}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="btn btn-icon btn-sm"
              onClick={() => setIsOpen(false)}
              style={{ padding: '0.2rem', color: 'var(--text-muted)' }}
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
              padding: '1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.85rem',
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
                    padding: '0.75rem 1rem',
                    borderRadius: m.role === 'user' ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
                    background: m.role === 'user' ? 'linear-gradient(135deg, #c4b5fd 0%, #2dd4bf 100%)' : 'rgba(255, 255, 255, 0.05)',
                    border: m.role === 'user' ? 'none' : '1px solid rgba(255, 255, 255, 0.08)',
                    color: m.role === 'user' ? '#0b0618' : '#fff',
                    fontSize: '0.86rem',
                  }}
                >
                  {renderContent(m.content)}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.8rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                <span className="mode-pulse"></span>
                <span>Thinking & querying portfolio tools…</span>
              </div>
            )}
          </div>

          {/* Suggested Quick Prompts */}
          <div
            style={{
              padding: '0.5rem 0.85rem',
              background: 'rgba(0, 0, 0, 0.2)',
              borderTop: '1px solid rgba(255, 255, 255, 0.05)',
              display: 'flex',
              gap: '0.4rem',
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
                  fontSize: '0.72rem',
                  padding: '0.25rem 0.6rem',
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

          {/* Input Box */}
          <div
            style={{
              padding: '0.75rem 1rem',
              borderTop: '1px solid var(--border-color)',
              background: 'rgba(0, 0, 0, 0.25)',
              display: 'flex',
              gap: '0.5rem',
              alignItems: 'center',
            }}
          >
            <input
              type="text"
              className="input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything (P&L, trades, signals, sentiment)…"
              disabled={loading}
              style={{
                flex: 1,
                fontSize: '0.86rem',
                padding: '0.6rem 0.85rem',
                borderRadius: '8px',
              }}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => handleSend()}
              disabled={loading || !input.trim()}
              style={{ padding: '0.6rem 1rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
            >
              {loading ? '…' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
