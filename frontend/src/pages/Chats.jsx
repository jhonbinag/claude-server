/**
 * Chats.jsx — Claude/ChatGPT-style persistent chat interface
 *
 * - Left panel: chat history list (search, new, delete)
 * - Right panel: active conversation with streaming AI replies
 * - AI automatically queries all available brains before responding
 * - Brains are used silently — no brain selector shown to user
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp }   from '../context/AppContext';
import AuthGate     from '../components/AuthGate';
import Spinner      from '../components/Spinner';
import { Link }     from 'react-router-dom';

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() { return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000)       return 'just now';
  if (diff < 3600000)     return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000)    return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000)   return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString();
}

function groupByDate(chats) {
  const groups = {};
  const now = new Date();
  chats.forEach(c => {
    const d = new Date(c.updatedAt || c.createdAt || 0);
    const diff = now - d;
    let group;
    if (diff < 86400000)       group = 'Today';
    else if (diff < 172800000) group = 'Yesterday';
    else if (diff < 604800000) group = 'Last 7 Days';
    else if (diff < 2592000000)group = 'Last 30 Days';
    else                       group = 'Older';
    if (!groups[group]) groups[group] = [];
    groups[group].push(c);
  });
  return groups;
}

// Simple markdown-like renderer
function renderContent(text) {
  if (!text) return null;
  // Split by code blocks first
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts.map((part, i) => {
    if (part.startsWith('```')) {
      const lines = part.slice(3).split('\n');
      const lang = lines[0].trim();
      const code = lines.slice(1).join('\n').replace(/```$/, '').trim();
      return (
        <pre key={i} style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '12px 14px', overflowX: 'auto', margin: '8px 0', fontSize: 12, lineHeight: 1.6 }}>
          {lang && <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 6 }}>{lang}</div>}
          <code style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>{code}</code>
        </pre>
      );
    }
    // Inline formatting
    return (
      <span key={i} style={{ whiteSpace: 'pre-wrap' }}>
        {part.split(/(`[^`]+`)/).map((chunk, j) => {
          if (chunk.startsWith('`') && chunk.endsWith('`')) {
            return <code key={j} style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 5px', borderRadius: 4, fontFamily: 'monospace', fontSize: '0.9em', color: '#a5b4fc' }}>{chunk.slice(1, -1)}</code>;
          }
          // Bold
          return chunk.split(/(\*\*[^*]+\*\*)/).map((s, k) => {
            if (s.startsWith('**') && s.endsWith('**')) {
              return <strong key={k} style={{ color: '#f1f5f9' }}>{s.slice(2, -2)}</strong>;
            }
            return s;
          });
        })}
      </span>
    );
  });
}

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg, isStreaming }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{
      display: 'flex',
      flexDirection: isUser ? 'row-reverse' : 'row',
      alignItems: 'flex-start',
      gap: 10,
      marginBottom: 20,
      padding: '0 4px',
    }}>
      {/* Avatar */}
      <div style={{
        width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: isUser ? 'rgba(99,102,241,0.25)' : 'rgba(16,185,129,0.2)',
        border: `1px solid ${isUser ? 'rgba(99,102,241,0.4)' : 'rgba(16,185,129,0.3)'}`,
        fontSize: 13,
      }}>
        {isUser ? '👤' : '🤖'}
      </div>

      {/* Bubble */}
      <div style={{
        maxWidth: '78%',
        background: isUser ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${isUser ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.07)'}`,
        borderRadius: isUser ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
        padding: '10px 14px',
        fontSize: 13.5,
        lineHeight: 1.65,
        color: '#e2e8f0',
      }}>
        {renderContent(msg.content)}
        {isStreaming && (
          <span style={{ display: 'inline-block', width: 8, height: 14, background: '#6366f1', borderRadius: 2, marginLeft: 2, animation: 'blink 0.8s step-start infinite', verticalAlign: 'text-bottom' }} />
        )}
        {msg.ts && (
          <div style={{ fontSize: 10, color: '#4b5563', marginTop: 5, textAlign: isUser ? 'right' : 'left' }}>
            {formatTime(msg.ts)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onNew }) {
  const starters = [
    'What can you help me with?',
    'Summarize my business overview',
    'Help me write a follow-up email',
    'What do you know about my products?',
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 20, padding: 32 }}>
      <div style={{ fontSize: 48 }}>💬</div>
      <div style={{ textAlign: 'center' }}>
        <p style={{ color: '#f1f5f9', fontWeight: 600, fontSize: 15, margin: '0 0 6px' }}>How can I help you today?</p>
        <p style={{ color: '#6b7280', fontSize: 12, margin: 0 }}>I'll automatically search your knowledge bases to give you accurate answers.</p>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 480 }}>
        {starters.map(s => (
          <button key={s} onClick={() => onNew(s)}
            style={{ fontSize: 12, padding: '7px 14px', borderRadius: 20, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#9ca3af', cursor: 'pointer', transition: 'all .15s' }}
            onMouseOver={e => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)'; e.currentTarget.style.color = '#a5b4fc'; }}
            onMouseOut={e  => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#9ca3af'; }}
          >{s}</button>
        ))}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Chats() {
  const { isAuthenticated, isAuthLoading, locationId } = useApp();

  const [sessions,    setSessions]    = useState([]);   // list of chat sessions
  const [activeId,    setActiveId]    = useState(null); // current session id
  const [messages,    setMessages]    = useState([]);   // messages in active session
  const [streamText,  setStreamText]  = useState('');   // in-progress AI text
  const [isStreaming, setIsStreaming] = useState(false);
  const [input,       setInput]       = useState('');
  const [search,      setSearch]      = useState('');
  const [sideOpen,    setSideOpen]    = useState(true); // mobile sidebar toggle

  const bottomRef    = useRef(null);
  const inputRef     = useRef(null);
  const abortRef     = useRef(null);

  // ── Load sessions ──────────────────────────────────────────────────────────

  const loadSessions = useCallback(async () => {
    if (!locationId) return;
    try {
      const r = await fetch('/chats', { headers: { 'x-location-id': locationId } });
      const d = await r.json();
      if (d.success) {
        const sorted = (d.data || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        setSessions(sorted);
      }
    } catch (_) {}
  }, [locationId]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // ── Auto-scroll ────────────────────────────────────────────────────────────

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamText]);

  // ── Open a session ─────────────────────────────────────────────────────────

  const openSession = useCallback(async (id) => {
    if (!locationId) return;
    setActiveId(id);
    setStreamText('');
    try {
      const r = await fetch(`/chats/${id}`, { headers: { 'x-location-id': locationId } });
      const d = await r.json();
      if (d.success) setMessages(d.data.messages || []);
    } catch (_) { setMessages([]); }
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [locationId]);

  // ── New chat ───────────────────────────────────────────────────────────────

  const newChat = useCallback(async (initialMessage = '') => {
    const id = uid();
    await fetch('/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-location-id': locationId },
      body: JSON.stringify({ id, title: 'New Chat', messages: [] }),
    }).catch(() => {});
    setActiveId(id);
    setMessages([]);
    setStreamText('');
    await loadSessions();
    if (initialMessage) {
      setTimeout(() => sendMessage(id, initialMessage, []), 50);
    } else {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId, loadSessions]);

  // ── Delete session ─────────────────────────────────────────────────────────

  const deleteSession = useCallback(async (id, e) => {
    e.stopPropagation();
    await fetch(`/chats/${id}`, { method: 'DELETE', headers: { 'x-location-id': locationId } });
    if (activeId === id) { setActiveId(null); setMessages([]); }
    await loadSessions();
  }, [locationId, activeId, loadSessions]);

  // ── Send message ───────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (sessionId, text, currentMessages) => {
    if (!text.trim() || isStreaming) return;
    const userMsg = { role: 'user', content: text.trim(), ts: Date.now() };
    const newMessages = [...currentMessages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsStreaming(true);
    setStreamText('');

    // Build history to send (exclude the message we just added)
    const history = currentMessages.map(m => ({ role: m.role, content: m.content }));

    try {
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const res = await fetch(`/chats/${sessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-location-id': locationId },
        body: JSON.stringify({ message: text.trim(), history }),
        signal: ctrl.signal,
      });

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const part of parts) {
          const lines = part.trim().split('\n');
          let evt = '', data = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) evt  = line.slice(7);
            if (line.startsWith('data: '))  data = line.slice(6);
          }
          if (!data) continue;
          const parsed = JSON.parse(data);
          if (evt === 'text') {
            fullText += parsed.text;
            setStreamText(fullText);
          } else if (evt === 'done' || evt === 'error') {
            break;
          }
        }
      }

      const aiMsg = { role: 'assistant', content: fullText, ts: Date.now() };
      setMessages(prev => [...prev, aiMsg]);
      setStreamText('');
      await loadSessions();
    } catch (err) {
      if (err.name !== 'AbortError') {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.', ts: Date.now() }]);
        setStreamText('');
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [isStreaming, locationId, loadSessions]);

  const handleSend = () => {
    if (!activeId) {
      newChat(input);
    } else {
      sendMessage(activeId, input, messages);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const stopStream = () => { abortRef.current?.abort(); setIsStreaming(false); setStreamText(''); };

  // ── Guards ─────────────────────────────────────────────────────────────────

  if (isAuthLoading)    return <Spinner />;
  if (!isAuthenticated) return (
    <AuthGate icon="💬" title="Chats" subtitle="Connect your API key to access Chats">
      <Link to="/" className="block text-center text-xs text-gray-500 mt-4 hover:text-gray-300">← Back</Link>
    </AuthGate>
  );

  const filtered = sessions.filter(s =>
    !search || s.title?.toLowerCase().includes(search.toLowerCase())
  );
  const groups = groupByDate(filtered);
  const groupOrder = ['Today', 'Yesterday', 'Last 7 Days', 'Last 30 Days', 'Older'];

  return (
    <div style={{ display: 'flex', height: '100%', background: '#0f0f13', overflow: 'hidden' }}>
      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        .chat-input:focus { outline: none; }
        .chat-scroll::-webkit-scrollbar { width: 4px; }
        .chat-scroll::-webkit-scrollbar-track { background: transparent; }
        .chat-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
      `}</style>

      {/* ── Left sidebar ── */}
      <div style={{
        width: sideOpen ? 260 : 0, flexShrink: 0, overflow: 'hidden',
        transition: 'width 0.2s ease',
        display: 'flex', flexDirection: 'column',
        background: '#0a0a0f', borderRight: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 260 }}>
          {/* Header */}
          <div style={{ padding: '14px 12px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
            <button onClick={() => newChat()}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 10, background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', color: '#a5b4fc', cursor: 'pointer', fontSize: 13, fontWeight: 500, transition: 'all .15s' }}
              onMouseOver={e => e.currentTarget.style.background = 'rgba(99,102,241,0.25)'}
              onMouseOut={e  => e.currentTarget.style.background = 'rgba(99,102,241,0.15)'}
            >
              <span style={{ fontSize: 16 }}>✏️</span> New Chat
            </button>
          </div>

          {/* Search */}
          <div style={{ padding: '8px 10px', flexShrink: 0 }}>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search chats…"
              style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '6px 10px', fontSize: 12, color: '#e2e8f0', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          {/* Sessions list */}
          <div className="chat-scroll" style={{ flex: 1, overflowY: 'auto', padding: '0 6px 12px' }}>
            {sessions.length === 0 ? (
              <p style={{ fontSize: 12, color: '#4b5563', textAlign: 'center', padding: '24px 8px' }}>No chats yet.<br/>Start a new conversation.</p>
            ) : (
              groupOrder.map(group => {
                const items = groups[group];
                if (!items?.length) return null;
                return (
                  <div key={group}>
                    <p style={{ fontSize: 10, fontWeight: 600, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '10px 8px 4px' }}>{group}</p>
                    {items.map(s => (
                      <div key={s.id}
                        onClick={() => openSession(s.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                          background: activeId === s.id ? 'rgba(99,102,241,0.15)' : 'transparent',
                          border: `1px solid ${activeId === s.id ? 'rgba(99,102,241,0.3)' : 'transparent'}`,
                          marginBottom: 2, transition: 'all .12s',
                        }}
                        onMouseOver={e => { if (activeId !== s.id) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                        onMouseOut={e  => { if (activeId !== s.id) e.currentTarget.style.background = 'transparent'; }}
                      >
                        <span style={{ fontSize: 14, flexShrink: 0 }}>💬</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: 12, fontWeight: 500, color: activeId === s.id ? '#a5b4fc' : '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {s.title || 'New Chat'}
                          </p>
                          <p style={{ margin: 0, fontSize: 10, color: '#4b5563' }}>
                            {formatTime(s.updatedAt || s.createdAt)}
                          </p>
                        </div>
                        <button onClick={e => deleteSession(s.id, e)}
                          style={{ flexShrink: 0, background: 'none', border: 'none', color: '#374151', cursor: 'pointer', fontSize: 14, padding: '0 2px', opacity: 0, transition: 'opacity .15s' }}
                          onMouseOver={e => { e.currentTarget.style.opacity = 1; e.currentTarget.style.color = '#ef4444'; }}
                          onMouseOut={e  => { e.currentTarget.style.opacity = 0; e.currentTarget.style.color = '#374151'; }}
                        >×</button>
                      </div>
                    ))}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ── Main chat area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

        {/* Topbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', height: 52, borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0, background: 'rgba(0,0,0,0.2)' }}>
          <button onClick={() => setSideOpen(v => !v)}
            style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 16, padding: '4px 6px', borderRadius: 6 }}
            title="Toggle sidebar"
          >☰</button>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', flex: 1 }}>
            {activeId ? (sessions.find(s => s.id === activeId)?.title || 'Chat') : 'Chats'}
          </span>
          {isStreaming && (
            <button onClick={stopStream}
              style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', cursor: 'pointer' }}>
              ⏹ Stop
            </button>
          )}
        </div>

        {/* Messages */}
        <div className="chat-scroll" style={{ flex: 1, overflowY: 'auto', padding: '20px 0' }}>
          {!activeId ? (
            <EmptyState onNew={(text) => newChat(text)} />
          ) : messages.length === 0 && !isStreaming ? (
            <EmptyState onNew={(text) => sendMessage(activeId, text, [])} />
          ) : (
            <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 20px' }}>
              {messages.map((msg, i) => (
                <MessageBubble key={i} msg={msg} isStreaming={false} />
              ))}
              {isStreaming && streamText && (
                <MessageBubble
                  msg={{ role: 'assistant', content: streamText }}
                  isStreaming={true}
                />
              )}
              {isStreaming && !streamText && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 40px', color: '#6b7280', fontSize: 13 }}>
                  <span style={{ display: 'flex', gap: 4 }}>
                    {[0, 0.2, 0.4].map((d, i) => (
                      <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: '#6366f1', display: 'inline-block', animation: `blink 1.2s ease-in-out ${d}s infinite` }} />
                    ))}
                  </span>
                  Thinking…
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div style={{ padding: '12px 16px 16px', borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.15)', flexShrink: 0 }}>
          <div style={{ maxWidth: 760, margin: '0 auto', position: 'relative' }}>
            <textarea
              ref={inputRef}
              className="chat-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message…"
              rows={1}
              disabled={isStreaming}
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 12, padding: '11px 48px 11px 14px',
                fontSize: 14, color: '#e2e8f0', resize: 'none',
                lineHeight: 1.5, maxHeight: 160, overflowY: 'auto',
                transition: 'border-color .15s',
              }}
              onFocus={e  => e.target.style.borderColor = 'rgba(99,102,241,0.5)'}
              onBlur={e   => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
              onInput={e  => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'; }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isStreaming}
              style={{
                position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                width: 32, height: 32, borderRadius: 8, border: 'none', cursor: 'pointer',
                background: input.trim() && !isStreaming ? '#6366f1' : 'rgba(255,255,255,0.08)',
                color: input.trim() && !isStreaming ? '#fff' : '#4b5563',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, transition: 'all .15s',
              }}
            >↑</button>
          </div>
          <p style={{ textAlign: 'center', fontSize: 10, color: '#374151', marginTop: 8 }}>
            Powered by Claude · Knowledge bases queried automatically · Press Enter to send
          </p>
        </div>
      </div>
    </div>
  );
}
