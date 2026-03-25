/**
 * SelfImprovementPanel.jsx
 *
 * Implements the autoresearch exploit-or-revert loop in the UI:
 *   Score current artifact → Generate improvement → Score it
 *   → Keep if better, discard if not → Repeat N times
 *
 * Props:
 *   type       — 'ad_copy' | 'agent_prompt' | 'brain_answer' | 'funnel_page' | 'manychat_message'
 *   artifact   — string: the content to improve
 *   context    — object: extra context (e.g. { query } for brain_answer)
 *   onApply    — optional function(improved: string): called when user clicks Apply
 *   label      — optional display label (default inferred from type)
 */

import { useState, useRef } from 'react';
import { useApp } from '../context/AppContext';

const TYPE_LABELS = {
  ad_copy:           'Ad Copy',
  agent_prompt:      'Agent Instructions',
  brain_answer:      'Answer',
  funnel_page:       'Funnel Page Copy',
  manychat_message:  'Message Sequence',
};

function ScoreBar({ score }) {
  const color = score >= 80 ? '#4ade80' : score >= 60 ? '#facc15' : '#f87171';
  const glow  = score >= 80 ? '#4ade8055' : score >= 60 ? '#facc1555' : '#f8717155';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{
          width: `${score}%`, height: '100%', borderRadius: 99,
          background: color, boxShadow: `0 0 6px ${glow}`,
          transition: 'width .4s ease',
        }} />
      </div>
      <span style={{ fontSize: 13, fontWeight: 700, color, minWidth: 38, textAlign: 'right' }}>{score}/100</span>
    </div>
  );
}

function BreakdownRow({ label, val }) {
  const color = val >= 16 ? '#4ade80' : val >= 12 ? '#facc15' : '#f87171';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
      <span style={{ color: 'var(--text-muted)', width: 110, flexShrink: 0, textTransform: 'capitalize' }}>{label}</span>
      <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.07)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${(val / 20) * 100}%`, height: '100%', background: color, borderRadius: 99 }} />
      </div>
      <span style={{ color, fontSize: 10, minWidth: 28, textAlign: 'right', fontWeight: 600 }}>{val}/20</span>
    </div>
  );
}

function LedgerRow({ entry }) {
  const kept = entry.decision === 'kept';
  const delta = entry.newScore - entry.oldScore;
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '8px 10px', borderRadius: 8,
      background: kept ? 'rgba(74,222,128,0.05)' : 'rgba(248,113,113,0.05)',
      border: `1px solid ${kept ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.12)'}`,
      marginBottom: 4,
    }}>
      <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>{kept ? '✓' : '✗'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4, marginBottom: 3 }}>
          {entry.description}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>#{entry.iteration}</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{entry.oldScore} → {entry.newScore}</span>
          <span style={{
            fontSize: 10, fontWeight: 700,
            color: delta > 0 ? '#4ade80' : delta < 0 ? '#f87171' : '#9ca3af',
          }}>
            {delta > 0 ? `+${delta}` : delta}
          </span>
          <span style={{
            marginLeft: 'auto', fontSize: 9, fontWeight: 700,
            color: kept ? '#4ade80' : '#f87171',
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>{entry.decision}</span>
        </div>
      </div>
    </div>
  );
}

