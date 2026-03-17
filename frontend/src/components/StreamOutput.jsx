import { useRef, useEffect } from 'react';

const VOICE_STYLES = `
@keyframes vo-breathe {
  0%,100% { box-shadow: 0 0 0 0 rgba(99,102,241,0.55), 0 0 32px 4px rgba(99,102,241,0.18); transform: scale(1); }
  50%      { box-shadow: 0 0 0 10px rgba(99,102,241,0.12), 0 0 48px 8px rgba(99,102,241,0.28); transform: scale(1.04); }
}
@keyframes vo-ring1 {
  0%   { transform: scale(1);   opacity: .7; }
  100% { transform: scale(2.4); opacity: 0;  }
}
@keyframes vo-ring2 {
  0%   { transform: scale(1);   opacity: .5; }
  100% { transform: scale(2.0); opacity: 0;  }
}
@keyframes vo-bar {
  0%,100% { transform: scaleY(.25); }
  50%     { transform: scaleY(1);   }
}
@keyframes vo-blink {
  0%,100% { opacity: 1; }
  50%     { opacity: 0; }
}
`;

function fmt(s) {
  const m = String(Math.floor(s / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${m}:${sec}`;
}

function VoiceOrb({ listening, supported, onToggle, elapsed = 0, liveText = '' }) {
  if (!supported) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, marginTop: 28 }}>

      {/* Orb wrapper */}
      <div style={{ position: 'relative', width: 96, height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* Pulse rings — when listening */}
        {listening && <>
          <span style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            border: '2px solid rgba(239,68,68,0.6)',
            animation: 'vo-ring1 1.4s ease-out infinite',
          }} />
          <span style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            border: '2px solid rgba(239,68,68,0.35)',
            animation: 'vo-ring2 1.4s ease-out infinite .35s',
          }} />
          <span style={{
            position: 'absolute', inset: '-16px', borderRadius: '50%',
            border: '1.5px solid rgba(239,68,68,0.2)',
            animation: 'vo-ring1 1.4s ease-out infinite .7s',
          }} />
        </>}

        {/* Main orb button */}
        <button
          onClick={onToggle}
          title={listening ? 'Stop recording' : 'Click to speak'}
          style={{
            width: 96, height: 96, borderRadius: '50%', border: 'none', cursor: 'pointer',
            background: listening
              ? 'radial-gradient(circle at 35% 35%, #f87171, #ef4444)'
              : 'radial-gradient(circle at 35% 35%, #818cf8, #4f46e5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 34,
            animation: listening ? 'none' : 'vo-breathe 2.8s ease-in-out infinite',
            transition: 'background .3s',
            position: 'relative', zIndex: 1,
            boxShadow: listening ? '0 0 24px 4px rgba(239,68,68,0.35)' : undefined,
          }}
        >
          {listening ? '⏹' : '🎤'}
        </button>
      </div>

      {/* Timer — only while recording */}
      {listening && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Blinking red dot */}
          <span style={{
            width: 8, height: 8, borderRadius: '50%', background: '#ef4444', flexShrink: 0,
            animation: 'vo-blink 1s step-start infinite',
          }} />
          <span style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 700, color: '#f87171', letterSpacing: '0.05em' }}>
            {fmt(elapsed)}
          </span>
        </div>
      )}

      {/* Sound-wave bars — while listening */}
      {listening && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, height: 32 }}>
          {[0, .1, .2, .3, .4, .5, .4, .3, .2, .1, 0].map((delay, i) => (
            <span key={i} style={{
              display: 'block', width: 4, height: 32,
              borderRadius: 4,
              background: 'linear-gradient(to top, #ef4444, #f87171)',
              transformOrigin: 'center',
              animation: `vo-bar .7s ease-in-out infinite ${delay}s`,
            }} />
          ))}
        </div>
      )}

      {/* Live interim transcript preview */}
      {listening && liveText && (
        <p style={{
          fontSize: 12, color: '#9ca3af', maxWidth: 280, textAlign: 'center',
          margin: 0, fontStyle: 'italic', lineHeight: 1.5,
        }}>
          "{liveText}"
        </p>
      )}

      {/* Label */}
      <p style={{ fontSize: 13, color: listening ? '#f87171' : '#6b7280', letterSpacing: '.01em', margin: 0 }}>
        {listening ? 'Recording… click ⏹ to finish' : 'Click to speak your command'}
      </p>
    </div>
  );
}

export default function StreamOutput({ messages = [], isRunning = false, placeholder, voice }) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isRunning]);

  if (!messages.length && !isRunning) {
    return (
      <div className="flex-1 overflow-y-auto p-4 flex items-center justify-center">
        <style>{VOICE_STYLES}</style>
        <div className="text-center" style={{ color: '#6b7280' }}>
          <div style={{ fontSize: 42, marginBottom: 10 }}>{placeholder?.icon || '🤖'}</div>
          <p style={{ fontSize: 13, color: '#4b5563', whiteSpace: 'pre-line', margin: 0 }}>
            {placeholder?.text || 'Run a task to see output here'}
          </p>
          {voice && (
            <VoiceOrb
              listening={voice.listening}
              supported={voice.supported}
              onToggle={voice.toggle}
              elapsed={voice.elapsed}
              liveText={voice.liveText}
            />
          )}
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
          AI is processing…
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
