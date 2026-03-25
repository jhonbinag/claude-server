import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api }                 from '../lib/api';
import Header                  from '../components/Header';
import SelfImprovementPanel    from '../components/SelfImprovementPanel';

/* ── Constants ────────────────────────────────────────────────────────────── */
const COUNTRIES = [
  { code: 'ALL', label: 'All' },
  { code: 'US',  label: 'United States' },
  { code: 'GB',  label: 'United Kingdom' },
  { code: 'CA',  label: 'Canada' },
  { code: 'AU',  label: 'Australia' },
  { code: 'PH',  label: 'Philippines' },
  { code: 'IN',  label: 'India' },
  { code: 'DE',  label: 'Germany' },
  { code: 'FR',  label: 'France' },
  { code: 'SG',  label: 'Singapore' },
  { code: 'NZ',  label: 'New Zealand' },
];

const AD_TYPES = [
  { value: 'ALL',                    label: 'All ads' },
  { value: 'POLITICAL_AND_ISSUE_ADS',label: 'Political & issue ads' },
];

const STATUS_OPTS = [
  { value: 'ALL',      label: 'All' },
  { value: 'ACTIVE',   label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
];

const FOCUS_OPTS = [
  { value: 'all',       label: 'Full analysis' },
  { value: 'messaging', label: 'Messaging & hooks' },
  { value: 'targeting', label: 'Targeting signals' },
  { value: 'creative',  label: 'Creative patterns' },
];

/* ── Platform icons (SVG paths as tiny components) ───────────────────────── */
const PlatformIcons = {
  facebook: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="#1877f2">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
  ),
  instagram: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="url(#ig)">
      <defs>
        <linearGradient id="ig" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#f09433"/>
          <stop offset="25%" stopColor="#e6683c"/>
          <stop offset="50%" stopColor="#dc2743"/>
          <stop offset="75%" stopColor="#cc2366"/>
          <stop offset="100%" stopColor="#bc1888"/>
        </linearGradient>
      </defs>
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
    </svg>
  ),
  messenger: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="#0084ff">
      <path d="M12 0C5.373 0 0 4.974 0 11.111c0 3.498 1.744 6.614 4.469 8.652V24l4.088-2.242c1.092.3 2.246.464 3.443.464 6.627 0 12-4.975 12-11.111S18.627 0 12 0zm1.191 14.963l-3.055-3.26-5.963 3.26L10.732 8l3.131 3.26L19.752 8l-6.561 6.963z"/>
    </svg>
  ),
  whatsapp: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="#25d366">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  ),
  audience_network: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="#898f9c">
      <circle cx="12" cy="12" r="10" strokeWidth="2" stroke="#898f9c" fill="none"/>
      <path d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20" stroke="#898f9c" strokeWidth="1.5" fill="none"/>
    </svg>
  ),
};