export default function SelfImprovementPanel({ type, artifact, context = {}, onApply, label }) {
  const { locationId } = useApp();
  const [phase,        setPhase]        = useState('idle');   // idle | running | done | error
  const [scoreData,    setScoreData]    = useState(null);     // current score + breakdown
  const [ledger,       setLedger]       = useState([]);
  const [bestArtifact, setBestArtifact] = useState('');
  const [bestScore,    setBestScore]    = useState(null);
  const [iterations,   setIterations]   = useState(3);
  const [statusMsg,    setStatusMsg]    = useState('');
  const [error,        setError]        = useState('');
  const [expanded,     setExpanded]     = useState(false);
  const abortRef = useRef(false);

  const displayLabel = label || TYPE_LABELS[type] || 'Content';

  async function apiFetch(path, body) {
    const res = await fetch(path, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-location-id': locationId },
      body:    JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function runLoop() {
    if (!artifact?.trim()) return;
    setPhase('running');
    setError('');
    setLedger([]);
    setBestArtifact(artifact);
    abortRef.current = false;
    const localLedger = [];

    try {
      // ── Step 0: score baseline ──────────────────────────────────────────
      setStatusMsg('Scoring current version…');
      const baseline = await apiFetch('/improve/score', { type, artifact, context });
      setScoreData(baseline);
      setBestArtifact(artifact);
      setBestScore(baseline.score);

      let current     = artifact;
      let currentData = baseline;

      // ── Exploit-or-revert loop (autoresearch pattern) ───────────────────
      for (let i = 0; i < iterations; i++) {
        if (abortRef.current) break;

        setStatusMsg(`Iteration ${i + 1}/${iterations} — generating improvement…`);
        let genResult;
        try {
          genResult = await apiFetch('/improve/generate', {
            type, artifact: current, context,
            score: currentData.score, weakest: currentData.weakest,
            feedback: currentData.feedback, ledger: localLedger,
          });
        } catch (genErr) {
          localLedger.push({ iteration: i + 1, description: `Generation failed: ${genErr.message}`, oldScore: currentData.score, newScore: 0, decision: 'crash' });
          setLedger([...localLedger]);
          continue;
        }

        if (abortRef.current) break;

        setStatusMsg(`Iteration ${i + 1}/${iterations} — scoring improvement…`);
        let newData;
        try {
          newData = await apiFetch('/improve/score', { type, artifact: genResult.improved, context });
        } catch (scoreErr) {
          localLedger.push({ iteration: i + 1, description: genResult.description || '—', oldScore: currentData.score, newScore: 0, decision: 'crash' });
          setLedger([...localLedger]);
          continue;
        }

        // Exploit or revert
        const decision = newData.score > currentData.score ? 'kept' : 'discarded';
        const entry = {
          iteration:   i + 1,
          description: genResult.description || '—',
          oldScore:    currentData.score,
          newScore:    newData.score,
          decision,
          improved:    genResult.improved,
        };
        localLedger.push(entry);
        setLedger([...localLedger]);

        if (decision === 'kept') {
          current     = genResult.improved;
          currentData = newData;
          setScoreData(newData);
          setBestArtifact(current);
          setBestScore(newData.score);
        }
        // else: discard — revert to current (no state change needed)
      }

      setStatusMsg('');
      setPhase('done');
    } catch (e) {
      setError(e.message);
      setPhase('error');
      setStatusMsg('');
    }
  }

  function handleStop() {
    abortRef.current = true;
    setPhase('done');
    setStatusMsg('');
  }

  if (!artifact?.trim()) return null;

  const panelBg    = 'rgba(99,102,241,0.06)';
  const panelBorder = 'rgba(99,102,241,0.18)';

  return (
    <div style={{
      marginTop: 16,
      borderRadius: 12,
      border: `1px solid ${panelBorder}`,
      background: panelBg,
      overflow: 'hidden',
    }}>
      {/* ── Header ── */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', cursor: 'pointer',
          borderBottom: expanded ? `1px solid ${panelBorder}` : 'none',
        }}
      >
        <span style={{ fontSize: 14 }}>🔬</span>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
          Auto-Improve {displayLabel}
          {bestScore !== null && (
            <span style={{
              marginLeft: 8, fontSize: 10, fontWeight: 600, padding: '2px 7px',
              borderRadius: 99, background: 'rgba(99,102,241,0.15)', color: '#a5b4fc',
            }}>
              Best: {bestScore}/100
            </span>
          )}
        </span>
        {phase === 'idle' && (
          <button
            onClick={e => { e.stopPropagation(); setExpanded(true); runLoop(); }}
            style={{
              fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 6,
              background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.35)',
              color: '#a5b4fc', cursor: 'pointer',
            }}
          >
            ▶ Run
          </button>
        )}
        {phase === 'running' && (
          <button
            onClick={e => { e.stopPropagation(); handleStop(); }}
            style={{
              fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 6,
              background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)',
              color: '#fca5a5', cursor: 'pointer',
            }}
          >
            ■ Stop
          </button>
        )}
        {phase === 'done' && (
          <button
            onClick={e => { e.stopPropagation(); setPhase('idle'); setLedger([]); setScoreData(null); setBestScore(null); setBestArtifact(''); setExpanded(true); runLoop(); }}
            style={{
              fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 6,
              background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.25)',
              color: '#4ade80', cursor: 'pointer',
            }}
          >
            ↺ Re-run
          </button>
        )}
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div style={{ padding: '14px 14px' }}>
          {/* ── Iterations selector (idle only) ── */}
          {phase === 'idle' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Iterations:</span>
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  onClick={() => setIterations(n)}
                  style={{
                    width: 28, height: 28, borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    background: iterations === n ? 'rgba(99,102,241,0.25)' : 'transparent',
                    border: `1px solid ${iterations === n ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.1)'}`,
                    color: iterations === n ? '#a5b4fc' : 'var(--text-muted)',
                  }}
                >
                  {n}
                </button>
              ))}
              <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>
                ≈ {iterations * 2} AI calls · ~{iterations * 10}s
              </span>
            </div>
          )}

          {/* ── Running status ── */}
          {phase === 'running' && statusMsg && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 11, color: '#a5b4fc' }}>
              <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span>
              {statusMsg}
            </div>
          )}

          {/* ── Error ── */}
          {phase === 'error' && error && (
            <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', fontSize: 11, color: '#fca5a5' }}>
              ⚠️ {error}
            </div>
          )}

          {/* ── Current score ── */}
          {scoreData && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>
                  {phase === 'done' ? 'Final Score' : 'Current Score'}
                </span>
              </div>
              <ScoreBar score={scoreData.score} />
              {scoreData.breakdown && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 10 }}>
                  {Object.entries(scoreData.breakdown).map(([k, v]) => (
                    <BreakdownRow key={k} label={k} val={v} />
                  ))}
                </div>
              )}
              {scoreData.feedback && (
                <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.2)', fontSize: 11, color: '#fde68a', lineHeight: 1.5 }}>
                  💡 <strong>{scoreData.weakest}</strong>: {scoreData.feedback}
                </div>
              )}
            </div>
          )}

          {/* ── Iteration ledger ── */}
          {ledger.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>
                Iteration History
                <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>
                  ({ledger.filter(e => e.decision === 'kept').length} kept · {ledger.filter(e => e.decision === 'discarded').length} discarded)
                </span>
              </div>
              {ledger.map((entry, i) => <LedgerRow key={i} entry={entry} />)}
            </div>
          )}

          {/* ── Apply / Copy best ── */}
          {phase === 'done' && bestArtifact && bestArtifact !== artifact && (
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              {onApply && (
                <button
                  onClick={() => onApply(bestArtifact)}
                  style={{
                    flex: 1, padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                    background: 'rgba(74,222,128,0.15)', border: '1px solid rgba(74,222,128,0.3)',
                    color: '#4ade80', cursor: 'pointer',
                  }}
                >
                  ✓ Apply Best Version ({bestScore}/100)
                </button>
              )}
              <button
                onClick={() => navigator.clipboard.writeText(bestArtifact)}
                style={{
                  padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                  color: 'var(--text-secondary)', cursor: 'pointer',
                }}
              >
                Copy
              </button>
            </div>
          )}
          {phase === 'done' && bestArtifact === artifact && ledger.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: '8px 0' }}>
              Original was already optimal — no improvements found.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
