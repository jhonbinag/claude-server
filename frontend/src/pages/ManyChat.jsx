/**
 * ManyChat.jsx — ManyChat Sequence Generator + Broadcast Hub
 *
 * Tabs:
 *   1. Sequence Generator — Claude generates a "0 to Hero" nurture sequence
 *      → displays each message as a step card with copy + broadcast buttons
 *   2. Broadcast — send a one-off message to all subscribers
 *   3. Connection — verify API key status
 *
 * NOTE: ManyChat's public API does not support creating flows/automations
 * programmatically. This page generates the content and lets you send
 * broadcasts or copy messages to paste into ManyChat's flow builder manually.
 */

import { useState, useEffect } from 'react';
import Header                  from '../components/Header';
import { api }                 from '../lib/api';
import SelfImprovementPanel    from '../components/SelfImprovementPanel';

const CHANNEL_OPTS = [
  { value: 'messenger',  label: '💬 Messenger' },
  { value: 'instagram',  label: '📸 Instagram DM' },
  { value: 'sms',        label: '📱 SMS' },
  { value: 'email',      label: '✉️ Email' },
  { value: 'whatsapp',   label: '💬 WhatsApp' },
];

const STEP_COLORS = [
  '#6366f1','#8b5cf6','#a855f7','#ec4899','#f43f5e',
  '#f97316','#eab308','#22c55e','#10b981','#06b6d4',
];

function dayLabel(day) {
  if (day === 0) return 'Day 0 — Instant';
  if (day === 1) return 'Day 1';
  return `Day ${day}`;
}

function CopyButton({ text, small }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button onClick={copy} style={{
      background: copied ? 'rgba(52,211,153,0.15)' : 'rgba(255,255,255,0.07)',
      border: `1px solid ${copied ? 'rgba(52,211,153,0.4)' : 'rgba(255,255,255,0.15)'}`,
      borderRadius: 6, padding: small ? '3px 9px' : '5px 12px',
      fontSize: small ? 11 : 12, color: copied ? '#34d399' : '#9ca3af',
      cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all .2s',
    }}>
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
}

