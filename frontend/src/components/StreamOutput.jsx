import { useRef, useEffect } from 'react';

export default function StreamOutput({ messages = [], isRunning = false, placeholder }) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isRunning]);

  if (!messages.length && !isRunning) {
    return (
      <div className="flex-1 overflow-y-auto p-4 flex items-center justify-center">
        <div className="text-center text-gray-700">
          <div className="text-4xl mb-3">{placeholder?.icon || '🤖'}</div>
          <p className="text-sm text-gray-600 whitespace-pre-line">{placeholder?.text || 'Run a task to see output here'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-2.5 text-sm">
      {messages.map((msg, i) => <Block key={i} msg={msg} />)}

      {isRunning && (
        <div className="flex items-center gap-2 text-gray-500 text-xs py-1 fade-up">
          <div
            className="spinner w-3.5 h-3.5 rounded-full border-2 flex-shrink-0"
            style={{ borderColor: '#6366f1', borderTopColor: 'transparent' }}
          />
          Claude is processing…
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}

function Block({ msg }) {
  switch (msg.type) {
    case 'text':
      return (
        <div className="fade-up" style={{ borderLeft: '2px solid #6366f1', paddingLeft: '.75rem' }}>
          <pre style={{
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            fontSize: '.8125rem', color: '#e2e8f0', lineHeight: '1.65',
            fontFamily: 'inherit', margin: 0,
          }}>
            {msg.text}
          </pre>
        </div>
      );

    case 'tool_call':
      return (
        <div className="fade-up" style={{ borderLeft: '2px solid #f59e0b', paddingLeft: '.75rem' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '.25rem',
            background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)',
            color: '#fbbf24', borderRadius: '.5rem', padding: '.15rem .6rem',
            fontSize: '.75rem', fontWeight: 500,
          }}>
            🔧 {msg.name}
          </span>
          <div className="text-xs text-gray-600 mt-1 font-mono truncate">
            {JSON.stringify(msg.input).slice(0, 130)}
            {JSON.stringify(msg.input).length > 130 ? '…' : ''}
          </div>
        </div>
      );

    case 'tool_result':
      return (
        <div className="fade-up" style={{ borderLeft: '2px solid rgba(255,255,255,0.08)', paddingLeft: '.75rem' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '.25rem',
            background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)',
            color: '#4ade80', borderRadius: '.5rem', padding: '.15rem .6rem', fontSize: '.75rem',
          }}>
            ✓ {msg.name}
          </span>
          <div className="text-xs text-gray-600 mt-1 font-mono truncate">
            {JSON.stringify(msg.result).slice(0, 160)}
            {JSON.stringify(msg.result).length > 160 ? '…' : ''}
          </div>
        </div>
      );

    case 'done':
      return (
        <div className="fade-up text-xs text-green-400 font-medium"
          style={{ borderLeft: '2px solid #22c55e', paddingLeft: '.75rem' }}>
          ✓ Complete — {msg.turns} turn{msg.turns !== 1 ? 's' : ''}, {msg.toolCallCount} tool call{msg.toolCallCount !== 1 ? 's' : ''}
        </div>
      );

    case 'error':
      return (
        <div className="fade-up text-xs text-red-400"
          style={{ borderLeft: '2px solid #ef4444', paddingLeft: '.75rem' }}>
          ✗ {msg.error}
        </div>
      );

    default:
      return null;
  }
}
