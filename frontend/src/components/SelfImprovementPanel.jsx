/**
 * SelfImprovementPanel.jsx — autoresearch exploit-or-revert loop UI
 *
 * Two separate AI roles are shown explicitly:
 *   Haiku  → Fixed scorer  (fast, cheap, tamper-proof rubric)
 *   Sonnet → Generator     (quality improvement, reads the ledger)
 */

import { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';

const TYPE_LABELS = {
  ad_copy:          'Ad Copy',
  agent_prompt:     'Agent Instructions',
  brain_answer:     'Answer',
  funnel_page:      'Funnel Page Copy',
  manychat_message: 'Message Sequence',
};

// ── Animated number hook ──────────────────────────────────────────────────────
function useCountUp(target, duration = 550) {
  const [val, setVal] = useState(0);
  const prev = useRef(0);

  useEffect(() => {
    if (target === null || target === undefined) return;
    const from = prev.current;
    prev.current = target;
    if (from === target) return;

    let start = null;
    function tick(ts) {
      if (!start) start = ts;
      const t = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setVal(Math.round(from + (target - from) * eased));
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }, [target, duration]);

  return val;
}

// ── AI role chip ──────────────────────────────────────────────────────────────
// role: 'scorer' (blue) | 'generator' (purple)
function RoleChip({ name, role, displayName, active, task }) {
  const isScorer = role === 'scorer';
  const color    = isScorer ? '#60a5fa' : '#a78bfa';
  const bg       = isScorer ? 'rgba(96,165,250,0.1)' : 'rgba(167,139,250,0.1)';
  const border   = isScorer ? 'rgba(96,165,250,0.25)' : 'rgba(167,139,250,0.25)';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '5px 9px', borderRadius: 7,
      background: active ? bg : 'rgba(255,255,255,0.03)',
      border: `1px solid ${active ? border : 'rgba(255,255,255,0.07)'}`,
      opacity: active ? 1 : 0.4,
      transition: 'all .25s ease',
      flex: 1,
    }}>
      {/* Pulsing dot */}
      <span style={{
        width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
        background: active ? color : 'rgba(255,255,255,0.2)',
        boxShadow: active ? `0 0 6px ${color}` : 'none',
        animation: active ? 'pulse 1.4s ease-in-out infinite' : 'none',
      }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: active ? color : 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', lineHeight: 1.2 }}>
          {name}
        </div>
        <div style={{ fontSize: 9, color: active ? 'var(--text-secondary)' : 'var(--text-muted)', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {active ? task : displayName}
        </div>
      </div>
    </div>
  );
}

// ── Score display with animated bar ──────────────────────────────────────────
function ScoreDisplay({ scoreData, label }) {
  const animated = useCountUp(scoreData?.score ?? 0);
  const score    = scoreData?.score ?? 0;
  const color    = score >= 80 ? '#4ade80' : score >= 60 ? '#facc15' : '#f87171';
  const glow     = score >= 80 ? '#4ade8055' : score >= 60 ? '#facc1555' : '#f8717155';

  return (
    <div style={{ marginBottom: 12 }}>
      {/* Score header row */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 7 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {label}
        </span>
        <span style={{
          marginLeft: 'auto', fontSize: 18, fontWeight: 800, color,
          fontVariantNumeric: 'tabular-nums',
          textShadow: `0 0 12px ${glow}`,
          transition: 'color .3s',
        }}>
          {animated}
          <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-muted)', marginLeft: 2 }}>/100</span>
        </span>
      </div>

      {/* Main bar */}
      <div style={{ height: 5, background: 'rgba(255,255,255,0.07)', borderRadius: 99, overflow: 'hidden', marginBottom: 9 }}>
        <div style={{
          width: `${score}%`, height: '100%', borderRadius: 99,
          background: `linear-gradient(90deg, ${color}99, ${color})`,
          boxShadow: `0 0 8px ${glow}`,
          transition: 'width .55s cubic-bezier(.4,0,.2,1)',
        }} />
      </div>

      {/* Per-criterion breakdown */}
      {scoreData?.breakdown && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {Object.entries(scoreData.breakdown).map(([k, v]) => {
            const c = v >= 16 ? '#4ade80' : v >= 12 ? '#facc15' : '#f87171';
            const pct = (v / 20) * 100;
            return (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ fontSize: 9, color: 'var(--text-muted)', width: 90, flexShrink: 0, textTransform: 'capitalize' }}>{k}</span>
                <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: c, borderRadius: 99, transition: 'width .5s cubic-bezier(.4,0,.2,1)' }} />
                </div>
                <span style={{ fontSize: 9, color: c, minWidth: 24, textAlign: 'right', fontWeight: 700 }}>{v}/20</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Feedback note */}
      {scoreData?.feedback && (
        <div style={{ marginTop: 8, padding: '6px 9px', borderRadius: 7, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.18)', fontSize: 9.5, color: '#fde68a', lineHeight: 1.5 }}>
          <strong style={{ color: '#fbbf24' }}>{scoreData.weakest}</strong>
          {' '}· {scoreData.feedback}
        </div>
      )}
    </div>
  );
}

// ── Ledger row ────────────────────────────────────────────────────────────────
function LedgerRow({ entry, index, scorerLabel = 'Haiku', generatorLabel = 'Sonnet' }) {
  const kept  = entry.decision === 'kept';
  const crash = entry.decision === 'crash';
  const delta = entry.newScore - entry.oldScore;
  const bg     = kept ? 'rgba(74,222,128,0.04)' : crash ? 'rgba(251,191,36,0.04)' : 'rgba(248,113,113,0.04)';
  const border = kept ? 'rgba(74,222,128,0.14)' : crash ? 'rgba(251,191,36,0.2)' : 'rgba(248,113,113,0.11)';

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 9px', borderRadius: 7, background: bg, border: `1px solid ${border}`, marginBottom: 3 }}>
      {/* Index */}
      <span style={{ fontSize: 9, color: 'var(--text-muted)', minWidth: 14, marginTop: 1, flexShrink: 0 }}>#{entry.iteration}</span>

      {/* Description + models */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 9.5, color: 'var(--text-secondary)', lineHeight: 1.4, marginBottom: 3 }}>
          {entry.description}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Generator badge */}
          <span style={{ fontSize: 8.5, color: '#a78bfa', background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.2)', borderRadius: 4, padding: '1px 5px' }}>
            {generatorLabel}
          </span>
          {/* Arrow */}
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>→</span>
          {/* Scorer badge */}
          <span style={{ fontSize: 8.5, color: '#60a5fa', background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: 4, padding: '1px 5px' }}>
            {scorerLabel}
          </span>
          {/* Score delta */}
          {!crash && (
            <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 2 }}>
              {entry.oldScore} → {entry.newScore}
              <span style={{ marginLeft: 4, fontWeight: 700, color: delta > 0 ? '#4ade80' : delta < 0 ? '#f87171' : '#9ca3af' }}>
                {delta > 0 ? `+${delta}` : delta === 0 ? '±0' : delta}
              </span>
            </span>
          )}
          {/* Decision badge */}
          <span style={{
            marginLeft: 'auto', fontSize: 8.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
            color: kept ? '#4ade80' : crash ? '#fbbf24' : '#f87171',
          }}>
            {kept ? '✓ kept' : crash ? '⚠ crash' : '✗ discarded'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function SelfImprovementPanel({ type, artifact, context = {}, onApply, label, autoStart = false, continuous = false }) {
  const { locationId } = useApp();
  const [phase,        setPhase]        = useState('idle');
  const [activeRole,   setActiveRole]   = useState(null);   // 'scorer' | 'generator' | null
  const [roleTask,     setRoleTask]     = useState('');
  const [providerInfo, setProviderInfo] = useState({ scorerLabel: 'Haiku', generatorLabel: 'Sonnet', provider: 'anthropic' });
  const [scoreData,    setScoreData]    = useState(null);
  const [ledger,       setLedger]       = useState([]);
  const [bestArtifact, setBestArtifact] = useState('');
  const [bestScore,    setBestScore]    = useState(null);
  const [iterations,   setIterations]   = useState(3);
  const [error,        setError]        = useState('');
  const [expanded,     setExpanded]     = useState(false);
  const [totalRounds,  setTotalRounds]  = useState(0);
  const abortRef      = useRef(false);
  const runningRef    = useRef(false);
  const autoFiredRef  = useRef(false);
  const continuousRef = useRef(continuous);
  continuousRef.current = continuous;

  const displayLabel = label || TYPE_LABELS[type] || 'Content';

  // Auto-start 3 seconds after the answer appears
  useEffect(() => {
    if (!autoStart || autoFiredRef.current || !artifact?.trim()) return;
    autoFiredRef.current = true;
    const timer = setTimeout(() => { if (!runningRef.current) runLoop(artifact); }, 3000);
    return () => clearTimeout(timer);
  }, [autoStart, artifact]); // eslint-disable-line react-hooks/exhaustive-deps

  async function apiFetch(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-location-id': locationId },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function runLoop(artifactInput) {
    const startArtifact = (typeof artifactInput === 'string' && artifactInput.trim()) ? artifactInput : artifact;
    if (!startArtifact?.trim() || runningRef.current) return;
    runningRef.current = true;
    setPhase('running');
    setError('');
    setLedger([]);
    setBestArtifact(startArtifact);
    setBestScore(null);
    abortRef.current = false;
    const localLedger = [];
    let localBest = startArtifact;

    try {
      // ── Baseline score ──────────────────────────────────────────────────
      setActiveRole('scorer'); setRoleTask('Scoring baseline…');
      const baseline = await apiFetch('/improve/score', { type, artifact: startArtifact, context });
      setScoreData(baseline);
      setBestScore(baseline.score);
      // Pick up provider/model labels from first response
      if (baseline.scorerLabel) {
        setProviderInfo({ scorerLabel: baseline.scorerLabel, generatorLabel: baseline.generatorLabel || 'Sonnet', provider: baseline.provider || 'anthropic' });
      }

      let current     = startArtifact;
      let currentData = baseline;

      // ── Exploit-or-revert loop ──────────────────────────────────────────
      for (let i = 0; i < iterations; i++) {
        if (abortRef.current) break;

        // Generator writes improvement
        setActiveRole('generator'); setRoleTask(`Iter ${i + 1}/${iterations} — writing improvement…`);
        let genResult;
        try {
          genResult = await apiFetch('/improve/generate', {
            type, artifact: current, context,
            score: currentData.score, weakest: currentData.weakest,
            feedback: currentData.feedback, ledger: localLedger,
          });
        } catch (e) {
          localLedger.push({ iteration: i + 1, description: `Generation failed: ${e.message}`, oldScore: currentData.score, newScore: 0, decision: 'crash' });
          setLedger([...localLedger]);
          continue;
        }

        if (abortRef.current) break;

        // Scorer evaluates the improvement
        setActiveRole('scorer'); setRoleTask(`Iter ${i + 1}/${iterations} — scoring result…`);
        let newData;
        try {
          newData = await apiFetch('/improve/score', { type, artifact: genResult.improved, context });
        } catch (e) {
          localLedger.push({ iteration: i + 1, description: genResult.description || '—', oldScore: currentData.score, newScore: 0, decision: 'crash' });
          setLedger([...localLedger]);
          continue;
        }

        // Exploit or revert
        const decision = newData.score > currentData.score ? 'kept' : 'discarded';
        localLedger.push({ iteration: i + 1, description: genResult.description || '—', oldScore: currentData.score, newScore: newData.score, decision, improved: genResult.improved });
        setLedger([...localLedger]);

        if (decision === 'kept') {
          current     = genResult.improved;
          currentData = newData;
          setScoreData(newData);
          setBestArtifact(current);
          setBestScore(newData.score);
          localBest   = current;
        }
      }

      setActiveRole(null); setRoleTask('');
      runningRef.current = false;

      const improved = localBest !== startArtifact;

      // Auto-apply whenever an improvement is found
      if (improved) onApply?.(localBest);

      // Continuous mode: rerun automatically if improvement was found, stop if plateau
      if (continuousRef.current && !abortRef.current && improved) {
        setTotalRounds(r => r + 1);
        setLedger([]);
        setScoreData(null);
        setBestScore(null);
        setBestArtifact('');
        setTimeout(() => runLoop(localBest), 2000);
      } else {
        setPhase('done');
      }
    } catch (e) {
      // Show a clean error message — strip any raw HTTP 400 JSON dump
      const msg = e.message?.length > 200 ? e.message.slice(0, 200) + '…' : e.message;
      setError(msg);
      setActiveRole(null); setRoleTask('');
      setPhase('error');
      runningRef.current = false;
    }
  }

  function handleStop() {
    abortRef.current = true;
    runningRef.current = false;
    setActiveRole(null); setRoleTask('');
    setPhase('done');
  }

  function handleRerun() {
    setPhase('idle'); setLedger([]); setScoreData(null);
    setBestScore(null); setBestArtifact(''); setTotalRounds(0); setExpanded(true);
    setTimeout(() => runLoop(artifact), 0);
  }

  if (!artifact?.trim()) return null;

  const keptCount      = ledger.filter(e => e.decision === 'kept').length;
  const discardedCount = ledger.filter(e => e.decision === 'discarded').length;

  return (
    <div style={{ marginTop: 14, borderRadius: 10, border: '1px solid rgba(99,102,241,0.18)', background: 'rgba(99,102,241,0.04)', overflow: 'hidden' }}>

      {/* ── Header ── */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer', borderBottom: expanded ? '1px solid rgba(99,102,241,0.15)' : 'none' }}
      >
        <span style={{ fontSize: 12 }}>🔬</span>
        <span style={{ flex: 1, fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          Auto-Improve {displayLabel}
          {continuous && (
            <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 99, background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)', color: '#a5b4fc' }}>
              ♾ Auto
            </span>
          )}
          {totalRounds > 0 && (
            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
              Round {totalRounds + 1}
            </span>
          )}
          {bestScore !== null && (
            <span style={{ fontSize: 9.5, fontWeight: 600, padding: '2px 6px', borderRadius: 99, background: 'rgba(99,102,241,0.15)', color: '#a5b4fc' }}>
              Best: {bestScore}/100
            </span>
          )}
        </span>

        {phase === 'idle' && (
          <button onClick={e => { e.stopPropagation(); setExpanded(true); runLoop(artifact); }}
            style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 5, background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.35)', color: '#a5b4fc', cursor: 'pointer' }}>
            ▶ Run
          </button>
        )}
        {phase === 'running' && (
          <button onClick={e => { e.stopPropagation(); handleStop(); }}
            style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 5, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', cursor: 'pointer' }}>
            ■ Stop
          </button>
        )}
        {(phase === 'done' || phase === 'error') && (
          <button onClick={e => { e.stopPropagation(); handleRerun(); }}
            style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 5, background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.25)', color: '#4ade80', cursor: 'pointer' }}>
            ↺ Re-run
          </button>
        )}
        <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div style={{ padding: '12px 12px 12px' }}>

          {/* ── Iterations picker (idle only) ── */}
          {phase === 'idle' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
              <span style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>Iterations:</span>
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} onClick={() => setIterations(n)} style={{
                  width: 24, height: 24, borderRadius: 5, fontSize: 10, fontWeight: 700, cursor: 'pointer',
                  background: iterations === n ? 'rgba(99,102,241,0.25)' : 'transparent',
                  border: `1px solid ${iterations === n ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.1)'}`,
                  color: iterations === n ? '#a5b4fc' : 'var(--text-muted)',
                }}>{n}</button>
              ))}
              <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 2 }}>≈ {iterations * 2} calls · ~{iterations * 10}s</span>
            </div>
          )}

          {/* ── Two AI role chips ── */}
          {phase === 'running' && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              <RoleChip
                name="Scorer"
                role="scorer"
                displayName={providerInfo.scorerLabel}
                active={activeRole === 'scorer'}
                task={roleTask}
              />
              <RoleChip
                name="Generator"
                role="generator"
                displayName={providerInfo.generatorLabel}
                active={activeRole === 'generator'}
                task={roleTask}
              />
            </div>
          )}

          {/* ── Role legend (after loop, or idle) ── */}
          {(phase === 'idle' || phase === 'done') && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderRadius: 6, background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.18)', flex: 1 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#60a5fa', flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 8.5, fontWeight: 700, color: '#60a5fa', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{providerInfo.scorerLabel} · Scorer</div>
                  <div style={{ fontSize: 8, color: 'var(--text-muted)' }}>Fixed rubric — judges every version</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderRadius: 6, background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.18)', flex: 1 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#a78bfa', flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 8.5, fontWeight: 700, color: '#a78bfa', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{providerInfo.generatorLabel} · Generator</div>
                  <div style={{ fontSize: 8, color: 'var(--text-muted)' }}>Reads ledger — writes improvements</div>
                </div>
              </div>
            </div>
          )}

          {/* ── Error ── */}
          {phase === 'error' && error && (
            <div style={{ marginBottom: 10, padding: '6px 10px', borderRadius: 7, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)', fontSize: 10, color: '#fca5a5' }}>
              ⚠️ {error}
            </div>
          )}

          {/* ── Score + breakdown ── */}
          {scoreData && (
            <ScoreDisplay
              scoreData={scoreData}
              label={phase === 'done' ? 'Final Score' : 'Current Score'}
            />
          )}

          {/* ── Iteration ledger ── */}
          {ledger.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                Iteration Log
                <span style={{ fontSize: 9, fontWeight: 400 }}>
                  {keptCount > 0 && <span style={{ color: '#4ade80' }}>✓ {keptCount} kept</span>}
                  {keptCount > 0 && discardedCount > 0 && <span style={{ color: 'var(--text-muted)' }}> · </span>}
                  {discardedCount > 0 && <span style={{ color: '#f87171' }}>✗ {discardedCount} discarded</span>}
                </span>
              </div>
              {ledger.map((entry, i) => <LedgerRow key={i} entry={entry} index={i} scorerLabel={providerInfo.scorerLabel} generatorLabel={providerInfo.generatorLabel} />)}
            </div>
          )}

          {/* ── Apply / Copy ── */}
          {phase === 'done' && bestArtifact && bestArtifact !== artifact && (
            <div style={{ display: 'flex', gap: 6 }}>
              {onApply && (
                <button onClick={() => onApply(bestArtifact)} style={{
                  flex: 1, padding: '6px 12px', borderRadius: 7, fontSize: 10, fontWeight: 700,
                  background: 'rgba(74,222,128,0.13)', border: '1px solid rgba(74,222,128,0.28)',
                  color: '#4ade80', cursor: 'pointer',
                }}>
                  ✓ Apply Best ({bestScore}/100)
                </button>
              )}
              <button onClick={() => navigator.clipboard.writeText(bestArtifact)} style={{
                padding: '6px 12px', borderRadius: 7, fontSize: 10, fontWeight: 600,
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                color: 'var(--text-secondary)', cursor: 'pointer',
              }}>
                Copy
              </button>
            </div>
          )}
          {phase === 'done' && bestArtifact === artifact && ledger.length > 0 && (
            <div style={{ fontSize: 9.5, color: 'var(--text-muted)', textAlign: 'center', padding: '6px 0' }}>
              Already optimal — no improvements found.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
