import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

const COUNTRIES = [
  { code: 'US', label: 'United States' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'CA', label: 'Canada' },
  { code: 'AU', label: 'Australia' },
  { code: 'PH', label: 'Philippines' },
  { code: 'IN', label: 'India' },
  { code: 'DE', label: 'Germany' },
  { code: 'FR', label: 'France' },
  { code: 'SG', label: 'Singapore' },
  { code: 'NZ', label: 'New Zealand' },
];

const STATUS_OPTS = [
  { value: 'ALL',      label: 'All Ads' },
  { value: 'ACTIVE',   label: 'Active Only' },
  { value: 'INACTIVE', label: 'Inactive Only' },
];

const FOCUS_OPTS = [
  { value: 'all',       label: 'Full Analysis' },
  { value: 'messaging', label: 'Messaging & Hooks' },
  { value: 'targeting', label: 'Targeting Signals' },
  { value: 'creative',  label: 'Creative Patterns' },
];

const sx = {
  page:      { minHeight: '100vh', background: '#0f0f1a', color: '#e2e8f0', fontFamily: 'sans-serif' },
  header:    { borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(12px)', position: 'sticky', top: 0, zIndex: 40 },
  hInner:    { maxWidth: 1200, margin: '0 auto', padding: '0 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', height: 56 },
  body:      { maxWidth: 1200, margin: '0 auto', padding: '1.5rem' },
  card:      { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '1rem 1.25rem' },
  label:     { fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4, display: 'block' },
  input:     { width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '8px 12px', color: '#e2e8f0', fontSize: 14, outline: 'none', boxSizing: 'border-box' },
  select:    { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '8px 12px', color: '#e2e8f0', fontSize: 13, outline: 'none', cursor: 'pointer' },
  btn:       { background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 22px', fontWeight: 700, fontSize: 14, cursor: 'pointer', transition: 'opacity .15s' },
  btnSm:     { background: 'rgba(99,102,241,0.2)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.35)', borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  btnGhost:  { background: 'transparent', color: '#9ca3af', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer' },
  chip:      { display: 'inline-block', background: 'rgba(255,255,255,0.06)', borderRadius: 4, padding: '2px 8px', fontSize: 11, color: '#9ca3af', marginRight: 4 },
  adCard:    { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '1rem', cursor: 'pointer', transition: 'border-color .15s' },
  adCardSel: { background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.5)', borderRadius: 10, padding: '1rem', cursor: 'pointer' },
  err:       { background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '0.75rem 1rem', fontSize: 13, color: '#fca5a5' },
  prose:     { fontSize: 14, lineHeight: 1.7, color: '#cbd5e1', whiteSpace: 'pre-wrap' },
};

function impressionLabel(imp) {
  if (!imp) return null;
  return `${Number(imp.lower_bound).toLocaleString()}–${Number(imp.upper_bound).toLocaleString()} impressions`;
}

function spendLabel(sp) {
  if (!sp) return null;
  return `$${Number(sp.lower_bound).toLocaleString()}–$${Number(sp.upper_bound).toLocaleString()} spend`;
}

export default function AdLibrary() {
  const [query,    setQuery]    = useState('');
  const [country,  setCountry]  = useState('US');
  const [status,   setStatus]   = useState('ALL');
  const [focus,    setFocus]    = useState('all');
  const [ads,      setAds]      = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading,  setLoading]  = useState(false);
  const [analyzing,setAnalyzing]= useState(false);
  const [error,    setError]    = useState('');
  const [analysis, setAnalysis] = useState('');
  const [searched, setSearched] = useState(false);
  const analysisRef = useRef(null);

  async function handleSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true); setError(''); setAds([]); setSelected(new Set()); setAnalysis(''); setSearched(true);
    try {
      const d = await api.get(`/ad-library/search?q=${encodeURIComponent(query)}&country=${country}&status=${status}&limit=25`);
      if (d.error) { setError(d.error + (d.hint ? ' ' + d.hint : '')); return; }
      setAds(Array.isArray(d.data) ? d.data : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function toggleAd(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectAll() { setSelected(new Set(ads.map(a => a.id))); }
  function clearSel()  { setSelected(new Set()); }

  async function handleAnalyze() {
    const toAnalyze = selected.size > 0 ? ads.filter(a => selected.has(a.id)) : ads;
    if (!toAnalyze.length) return;
    setAnalyzing(true); setAnalysis(''); setError('');
    try {
      const d = await api.post('/ad-library/analyze', { ads: toAnalyze, focus, competitor: query });
      if (d.error) { setError(d.error); return; }
      setAnalysis(d.analysis || '');
      setTimeout(() => analysisRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (e) {
      setError(e.message);
    } finally {
      setAnalyzing(false);
    }
  }

  const analyzeCount = selected.size > 0 ? selected.size : ads.length;

  return (
    <div style={sx.page}>

      {/* Header */}
      <div style={sx.header}>
        <div style={sx.hInner}>
          <Link to="/" style={{ color: '#6366f1', textDecoration: 'none', fontSize: 13 }}>← Back</Link>
          <span style={{ color: 'rgba(255,255,255,0.2)' }}>|</span>
          <span style={{ fontWeight: 700, fontSize: 15 }}>📊 Facebook Ad Library</span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#6b7280' }}>Competitive Intelligence</span>
        </div>
      </div>

      <div style={sx.body}>

        {/* Search bar */}
        <div style={{ ...sx.card, marginBottom: '1.25rem' }}>
          <form onSubmit={handleSearch}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto auto', gap: '0.75rem', alignItems: 'flex-end' }}>
              <div>
                <label style={sx.label}>Competitor / Brand Name</label>
                <input
                  style={sx.input}
                  placeholder="e.g. Nike, Shopify, competitor.com"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                />
              </div>
              <div>
                <label style={sx.label}>Country</label>
                <select style={sx.select} value={country} onChange={e => setCountry(e.target.value)}>
                  {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label style={sx.label}>Ad Status</label>
                <select style={sx.select} value={status} onChange={e => setStatus(e.target.value)}>
                  {STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label style={sx.label}>Analysis Focus</label>
                <select style={sx.select} value={focus} onChange={e => setFocus(e.target.value)}>
                  {FOCUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div style={{ paddingBottom: 1 }}>
                <button type="submit" style={sx.btn} disabled={loading || !query.trim()}>
                  {loading ? 'Searching…' : '🔍 Search'}
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* Error */}
        {error && (
          <div style={{ ...sx.err, marginBottom: '1rem' }}>
            {error.includes('Facebook access token') || error.includes('FB_TOKEN') ? (
              <>{error} <Link to="/settings" style={{ color: '#818cf8' }}>Go to Settings →</Link></>
            ) : error}
          </div>
        )}

        {/* Results + controls */}
        {ads.length > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <div style={{ fontSize: 13, color: '#9ca3af' }}>
                {ads.length} ads found for <strong style={{ color: '#e2e8f0' }}>"{query}"</strong>
                {selected.size > 0 && <span style={{ color: '#818cf8' }}> · {selected.size} selected</span>}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button style={sx.btnGhost} onClick={selectAll}>Select All</button>
                {selected.size > 0 && <button style={sx.btnGhost} onClick={clearSel}>Clear</button>}
                <button
                  style={{ ...sx.btn, background: analyzing ? '#4f46e5' : '#6366f1', opacity: analyzing ? 0.7 : 1 }}
                  onClick={handleAnalyze}
                  disabled={analyzing}
                >
                  {analyzing ? 'Analyzing…' : `🤖 Analyze ${analyzeCount} Ads`}
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
              {ads.map(ad => {
                const isSel = selected.has(ad.id);
                const bodies = ad.ad_creative_bodies || [];
                const titles = ad.ad_creative_link_titles || [];
                const descrs = ad.ad_creative_link_descriptions || [];
                const impStr  = impressionLabel(ad.impressions);
                const spStr   = spendLabel(ad.spend);
                const platforms = ad.publisher_platforms || [];
                const isActive = !ad.ad_delivery_stop_time;

                return (
                  <div
                    key={ad.id}
                    style={isSel ? sx.adCardSel : sx.adCard}
                    onClick={() => toggleAd(ad.id)}
                  >
                    {/* Ad header */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: isActive ? '#34d399' : '#6b7280', flexShrink: 0 }} />
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{ad.page_name || 'Unknown Page'}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        {isSel && <span style={{ fontSize: 16 }}>✓</span>}
                        {ad.ad_snapshot_url && (
                          <a
                            href={ad.ad_snapshot_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            style={{ fontSize: 11, color: '#6366f1', textDecoration: 'none' }}
                          >
                            View →
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Headline */}
                    {titles[0] && (
                      <p style={{ fontSize: 13, fontWeight: 600, color: '#c7d2fe', margin: '0 0 4px' }}>
                        {titles[0].length > 80 ? titles[0].slice(0, 80) + '…' : titles[0]}
                      </p>
                    )}

                    {/* Body */}
                    {bodies[0] && (
                      <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 8px', lineHeight: 1.5 }}>
                        {bodies[0].length > 160 ? bodies[0].slice(0, 160) + '…' : bodies[0]}
                      </p>
                    )}

                    {/* Description */}
                    {descrs[0] && !titles[0] && (
                      <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 8px', fontStyle: 'italic' }}>
                        {descrs[0].length > 100 ? descrs[0].slice(0, 100) + '…' : descrs[0]}
                      </p>
                    )}

                    {/* Stats */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                      {impStr && <span style={sx.chip}>👁 {impStr}</span>}
                      {spStr  && <span style={sx.chip}>💰 {spStr}</span>}
                      {platforms.map(p => <span key={p} style={sx.chip}>{p}</span>)}
                      {isActive && <span style={{ ...sx.chip, background: 'rgba(52,211,153,0.1)', color: '#34d399' }}>Active</span>}
                    </div>

                    {/* Delivery dates */}
                    {ad.ad_delivery_start_time && (
                      <p style={{ fontSize: 11, color: '#4b5563', marginTop: 8, marginBottom: 0 }}>
                        Running since {new Date(ad.ad_delivery_start_time).toLocaleDateString()}
                        {ad.ad_delivery_stop_time ? ` → ${new Date(ad.ad_delivery_stop_time).toLocaleDateString()}` : ''}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Empty state after search */}
        {searched && !loading && ads.length === 0 && !error && (
          <div style={{ ...sx.card, textAlign: 'center', padding: '2rem' }}>
            <p style={{ color: '#6b7280', fontSize: 14 }}>No ads found for "{query}" in {country}.</p>
            <p style={{ color: '#4b5563', fontSize: 12 }}>Try a broader search term or different country.</p>
          </div>
        )}

        {/* Analysis panel */}
        {(analysis || analyzing) && (
          <div ref={analysisRef} style={{ ...sx.card, borderColor: 'rgba(99,102,241,0.3)', marginTop: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <span style={{ fontSize: 18 }}>🤖</span>
              <span style={{ fontWeight: 700, fontSize: 14, color: '#c7d2fe' }}>
                Competitive Analysis — {query}
              </span>
              {analysis && (
                <button
                  style={{ ...sx.btnGhost, marginLeft: 'auto', fontSize: 11 }}
                  onClick={() => navigator.clipboard.writeText(analysis)}
                >
                  Copy
                </button>
              )}
            </div>
            {analyzing ? (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: '#6b7280', fontSize: 13 }}>
                <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
                Analyzing {analyzeCount} ads…
              </div>
            ) : (
              <div style={sx.prose}>{analysis}</div>
            )}
          </div>
        )}

        {/* Intro state */}
        {!searched && (
          <div style={{ ...sx.card, textAlign: 'center', padding: '3rem 2rem' }}>
            <div style={{ fontSize: 40, marginBottom: '1rem' }}>📊</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0', margin: '0 0 0.5rem' }}>Facebook Ad Library Intelligence</h2>
            <p style={{ color: '#6b7280', fontSize: 14, maxWidth: 480, margin: '0 auto 1.5rem' }}>
              Search any competitor or brand to see their active Facebook and Instagram ads.
              Select ads and let Claude analyze their messaging, targeting, and creative strategies.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              {['Your main competitor', 'Industry leader', 'Local business', 'SaaS product'].map(ex => (
                <button
                  key={ex}
                  style={sx.btnSm}
                  onClick={() => setQuery(ex)}
                >
                  {ex}
                </button>
              ))}
            </div>
            <p style={{ color: '#4b5563', fontSize: 12, marginTop: '1.5rem' }}>
              Requires Facebook connected in{' '}
              <Link to="/settings" style={{ color: '#818cf8' }}>Settings → Social Hub</Link>
            </p>
          </div>
        )}

      </div>
    </div>
  );
}