const PLATFORM_MAP = {
  facebook:         PlatformIcons.facebook,
  instagram:        PlatformIcons.instagram,
  messenger:        PlatformIcons.messenger,
  whatsapp:         PlatformIcons.whatsapp,
  audience_network: PlatformIcons.audience_network,
};

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function formatDate(s) {
  if (!s) return null;
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function pageInitial(name) {
  return (name || '?').charAt(0).toUpperCase();
}
function pageColor(name) {
  const colors = ['#1877f2','#e1306c','#ff6b35','#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6'];
  let h = 0; for (const c of (name || '')) h = (h * 31 + c.charCodeAt(0)) % colors.length;
  return colors[h];
}

/* ── Meta-style Ad Card ───────────────────────────────────────────────────── */
function AdCard({ ad, selected, onToggle }) {
  const [showPreview, setShowPreview] = useState(false);
  const isActive   = !ad.ad_delivery_stop_time;
  const bodies     = ad.ad_creative_bodies || [];
  const titles     = ad.ad_creative_link_titles || [];
  const captions   = ad.ad_creative_link_captions || [];
  const platforms  = ad.publisher_platforms || [];
  const startDate  = formatDate(ad.ad_delivery_start_time);

  return (
    <div style={{
      background: selected ? 'rgba(24,119,242,0.06)' : '#1a1a2e',
      border: selected ? '1.5px solid #1877f2' : '1px solid rgba(255,255,255,0.1)',
      borderRadius: 8,
      overflow: 'hidden',
      cursor: 'pointer',
      transition: 'border-color .15s, box-shadow .15s',
      boxShadow: selected ? '0 0 0 2px rgba(24,119,242,0.2)' : '0 1px 4px rgba(0,0,0,0.3)',
    }} onClick={() => onToggle(ad.id)}>

      {/* ── Top metadata section ── */}
      <div style={{ padding: '12px 14px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: isActive ? 'rgba(52,211,153,0.12)' : 'rgba(107,114,128,0.15)',
              color: isActive ? '#34d399' : '#9ca3af',
              fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 20,
              border: `1px solid ${isActive ? 'rgba(52,211,153,0.3)' : 'rgba(107,114,128,0.3)'}`,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }} />
              {isActive ? 'Active' : 'Inactive'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {selected && <span style={{ fontSize: 14, color: '#1877f2', fontWeight: 700 }}>✓</span>}
            <span style={{ fontSize: 18, color: '#4b5563', cursor: 'default' }}>···</span>
          </div>
        </div>

        <p style={{ fontSize: 11, color: '#6b7280', margin: '0 0 3px' }}>Library ID: {ad.id}</p>
        {startDate && <p style={{ fontSize: 11, color: '#6b7280', margin: '0 0 8px' }}>Started running on {startDate}</p>}

        {/* Platform icons */}
        {platforms.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: '#6b7280' }}>Platforms</span>
            {platforms.map(p => (
              <span key={p} title={p} style={{ lineHeight: 0 }}>
                {PLATFORM_MAP[p] || <span style={{ fontSize: 10, color: '#6b7280' }}>{p}</span>}
              </span>
            ))}
          </div>
        )}

        <p style={{ fontSize: 11, color: '#6b7280', margin: '0 0 10px' }}>EU transparency ℹ</p>

        {/* See ad details button */}
        <a
          href={ad.ad_snapshot_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          style={{
            display: 'block', textAlign: 'center', textDecoration: 'none',
            border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6,
            padding: '6px 0', fontSize: 12, fontWeight: 600, color: '#e2e8f0',
            background: 'rgba(255,255,255,0.04)',
            transition: 'background .15s',
          }}
          onMouseOver={e => e.currentTarget.style.background='rgba(255,255,255,0.08)'}
          onMouseOut={e => e.currentTarget.style.background='rgba(255,255,255,0.04)'}
        >
          See ad details
        </a>
      </div>

      {/* Divider */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }} />

      {/* ── Creative section ── */}
      <div style={{ padding: '12px 14px' }}>
        {/* Page avatar + name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            background: pageColor(ad.page_name),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 700, color: '#fff', flexShrink: 0,
          }}>
            {pageInitial(ad.page_name)}
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{ad.page_name || 'Unknown Page'}</p>
            <p style={{ margin: 0, fontSize: 11, color: '#6b7280' }}>Sponsored</p>
          </div>
        </div>

        {/* Ad copy */}
        {bodies[0] && (
          <p style={{ fontSize: 13, color: '#cbd5e1', margin: '0 0 10px', lineHeight: 1.5 }}>
            {bodies[0].length > 200 ? bodies[0].slice(0, 200) + '…' : bodies[0]}
          </p>
        )}

        {/* Ad preview iframe */}
        {ad.ad_snapshot_url && (
          <div style={{ marginBottom: 10 }}>
            {showPreview ? (
              <iframe
                src={ad.ad_snapshot_url}
                style={{ width: '100%', height: 220, border: 'none', borderRadius: 6, background: '#fff' }}
                title={`Ad preview ${ad.id}`}
                sandbox="allow-scripts allow-same-origin"
              />
            ) : (
              <div
                style={{
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 6, height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', gap: 8,
                }}
                onClick={e => { e.stopPropagation(); setShowPreview(true); }}
              >
                <span style={{ fontSize: 18 }}>🖼</span>
                <span style={{ fontSize: 12, color: '#9ca3af' }}>Click to load ad preview</span>
              </div>
            )}
          </div>
        )}

        {/* Headline */}
        {titles[0] && (
          <p style={{ fontSize: 12, fontWeight: 700, color: '#93c5fd', margin: '0 0 4px' }}>
            {titles[0].length > 80 ? titles[0].slice(0, 80) + '…' : titles[0]}
          </p>
        )}

        {/* Caption / domain */}
        {captions[0] && (
          <p style={{ fontSize: 11, color: '#4b5563', margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            {captions[0]}
          </p>
        )}

        {/* Stats row */}
        {(ad.impressions || ad.spend) && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {ad.impressions && (
              <span style={{ fontSize: 11, color: '#6b7280', background: 'rgba(255,255,255,0.05)', borderRadius: 4, padding: '2px 7px' }}>
                👁 {Number(ad.impressions.lower_bound).toLocaleString()}–{Number(ad.impressions.upper_bound).toLocaleString()}
              </span>
            )}
            {ad.spend && (
              <span style={{ fontSize: 11, color: '#6b7280', background: 'rgba(255,255,255,0.05)', borderRadius: 4, padding: '2px 7px' }}>
                💰 ${Number(ad.spend.lower_bound).toLocaleString()}–${Number(ad.spend.upper_bound).toLocaleString()}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Google Ads Panel ────────────────────────────────────────────────────── */
function GoogleAdsPanel({ query }) {
  const googleUrl = query
    ? `https://adstransparency.google.com/?region=anywhere&q=${encodeURIComponent(query)}`
    : 'https://adstransparency.google.com/';

  return (
    <div style={{ maxWidth: 700, margin: '3rem auto', textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: '1rem' }}>
        <svg width="52" height="52" viewBox="0 0 24 24">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
      </div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#e2e8f0', margin: '0 0 0.5rem' }}>Google Ads Transparency</h2>
      <p style={{ color: '#6b7280', fontSize: 14, margin: '0 0 1.5rem', lineHeight: 1.6 }}>
        Search competitor Google Ads in the Google Ads Transparency Center.
        {query && <><br/>Results for <strong style={{ color: '#e2e8f0' }}>"{query}"</strong> will open in a new tab.</>}
      </p>

      <a
        href={googleUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          background: '#4285F4', color: '#fff', textDecoration: 'none',
          borderRadius: 8, padding: '10px 24px', fontSize: 14, fontWeight: 700,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
          <polyline points="15 3 21 3 21 9"/>
          <line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
        Open Google Ads Transparency{query ? ` — "${query}"` : ''}
      </a>

      <div style={{ marginTop: '2rem', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '1.25rem', textAlign: 'left' }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.75rem' }}>What you can find</p>
        <ul style={{ fontSize: 13, color: '#6b7280', margin: 0, padding: '0 0 0 1.25rem', lineHeight: 2 }}>
          <li>All active & recent Google Search, Display, YouTube ads</li>
          <li>Ad creative previews (images, videos, headlines)</li>
          <li>Impression ranges by region & demographics</li>
          <li>Advertiser spending data</li>
          <li>Date ranges ads have been running</li>
        </ul>
      </div>
    </div>
  );
}

/* ── Main component ───────────────────────────────────────────────────────── */
export default function AdLibrary() {
  const [platform,   setPlatform]   = useState('facebook');
  const [query,      setQuery]      = useState('');
  const [country,    setCountry]    = useState('ALL');
  const [adType,     setAdType]     = useState('ALL');
  const [status,     setStatus]     = useState('ACTIVE');
  const [focus,      setFocus]      = useState('all');
  const [ads,        setAds]        = useState([]);
  const [selected,   setSelected]   = useState(new Set());
  const [loading,    setLoading]    = useState(false);
  const [analyzing,  setAnalyzing]  = useState(false);
  const [error,      setError]      = useState('');
  const [analysis,   setAnalysis]   = useState('');
  const [searched,   setSearched]   = useState(false);
  const [activeTab,  setActiveTab]  = useState('paste'); // 'paste' | 'url'
  const [pasteText,  setPasteText]  = useState('');
  const [pasteAnalysis, setPasteAnalysis] = useState('');
  const [pasteAnalyzing, setPasteAnalyzing] = useState(false);
  const [urlInput,   setUrlInput]   = useState('');
  const [urlAnalyzing, setUrlAnalyzing] = useState(false);
  const [urlAnalysis,  setUrlAnalysis]  = useState('');
  const [myAdCopy,   setMyAdCopy]   = useState('');
  const analysisRef  = useRef(null);
  const pasteRef     = useRef(null);
  const urlRef       = useRef(null);
  const myAdRef      = useRef(null);

  async function handlePasteAnalyze() {
    if (!pasteText.trim()) return;
    setPasteAnalyzing(true); setPasteAnalysis('');
    try {
      const d = await api.post('/ad-library/analyze', {
        ads: [{ ad_creative_bodies: [pasteText], page_name: 'Pasted Ad' }],
        focus,
        competitor: query || 'competitor',
      });
      if (d.error) { setPasteAnalysis('Error: ' + d.error); return; }
      setPasteAnalysis(d.analysis || '');
      setTimeout(() => pasteRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (e) { setPasteAnalysis('Error: ' + e.message); }
    finally { setPasteAnalyzing(false); }
  }

  async function handleUrlAnalyze() {
    if (!urlInput.trim()) return;
    setUrlAnalyzing(true); setUrlAnalysis('');
    try {
      // Parse URL params
      const u = new URL(urlInput.trim());
      const q        = u.searchParams.get('q') || '';
      const country_ = (u.searchParams.get('country') || 'US').toUpperCase();
      const active   = u.searchParams.get('active_status') || 'all';
      const adType_  = u.searchParams.get('ad_type') || 'all';
      const statusVal = active === 'active' ? 'ACTIVE' : active === 'inactive' ? 'INACTIVE' : 'ALL';
      const adTypeVal = adType_ === 'political_and_issue_ads' ? 'POLITICAL_AND_ISSUE_ADS' : 'ALL';

      if (!q) { setUrlAnalysis('Error: No search term found in URL.'); return; }

      // Fetch ads
      const d = await api.get(
        `/ad-library/search?q=${encodeURIComponent(q)}&country=${country_ === 'ALL' ? 'US' : country_}&status=${statusVal}&type=${adTypeVal}&limit=25`
      );
      if (d.error) { setUrlAnalysis('Error: ' + d.error + (d.hint ? ' ' + d.hint : '')); return; }
      const fetchedAds = Array.isArray(d.data) ? d.data : [];
      if (!fetchedAds.length) { setUrlAnalysis('No ads found for this search.'); return; }

      // Auto-analyze
      const a = await api.post('/ad-library/analyze', { ads: fetchedAds, focus, competitor: q });
      if (a.error) { setUrlAnalysis('Error: ' + a.error); return; }
      setUrlAnalysis(a.analysis || '');
      setTimeout(() => urlRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (e) {
      setUrlAnalysis('Error: ' + (e.message.includes('Invalid URL') ? 'Please paste a valid Facebook Ad Library URL.' : e.message));
    } finally { setUrlAnalyzing(false); }
  }

  async function handleSearch(e) {
    e?.preventDefault();
    if (!query.trim()) return;

    // Google tab — open Transparency Center directly, no backend call
    if (platform === 'google') {
      window.open(`https://adstransparency.google.com/?region=anywhere&q=${encodeURIComponent(query)}`, '_blank');
      return;
    }

    setLoading(true); setError(''); setAds([]); setSelected(new Set()); setAnalysis(''); setSearched(true);
    try {
      const country_ = country === 'ALL' ? 'US' : country;
      const d = await api.get(
        `/ad-library/search?q=${encodeURIComponent(query)}&country=${country_}&status=${status}&type=${adType}&limit=25`
      );
      if (d.error) { setError(d.error + (d.hint ? ' ' + d.hint : '')); return; }
      setAds(Array.isArray(d.data) ? d.data : []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  function toggleAd(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function handleAnalyze() {
    const toAnalyze = selected.size ? ads.filter(a => selected.has(a.id)) : ads;
    if (!toAnalyze.length) return;
    setAnalyzing(true); setAnalysis(''); setError('');
    try {
      const d = await api.post('/ad-library/analyze', { ads: toAnalyze, focus, competitor: query });
      if (d.error) { setError(d.error); return; }
      setAnalysis(d.analysis || '');
      setTimeout(() => analysisRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (e) { setError(e.message); }
    finally { setAnalyzing(false); }
  }

  const analyzeCount = selected.size || ads.length;

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f1a', color: '#e2e8f0', fontFamily: 'sans-serif' }}>

      {/* ── Shared Header ── */}
      <Header />

      {/* ── Platform sub-nav + Search ── */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(12px)', position: 'sticky', top: 53, zIndex: 40 }}>
        <div style={{ maxWidth: 1300, margin: '0 auto', padding: '0 1.5rem' }}>

          {/* Platform tabs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', paddingTop: 8, paddingBottom: 8 }}>
            <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: 3 }}>
              {[
                { key: 'facebook', label: 'Ad Library',         icon: PlatformIcons.facebook },
                { key: 'google',   label: 'Google Transparency', icon: <svg width="14" height="14" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg> },
              ].map(t => (
                <button key={t.key} onClick={() => setPlatform(t.key)} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: platform === t.key ? 'rgba(255,255,255,0.1)' : 'transparent',
                  border: 'none', color: platform === t.key ? '#e2e8f0' : '#6b7280',
                  fontSize: 13, fontWeight: platform === t.key ? 700 : 500,
                  borderRadius: 6, padding: '5px 12px', cursor: 'pointer', transition: 'all .15s',
                }}>
                  {t.icon} {t.label}
                </button>
              ))}
            </div>

            {/* Facebook mode tabs */}
            {platform === 'facebook' && (
              <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: 3 }}>
                {[
                  { key: 'paste', label: '✂️ Paste & Analyze' },
                  { key: 'url',   label: '🔗 URL Analyze' },
                ].map(t => (
                  <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
                    background: activeTab === t.key ? 'rgba(99,102,241,0.25)' : 'transparent',
                    border: 'none', color: activeTab === t.key ? '#a5b4fc' : '#6b7280',
                    fontSize: 12, fontWeight: activeTab === t.key ? 700 : 500,
                    borderRadius: 6, padding: '5px 12px', cursor: 'pointer', transition: 'all .15s',
                    whiteSpace: 'nowrap',
                  }}>
                    {t.label}
                  </button>
                ))}
              </div>
            )}

            {/* Google search input */}
            {platform === 'google' && (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flex: 1 }}>
                <input
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && urlInput.trim() && window.open(`https://adstransparency.google.com/?region=anywhere&q=${encodeURIComponent(urlInput.trim())}`, '_blank')}
                  style={{
                    flex: 1, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: 20, padding: '6px 14px', color: '#e2e8f0', fontSize: 13,
                    outline: 'none',
                  }}
                  placeholder="Search brand or advertiser…"
                />
                <button
                  onClick={() => urlInput.trim() && window.open(`https://adstransparency.google.com/?region=anywhere&q=${encodeURIComponent(urlInput.trim())}`, '_blank')}
                  disabled={!urlInput.trim()}
                  style={{
                    background: !urlInput.trim() ? '#374151' : '#4285F4',
                    color: '#fff', border: 'none', borderRadius: 20, padding: '6px 18px',
                    fontSize: 12, fontWeight: 700, cursor: !urlInput.trim() ? 'not-allowed' : 'pointer',
                    whiteSpace: 'nowrap', flexShrink: 0,
                  }}
                >
                  Open Google ↗
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ maxWidth: 1300, margin: '0 auto', padding: '1.25rem 1.5rem' }}>

        {/* Error */}
        {error && (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '1rem 1.25rem', fontSize: 13, color: '#fca5a5', marginBottom: '1rem', lineHeight: 1.7 }}>
            {error.includes('Facebook access token') || error.includes('FB_TOKEN') ? (
              <>{error} <Link to="/settings" style={{ color: '#818cf8' }}>Go to Settings →</Link></>
            ) : error.toLowerCase().includes('permission') || error.toLowerCase().includes('oauth') ? (
              <>
                <strong style={{ display: 'block', marginBottom: 6, color: '#f87171' }}>Facebook API Permission Error</strong>
                Your access token does not have the <code style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 4, padding: '1px 5px' }}>ads_read</code> permission required for the Ad Library API.
                <br /><br />
                <strong>To fix this:</strong>
                <ol style={{ margin: '6px 0 0 16px', padding: 0, lineHeight: 2 }}>
                  <li>Go to <a href="https://developers.facebook.com/tools/explorer" target="_blank" rel="noreferrer" style={{ color: '#818cf8' }}>Graph API Explorer</a></li>
                  <li>Select your Facebook App from the dropdown</li>
                  <li>Click <strong>Generate Access Token</strong> and add the <code style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 4, padding: '1px 5px' }}>ads_read</code> permission</li>
                  <li>Copy the User Access Token (not Page Token)</li>
                  <li>Paste it in <Link to="/settings" style={{ color: '#818cf8' }}>Settings → Social Hub</Link></li>
                </ol>
                <div style={{ marginTop: 8, color: '#9ca3af', fontSize: 12 }}>Note: Your Facebook Developer App must also be approved for <code style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 4, padding: '1px 5px' }}>ads_read</code> via App Review, or be in Development mode with yourself as a test user.</div>
              </>
            ) : error}
          </div>
        )}

        {/* ── Paste & Analyze panel (primary Facebook mode) ── */}
        {platform === 'facebook' && activeTab === 'paste' && (
          <div style={{ marginBottom: '1.5rem' }}>
            {/* How-to steps */}
            <div style={{ background: 'rgba(24,119,242,0.06)', border: '1px solid rgba(24,119,242,0.2)', borderRadius: 10, padding: '0.875rem 1.1rem', marginBottom: '1rem' }}>
              <p style={{ margin: '0 0 0.5rem', fontSize: 12, fontWeight: 700, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: '0.05em' }}>How to use</p>
              <ol style={{ margin: 0, padding: '0 0 0 1.1rem', fontSize: 12, color: '#6b7280', lineHeight: 2 }}>
                <li>Open <a href="https://www.facebook.com/ads/library/" target="_blank" rel="noreferrer" style={{ color: '#818cf8' }}>facebook.com/ads/library ↗</a> in a new tab</li>
                <li>Search for a competitor brand name</li>
                <li>Copy the ad text (headline, body, description)</li>
                <li>Paste it below and click <strong style={{ color: '#a5b4fc' }}>Analyze</strong></li>
              </ol>
            </div>

            <div style={{ background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 12, padding: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: 8 }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: '#c7d2fe' }}>Paste Competitor Ad Text</p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select value={focus} onChange={e => setFocus(e.target.value)} style={{
                    background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: 6, padding: '5px 10px', color: '#e2e8f0', fontSize: 12, outline: 'none', cursor: 'pointer',
                  }}>
                    {FOCUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <button
                    onClick={handlePasteAnalyze}
                    disabled={pasteAnalyzing || !pasteText.trim()}
                    style={{
                      background: pasteAnalyzing || !pasteText.trim() ? '#374151' : '#6366f1',
                      color: '#fff', border: 'none', borderRadius: 8, padding: '7px 18px',
                      fontSize: 13, fontWeight: 700, cursor: pasteAnalyzing || !pasteText.trim() ? 'not-allowed' : 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {pasteAnalyzing ? '⟳ Analyzing…' : '🤖 Analyze'}
                  </button>
                </div>
              </div>
              <textarea
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                placeholder={"Paste one or more ad texts here…\n\nExample:\nHeadline: Get 50% Off Today Only\nBody: We've helped 10,000+ customers achieve their goals. Limited time offer — don't miss out!\nCTA: Shop Now\n\nYou can paste multiple ads separated by blank lines."}
                style={{
                  width: '100%', minHeight: 160, background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8,
                  padding: '10px 12px', color: '#e2e8f0', fontSize: 13, lineHeight: 1.6,
                  outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit',
                }}
              />
              {pasteAnalysis && (
                <div ref={pasteRef} style={{ marginTop: '1rem', background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: '#c7d2fe' }}>🤖 Claude Analysis</span>
                    <button onClick={() => navigator.clipboard.writeText(pasteAnalysis)} style={{
                      background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: 6, padding: '3px 10px', fontSize: 11, color: '#9ca3af', cursor: 'pointer',
                    }}>Copy</button>
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.75, color: '#cbd5e1', whiteSpace: 'pre-wrap' }}>{pasteAnalysis}</div>
                </div>
              )}

              {/* Auto-improve the pasted ad — runs the exploit-or-revert loop */}
              {pasteText.trim().length > 20 && (
                <SelfImprovementPanel
                  type="ad_copy"
                  artifact={pasteText}
                  label="This Ad Copy"
                  onApply={(improved) => setPasteText(improved)}
                />
              )}
            </div>
          </div>
        )}

        {/* ── URL Analyze panel (secondary Facebook mode) ── */}
        {platform === 'facebook' && activeTab === 'url' && (
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, padding: '0.875rem 1.1rem', marginBottom: '1rem' }}>
              <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Requires Facebook API Access</p>
              <p style={{ margin: 0, fontSize: 12, color: '#6b7280', lineHeight: 1.6 }}>
                URL Analyze fetches ads automatically but requires a Facebook developer account with <code style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 3, padding: '1px 4px' }}>ads_read</code> permission.
                If that's not set up yet, use <button onClick={() => setActiveTab('paste')} style={{ background: 'none', border: 'none', color: '#818cf8', cursor: 'pointer', padding: 0, fontSize: 12, textDecoration: 'underline' }}>Paste &amp; Analyze</button> instead.
              </p>
            </div>

            <div style={{ background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 12, padding: '1.25rem' }}>
              <p style={{ margin: '0 0 0.75rem', fontWeight: 700, fontSize: 14, color: '#c7d2fe' }}>Paste Facebook Ad Library URL</p>
              <p style={{ margin: '0 0 0.875rem', fontSize: 12, color: '#6b7280' }}>
                Go to <a href="https://www.facebook.com/ads/library/" target="_blank" rel="noreferrer" style={{ color: '#818cf8' }}>facebook.com/ads/library ↗</a>, search for a competitor, then copy the page URL and paste it here.
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
                <input
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleUrlAnalyze()}
                  style={{
                    flex: 1, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: 8, padding: '9px 14px', color: '#e2e8f0', fontSize: 13,
                    outline: 'none',
                  }}
                  placeholder="https://www.facebook.com/ads/library/?q=brand&active_status=active…"
                />
                <select value={focus} onChange={e => setFocus(e.target.value)} style={{
                  background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 6, padding: '9px 10px', color: '#e2e8f0', fontSize: 12, outline: 'none', cursor: 'pointer', flexShrink: 0,
                }}>
                  {FOCUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <button
                  onClick={handleUrlAnalyze}
                  disabled={urlAnalyzing || !urlInput.trim()}
                  style={{
                    background: urlAnalyzing || !urlInput.trim() ? '#374151' : '#6366f1',
                    color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px',
                    fontSize: 13, fontWeight: 700, cursor: urlAnalyzing || !urlInput.trim() ? 'not-allowed' : 'pointer',
                    whiteSpace: 'nowrap', flexShrink: 0,
                  }}
                >
                  {urlAnalyzing ? '⟳ Fetching…' : '🤖 Fetch & Analyze'}
                </button>
              </div>
              {(urlAnalysis || urlAnalyzing) && (
                <div ref={urlRef} style={{ marginTop: '0.75rem', background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: '#c7d2fe' }}>🤖 Claude Analysis</span>
                    {urlAnalysis && !urlAnalysis.startsWith('Error') && (
                      <button onClick={() => navigator.clipboard.writeText(urlAnalysis)} style={{
                        background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
                        borderRadius: 6, padding: '3px 10px', fontSize: 11, color: '#9ca3af', cursor: 'pointer',
                      }}>Copy</button>
                    )}
                  </div>
                  {urlAnalyzing
                    ? <p style={{ color: '#6b7280', fontSize: 13, margin: 0 }}>Fetching ads and analyzing with Claude…</p>
                    : <div style={{ fontSize: 13, lineHeight: 1.75, color: urlAnalysis.startsWith('Error') ? '#fca5a5' : '#cbd5e1', whiteSpace: 'pre-wrap' }}>{urlAnalysis}</div>
                  }
                </div>
              )}
            </div>
          </div>
        )}

        {/* Google tab */}
        {platform === 'google' && <GoogleAdsPanel query={query} />}

        {/* Facebook results */}
        {platform === 'facebook' && (
          <>
            {/* Results header */}
            {ads.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>
                    ~{ads.length.toLocaleString()} results
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: '#6b7280' }}>
                    These results include ads that match your keyword search.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {/* Analysis focus */}
                  <select value={focus} onChange={e => setFocus(e.target.value)} style={{
                    background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: 6, padding: '6px 12px', color: '#e2e8f0', fontSize: 12, outline: 'none', cursor: 'pointer',
                  }}>
                    {FOCUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  {ads.length > 0 && (
                    <>
                      <button onClick={() => setSelected(new Set(ads.map(a => a.id)))} style={{
                        background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6,
                        padding: '5px 12px', fontSize: 12, color: '#9ca3af', cursor: 'pointer',
                      }}>Select All</button>
                      {selected.size > 0 && (
                        <button onClick={() => setSelected(new Set())} style={{
                          background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6,
                          padding: '5px 12px', fontSize: 12, color: '#9ca3af', cursor: 'pointer',
                        }}>Clear</button>
                      )}
                    </>
                  )}
                  <button onClick={handleAnalyze} disabled={analyzing || ads.length === 0} style={{
                    background: analyzing ? '#374151' : '#6366f1', color: '#fff', border: 'none',
                    borderRadius: 6, padding: '7px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    {analyzing ? '⟳ Analyzing…' : `🤖 Analyze ${analyzeCount} Ads`}
                  </button>
                </div>
              </div>
            )}

            {/* Ad grid */}
            {ads.length > 0 && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: '0.75rem',
                marginBottom: '1.5rem',
              }}>
                {ads.map(ad => (
                  <AdCard key={ad.id} ad={ad} selected={selected.has(ad.id)} onToggle={toggleAd} />
                ))}
              </div>
            )}

            {/* Empty state after URL fetch returned 0 */}
            {searched && !loading && ads.length === 0 && !error && (
              <div style={{ textAlign: 'center', padding: '3rem', background: 'rgba(255,255,255,0.03)', borderRadius: 10 }}>
                <p style={{ color: '#6b7280', fontSize: 14 }}>No ads found.</p>
                <p style={{ color: '#4b5563', fontSize: 12 }}>Try the <button onClick={() => setActiveTab('paste')} style={{ background: 'none', border: 'none', color: '#818cf8', cursor: 'pointer', padding: 0, fontSize: 12, textDecoration: 'underline' }}>Paste &amp; Analyze</button> mode instead.</p>
              </div>
            )}

            {/* AI Analysis panel */}
            {(analysis || analyzing) && (
              <div ref={analysisRef} style={{
                background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.3)',
                borderRadius: 10, padding: '1.25rem', marginTop: '0.5rem',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                  <span style={{ fontSize: 18 }}>🤖</span>
                  <span style={{ fontWeight: 700, fontSize: 14, color: '#c7d2fe' }}>
                    Competitive Analysis — {query}
                    {selected.size > 0 && <span style={{ color: '#818cf8', fontWeight: 400 }}> ({selected.size} selected ads)</span>}
                  </span>
                  {analysis && (
                    <button onClick={() => navigator.clipboard.writeText(analysis)} style={{
                      marginLeft: 'auto', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: 6, padding: '4px 10px', fontSize: 11, color: '#9ca3af', cursor: 'pointer',
                    }}>Copy</button>
                  )}
                </div>
                {analyzing
                  ? <p style={{ color: '#6b7280', fontSize: 13 }}>Analyzing {analyzeCount} ads…</p>
                  : <div style={{ fontSize: 14, lineHeight: 1.75, color: '#cbd5e1', whiteSpace: 'pre-wrap' }}>{analysis}</div>
                }
              </div>
            )}

            {/* Improve Your Ad — appears after competitor analysis runs */}
            {analysis && !analyzing && (
              <div ref={myAdRef} style={{ marginTop: '1.5rem', background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 12, padding: '1.25rem' }}>
                <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700, color: '#34d399' }}>
                  🔬 Now Improve Your Own Ad
                </p>
                <p style={{ margin: '0 0 0.875rem', fontSize: 12, color: '#6b7280', lineHeight: 1.6 }}>
                  Paste your current ad copy below. The AI will score it against the same criteria used to evaluate the competitors above, then run an improvement loop to optimize it.
                </p>
                <textarea
                  value={myAdCopy}
                  onChange={e => setMyAdCopy(e.target.value)}
                  placeholder="Paste your ad copy here — hook, body, CTA…"
                  rows={5}
                  style={{
                    width: '100%', background: 'rgba(0,0,0,0.3)',
                    border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8,
                    padding: '10px 12px', color: '#e2e8f0', fontSize: 13, lineHeight: 1.6,
                    outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit',
                    marginBottom: myAdCopy.trim().length > 20 ? 0 : 0,
                  }}
                />
                {myAdCopy.trim().length > 20 && (
                  <SelfImprovementPanel
                    type="ad_copy"
                    artifact={myAdCopy}
                    context={{ competitorInsights: analysis.slice(0, 800) }}
                    label="Your Ad Copy"
                    onApply={(improved) => setMyAdCopy(improved)}
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