// ── Sequence Step Card ─────────────────────────────────────────────────────────
function StepCard({ step, index, onBroadcast, broadcasting }) {
  const color = STEP_COLORS[index % STEP_COLORS.length];
  return (
    <div style={{
      background: '#1a1a2e', border: `1px solid ${color}33`,
      borderLeft: `3px solid ${color}`, borderRadius: 10, padding: '1rem 1.1rem',
      position: 'relative',
    }}>
      {/* Step badge */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
        <span style={{
          background: `${color}22`, color, border: `1px solid ${color}55`,
          borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 700,
          whiteSpace: 'nowrap', flexShrink: 0,
        }}>
          {dayLabel(step.day)}
        </span>
        <span style={{ fontSize: 11, color: '#6b7280', paddingTop: 2 }}>
          {step.label || ''}
        </span>
        <span style={{
          marginLeft: 'auto', fontSize: 11, color: '#4b5563',
          background: 'rgba(255,255,255,0.05)', borderRadius: 4, padding: '2px 7px',
          flexShrink: 0,
        }}>
          {step.channel}
        </span>
      </div>

      {/* Message */}
      <p style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.65, margin: '0 0 8px', whiteSpace: 'pre-wrap' }}>
        {step.message}
      </p>

      {/* CTA */}
      {step.cta && (
        <div style={{
          display: 'inline-block', background: `${color}18`, border: `1px solid ${color}44`,
          borderRadius: 6, padding: '4px 12px', fontSize: 12, color, fontWeight: 600, marginBottom: 10,
        }}>
          CTA: {step.cta}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <CopyButton text={`${step.message}${step.cta ? '\n\n' + step.cta : ''}`} small />
        <button
          onClick={() => onBroadcast(step)}
          disabled={broadcasting === step.day}
          style={{
            background: broadcasting === step.day ? '#374151' : `${color}22`,
            border: `1px solid ${color}55`, borderRadius: 6,
            padding: '3px 10px', fontSize: 11, color: broadcasting === step.day ? '#6b7280' : color,
            cursor: broadcasting === step.day ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
          }}
        >
          {broadcasting === step.day ? '⟳ Sending…' : '📢 Broadcast Now'}
        </button>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ManyChat() {
  const [tab, setTab] = useState('generator'); // 'generator' | 'broadcast' | 'connection'

  // Connection
  const [connStatus, setConnStatus] = useState(null); // null | 'checking' | 'ok' | 'error'
  const [connInfo,   setConnInfo]   = useState(null);
  const [connError,  setConnError]  = useState('');

  // Generator
  const [topic,     setTopic]     = useState('');
  const [context,   setContext]   = useState('');
  const [channels,  setChannels]  = useState(['messenger']);
  const [steps,     setSteps]     = useState(7);
  const [endDay,    setEndDay]    = useState(30);
  const [generating, setGenerating] = useState(false);
  const [genError,   setGenError]   = useState('');
  const [sequence,   setSequence]   = useState(null); // { topic, sequence: [...] }
  const [broadcasting, setBroadcasting] = useState(null); // day number being broadcast

  // Broadcast
  const [bcastMsg,    setBcastMsg]    = useState('');
  const [bcastBtns,   setBcastBtns]   = useState('');
  const [bcastSending, setBcastSending] = useState(false);
  const [bcastResult,  setBcastResult]  = useState('');

  // Check connection on mount
  useEffect(() => {
    checkConnection();
  }, []);

  async function checkConnection() {
    setConnStatus('checking');
    setConnError('');
    try {
      const d = await api.get('/manychat/info');
      if (d.error) { setConnStatus('error'); setConnError(d.error); return; }
      setConnStatus('ok');
      setConnInfo(d.data);
    } catch (e) {
      setConnStatus('error');
      setConnError(e.message);
    }
  }

  function toggleChannel(val) {
    setChannels(prev =>
      prev.includes(val) ? prev.filter(c => c !== val) : [...prev, val]
    );
  }

  async function handleGenerate() {
    if (!topic.trim()) return;
    setGenerating(true); setGenError(''); setSequence(null);
    try {
      const d = await api.post('/manychat/generate-sequence', {
        topic: topic.trim(),
        context: context.trim() || undefined,
        channels: channels.length ? channels : ['messenger'],
        steps,
        endDay,
      });
      if (d.error) { setGenError(d.error); return; }
      setSequence(d);
    } catch (e) { setGenError(e.message); }
    finally { setGenerating(false); }
  }

  async function handleBroadcastStep(step) {
    setBroadcasting(step.day);
    try {
      const msg = step.message + (step.cta ? `\n\n${step.cta}` : '');
      const d = await api.post('/manychat/broadcast', { message: msg });
      if (d.error) alert('Broadcast error: ' + d.error);
      else alert(`✓ Broadcast sent to all subscribers!`);
    } catch (e) { alert('Error: ' + e.message); }
    finally { setBroadcasting(null); }
  }

  async function handleBroadcast() {
    if (!bcastMsg.trim()) return;
    setBcastSending(true); setBcastResult('');
    try {
      let buttons;
      if (bcastBtns.trim()) {
        buttons = bcastBtns.split('\n').filter(Boolean).map(line => {
          const [label, url] = line.split('|').map(s => s.trim());
          return { label: label || 'Learn More', url: url || '#' };
        });
      }
      const d = await api.post('/manychat/broadcast', { message: bcastMsg, buttons });
      if (d.error) setBcastResult('Error: ' + d.error);
      else setBcastResult('✓ Broadcast sent successfully to all ManyChat subscribers!');
    } catch (e) { setBcastResult('Error: ' + e.message); }
    finally { setBcastSending(false); }
  }

  function downloadSequence() {
    if (!sequence) return;
    const blob = new Blob([JSON.stringify(sequence, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `manychat-sequence-${sequence.topic.replace(/\s+/g,'-').toLowerCase()}.json`;
    a.click(); URL.revokeObjectURL(url);
  }

  const connBadge = connStatus === 'ok'
    ? { color: '#34d399', bg: 'rgba(52,211,153,0.1)', border: 'rgba(52,211,153,0.3)', label: '● Connected' }
    : connStatus === 'error'
    ? { color: '#f87171', bg: 'rgba(239,68,68,0.1)',  border: 'rgba(239,68,68,0.3)',  label: '● Not connected' }
    : { color: '#9ca3af', bg: 'rgba(107,114,128,0.1)',border: 'rgba(107,114,128,0.3)',label: '● Checking…' };

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f1a', color: '#e2e8f0', fontFamily: 'sans-serif' }}>
      <Header />

      {/* ── Sub-nav ── */}
      <div style={{
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(12px)',
        position: 'sticky', top: 53, zIndex: 40,
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: 3, margin: '8px 0' }}>
            {[
              { key: 'generator',  label: '✨ Sequence Generator' },
              { key: 'broadcast',  label: '📢 Broadcast' },
              { key: 'connection', label: '🔌 Connection' },
            ].map(t => (
              <button key={t.key} onClick={() => setTab(t.key)} style={{
                background: tab === t.key ? 'rgba(99,102,241,0.25)' : 'transparent',
                border: 'none', color: tab === t.key ? '#a5b4fc' : '#6b7280',
                fontSize: 12, fontWeight: tab === t.key ? 700 : 500,
                borderRadius: 6, padding: '5px 14px', cursor: 'pointer', whiteSpace: 'nowrap',
              }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Connection badge */}
          <span style={{
            marginLeft: 'auto', fontSize: 11, fontWeight: 700,
            background: connBadge.bg, color: connBadge.color,
            border: `1px solid ${connBadge.border}`,
            borderRadius: 20, padding: '3px 10px',
          }}>
            {connBadge.label}
            {connInfo?.name ? ` — ${connInfo.name}` : ''}
          </span>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '1.5rem 1.5rem' }}>

        {/* ════ SEQUENCE GENERATOR ════ */}
        {tab === 'generator' && (
          <div>
            {/* API limitation notice */}
            <div style={{
              background: 'rgba(14,165,233,0.06)', border: '1px solid rgba(14,165,233,0.2)',
              borderRadius: 10, padding: '0.875rem 1.1rem', marginBottom: '1.25rem',
              display: 'flex', gap: 10, alignItems: 'flex-start',
            }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>ℹ️</span>
              <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.6 }}>
                <strong style={{ color: '#7dd3fc' }}>How this works:</strong>{' '}
                Claude generates a complete nurture sequence for your topic. Each message is shown as a step card.
                You can <strong style={{ color: '#e2e8f0' }}>copy</strong> each message to paste into ManyChat's Flow Builder,
                or <strong style={{ color: '#e2e8f0' }}>Broadcast Now</strong> to send it immediately to all subscribers.
                ManyChat's API does not support creating flows programmatically — content must be pasted into their builder manually.
              </div>
            </div>

            {/* Config form */}
            <div style={{ background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 12, padding: '1.25rem', marginBottom: '1.5rem' }}>
              <p style={{ margin: '0 0 1rem', fontWeight: 700, fontSize: 15, color: '#c7d2fe' }}>
                💙 Generate "0 to Hero" Sequence
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.875rem', marginBottom: '0.875rem' }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 12, color: '#9ca3af', display: 'block', marginBottom: 4 }}>Business / Topic *</label>
                  <input
                    value={topic}
                    onChange={e => setTopic(e.target.value)}
                    placeholder="e.g. Online fitness coaching for busy moms"
                    style={{
                      width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: 8, padding: '8px 12px', color: '#e2e8f0', fontSize: 13, outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 12, color: '#9ca3af', display: 'block', marginBottom: 4 }}>Additional context (optional)</label>
                  <input
                    value={context}
                    onChange={e => setContext(e.target.value)}
                    placeholder="Target audience, offer, tone, key benefits…"
                    style={{
                      width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: 8, padding: '8px 12px', color: '#e2e8f0', fontSize: 13, outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#9ca3af', display: 'block', marginBottom: 4 }}>Messages</label>
                  <select value={steps} onChange={e => setSteps(Number(e.target.value))} style={{
                    width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: 8, padding: '8px 12px', color: '#e2e8f0', fontSize: 13, outline: 'none', cursor: 'pointer',
                  }}>
                    {[3,5,7,10].map(n => <option key={n} value={n}>{n} messages</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#9ca3af', display: 'block', marginBottom: 4 }}>Sequence span</label>
                  <select value={endDay} onChange={e => setEndDay(Number(e.target.value))} style={{
                    width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: 8, padding: '8px 12px', color: '#e2e8f0', fontSize: 13, outline: 'none', cursor: 'pointer',
                  }}>
                    {[7,14,21,30,60,90].map(d => <option key={d} value={d}>{d} days</option>)}
                  </select>
                </div>
              </div>

              {/* Channels */}
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ fontSize: 12, color: '#9ca3af', display: 'block', marginBottom: 6 }}>Channels</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {CHANNEL_OPTS.map(ch => (
                    <button key={ch.value} onClick={() => toggleChannel(ch.value)} style={{
                      background: channels.includes(ch.value) ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.05)',
                      border: `1px solid ${channels.includes(ch.value) ? 'rgba(99,102,241,0.6)' : 'rgba(255,255,255,0.15)'}`,
                      borderRadius: 20, padding: '4px 12px', fontSize: 12,
                      color: channels.includes(ch.value) ? '#a5b4fc' : '#6b7280',
                      cursor: 'pointer',
                    }}>
                      {ch.label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  onClick={handleGenerate}
                  disabled={generating || !topic.trim()}
                  style={{
                    background: generating || !topic.trim() ? '#374151' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    color: '#fff', border: 'none', borderRadius: 8, padding: '9px 24px',
                    fontSize: 13, fontWeight: 700, cursor: generating || !topic.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  {generating ? '⟳ Generating…' : '🤖 Generate Sequence'}
                </button>
                {sequence && (
                  <button onClick={downloadSequence} style={{
                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: 8, padding: '9px 16px', fontSize: 12, color: '#9ca3af', cursor: 'pointer',
                  }}>
                    ⬇ Download JSON
                  </button>
                )}
              </div>

              {genError && (
                <p style={{ color: '#fca5a5', fontSize: 12, marginTop: 8 }}>Error: {genError}</p>
              )}
            </div>

            {/* Generated sequence */}
            {sequence && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: '#e2e8f0' }}>
                      💙 {sequence.sequence?.length || 0}-Step Sequence — {sequence.topic}
                    </p>
                    <p style={{ margin: '3px 0 0', fontSize: 12, color: '#6b7280' }}>
                      Copy each message into ManyChat Flow Builder, or broadcast individual steps to all subscribers.
                    </p>
                  </div>
                  <CopyButton text={sequence.sequence?.map((s,i) => `Step ${i+1} (Day ${s.day} — ${s.channel})\n${s.message}${s.cta ? '\nCTA: ' + s.cta : ''}`).join('\n\n---\n\n')} />
                </div>

                {/* ManyChat setup guide */}
                <div style={{ background: 'rgba(0,132,255,0.05)', border: '1px solid rgba(0,132,255,0.2)', borderRadius: 10, padding: '0.875rem 1.1rem', marginBottom: '1rem' }}>
                  <p style={{ margin: '0 0 0.5rem', fontSize: 12, fontWeight: 700, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    How to add this to ManyChat
                  </p>
                  <ol style={{ margin: 0, padding: '0 0 0 1.1rem', fontSize: 12, color: '#6b7280', lineHeight: 2.1 }}>
                    <li>In ManyChat, go to <strong style={{ color: '#e2e8f0' }}>Automation → Flows</strong> → create a new Flow</li>
                    <li>Add a <strong style={{ color: '#e2e8f0' }}>Send Message</strong> step and paste the Day 0 message</li>
                    <li>Add a <strong style={{ color: '#e2e8f0' }}>Delay</strong> step (e.g. 24h), then the next message</li>
                    <li>Repeat for each step below — delays are shown per card</li>
                    <li>Set the Flow trigger to your opt-in button or keyword</li>
                  </ol>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {(sequence.sequence || []).map((step, i) => (
                    <StepCard
                      key={step.day}
                      step={step}
                      index={i}
                      onBroadcast={handleBroadcastStep}
                      broadcasting={broadcasting}
                    />
                  ))}
                </div>

                {/* Self-improvement panel — auto-starts 3s after generation */}
                <SelfImprovementPanel
                  type="manychat_message"
                  artifact={(sequence.sequence || []).map((s, i) =>
                    `Step ${i + 1} (Day ${s.day} — ${s.channel})\n${s.message}${s.cta ? '\nCTA: ' + s.cta : ''}`
                  ).join('\n\n---\n\n')}
                  context={{ topic: sequence.topic }}
                  label="Message Sequence"
                  autoStart={true}
                  continuous={true}
                  onApply={(improved) => {
                    // Parse improved back into sequence steps
                    const steps = improved.split(/\n---\n/).map((block, i) => {
                      const lines = block.trim().split('\n');
                      const header = lines[0] || '';
                      const dayMatch = header.match(/Day (\d+)/);
                      const chanMatch = header.match(/— (.+)\)/);
                      const ctaIdx = lines.findIndex(l => l.startsWith('CTA:'));
                      const msg = lines.slice(1, ctaIdx > 0 ? ctaIdx : undefined).join('\n').trim();
                      const cta = ctaIdx > 0 ? lines[ctaIdx].replace('CTA:', '').trim() : '';
                      const orig = sequence.sequence[i] || {};
                      return { ...orig, day: dayMatch ? parseInt(dayMatch[1]) : orig.day, channel: chanMatch ? chanMatch[1] : orig.channel, message: msg || orig.message, cta: cta || orig.cta };
                    });
                    setSequence(prev => ({ ...prev, sequence: steps }));
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* ════ BROADCAST ════ */}
        {tab === 'broadcast' && (
          <div style={{ maxWidth: 680 }}>
            <p style={{ margin: '0 0 1.5rem', fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>
              📢 Send Broadcast to All Subscribers
            </p>

            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '1.25rem', marginBottom: '1rem' }}>
              <label style={{ fontSize: 12, color: '#9ca3af', display: 'block', marginBottom: 6 }}>Message *</label>
              <textarea
                value={bcastMsg}
                onChange={e => setBcastMsg(e.target.value)}
                placeholder="Hi {{first name}}! We have exciting news for you..."
                style={{
                  width: '100%', minHeight: 120, background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8,
                  padding: '10px 12px', color: '#e2e8f0', fontSize: 13, lineHeight: 1.6,
                  outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit',
                }}
              />

              <label style={{ fontSize: 12, color: '#9ca3af', display: 'block', margin: '0.875rem 0 4px' }}>
                Buttons (optional) — one per line: <code style={{ color: '#818cf8' }}>Button Label | https://url.com</code>
              </label>
              <textarea
                value={bcastBtns}
                onChange={e => setBcastBtns(e.target.value)}
                placeholder={"Shop Now | https://yourstore.com\nLearn More | https://yoursite.com/about"}
                rows={3}
                style={{
                  width: '100%', background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8,
                  padding: '8px 12px', color: '#e2e8f0', fontSize: 12, lineHeight: 1.6,
                  outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit',
                }}
              />

              <div style={{ marginTop: '1rem', display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  onClick={handleBroadcast}
                  disabled={bcastSending || !bcastMsg.trim()}
                  style={{
                    background: bcastSending || !bcastMsg.trim() ? '#374151' : '#6366f1',
                    color: '#fff', border: 'none', borderRadius: 8, padding: '9px 24px',
                    fontSize: 13, fontWeight: 700, cursor: bcastSending || !bcastMsg.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  {bcastSending ? '⟳ Sending…' : '📢 Send Broadcast'}
                </button>
              </div>

              {bcastResult && (
                <p style={{
                  marginTop: 10, fontSize: 13,
                  color: bcastResult.startsWith('Error') ? '#fca5a5' : '#34d399',
                }}>
                  {bcastResult}
                </p>
              )}
            </div>

            <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, padding: '0.75rem 1rem', fontSize: 12, color: '#6b7280', lineHeight: 1.6 }}>
              ⚠ Broadcasts send to <strong style={{ color: '#fbbf24' }}>all active subscribers</strong> in your ManyChat account immediately.
              Make sure the message is relevant and complies with{' '}
              <a href="https://manychat.com/blog/facebook-messaging-policy/" target="_blank" rel="noreferrer" style={{ color: '#818cf8' }}>
                Facebook's messaging policy ↗
              </a>
            </div>
          </div>
        )}

        {/* ════ CONNECTION ════ */}
        {tab === 'connection' && (
          <div style={{ maxWidth: 560 }}>
            <p style={{ margin: '0 0 1.25rem', fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>
              🔌 ManyChat Connection
            </p>

            {connStatus === 'ok' && connInfo && (
              <div style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.3)', borderRadius: 12, padding: '1.25rem', marginBottom: '1rem' }}>
                <p style={{ margin: '0 0 0.5rem', fontSize: 13, fontWeight: 700, color: '#34d399' }}>● Connected</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[
                    ['Page', connInfo.name || '—'],
                    ['Category', connInfo.category || '—'],
                    ['Subscribers', connInfo.subscribers_count?.toLocaleString() || '—'],
                    ['Bot Status', connInfo.bot_status || '—'],
                  ].map(([label, value]) => (
                    <div key={label} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 6, padding: '8px 10px' }}>
                      <p style={{ margin: 0, fontSize: 11, color: '#6b7280' }}>{label}</p>
                      <p style={{ margin: '2px 0 0', fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {connStatus === 'error' && (
              <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, padding: '1.25rem', marginBottom: '1rem' }}>
                <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700, color: '#f87171' }}>● Not connected</p>
                <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>{connError}</p>
              </div>
            )}

            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '1.25rem' }}>
              <p style={{ margin: '0 0 0.75rem', fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>Setup Instructions</p>
              <ol style={{ margin: '0 0 1rem', padding: '0 0 0 1.1rem', fontSize: 12, color: '#6b7280', lineHeight: 2.1 }}>
                <li>Go to <a href="https://manychat.com" target="_blank" rel="noreferrer" style={{ color: '#818cf8' }}>manychat.com ↗</a> and log in</li>
                <li>Navigate to <strong style={{ color: '#e2e8f0' }}>Settings → API</strong></li>
                <li>Click <strong style={{ color: '#e2e8f0' }}>Generate API Key</strong></li>
                <li>Copy the key and paste it in <strong style={{ color: '#e2e8f0' }}>Settings → Integration Hub → ManyChat</strong></li>
              </ol>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={checkConnection} style={{
                  background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8,
                  padding: '8px 18px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}>
                  {connStatus === 'checking' ? '⟳ Checking…' : '↻ Re-check Connection'}
                </button>
                <a
                  href="/ui/settings"
                  style={{
                    display: 'inline-flex', alignItems: 'center',
                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: 8, padding: '8px 16px', fontSize: 12, color: '#9ca3af',
                    textDecoration: 'none',
                  }}
                >
                  ⚙️ Go to Settings
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
