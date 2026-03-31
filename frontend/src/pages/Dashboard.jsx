import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import AuthGate  from '../components/AuthGate';
import Spinner   from '../components/Spinner';

const SOCIAL_KEYS = [
  'ghl_social_planner','social_facebook','social_instagram',
  'social_tiktok_organic','social_youtube','social_linkedin_organic',
  'social_pinterest','social_twitter','social_gmb',
];

function StatCard({ icon, label, value, color, loading, sub }) {
  return (
    <div
      className="glass rounded-2xl p-5 flex flex-col gap-3 transition-all"
      style={{ border: `1px solid ${color}22`, position: 'relative', overflow: 'hidden' }}
    >
      {/* Glow accent */}
      <div style={{
        position: 'absolute', top: -20, right: -20, width: 80, height: 80,
        borderRadius: '50%', background: color, opacity: 0.08, filter: 'blur(20px)',
        pointerEvents: 'none',
      }} />

      <div className="flex items-center justify-between">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
          style={{ background: `${color}18` }}
        >
          {icon}
        </div>
        {loading ? (
          <div className="w-8 h-6 rounded animate-pulse" style={{ background: 'rgba(255,255,255,0.06)' }} />
        ) : (
          <span className="text-2xl font-bold text-white">{value ?? '—'}</span>
        )}
      </div>

      <div>
        <p className="text-sm font-medium text-gray-300">{label}</p>
        {sub && <p className="text-xs text-gray-600 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { isAuthenticated, isAuthLoading, apiKey, locationId, integrations, bizProfile } = useApp();

  const [metrics, setMetrics] = useState({
    tools: null, workflows: null, brains: null, agents: null,
    socials: null, ads: null, websites: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!apiKey || !locationId) return;

    const hdrs = { 'x-location-id': locationId };

    // Count enabled integrations from context immediately if available
    if (integrations) {
      const enabled = (integrations || []).filter(i => i.enabled).length;
      const socialConn = (integrations || []).filter(i => SOCIAL_KEYS.includes(i.key) && i.enabled).length;
      setMetrics(m => ({ ...m, tools: enabled, socials: socialConn }));
    }

    const fetchAll = async () => {
      setLoading(true);
      await Promise.allSettled([

        // Tools (authoritative)
        fetch('/tools', { headers: { 'x-api-key': apiKey, 'x-location-id': locationId } })
          .then(r => r.json()).then(d => {
            if (d.success) {
              const enabled = (d.data || []).filter(t => t.enabled).length;
              const socialConn = (d.data || []).filter(t => SOCIAL_KEYS.includes(t.key) && t.enabled).length;
              setMetrics(m => ({ ...m, tools: enabled, socials: socialConn }));
            }
          }).catch(() => {}),

        // Saved workflows
        fetch('/workflows', { headers: hdrs })
          .then(r => r.json()).then(d => {
            if (d.success) setMetrics(m => ({ ...m, workflows: (d.data || []).length }));
          }).catch(() => {}),

        // Brains
        fetch('/brain/list', { headers: hdrs })
          .then(r => r.json()).then(d => {
            if (d.success) setMetrics(m => ({ ...m, brains: (d.data || []).length }));
          }).catch(() => {}),

        // Agents
        fetch('/agent/agents', { headers: hdrs })
          .then(r => r.json()).then(d => {
            if (d.success) setMetrics(m => ({ ...m, agents: (d.data || []).length }));
          }).catch(() => {}),

        // Ad library
        fetch('/ads/library', { headers: hdrs })
          .then(r => r.json()).then(d => {
            if (d.success) setMetrics(m => ({ ...m, ads: (d.data || []).length }));
          }).catch(() => {}),

        // Websites (GHL)
        fetch('/website-builder/websites', { headers: hdrs })
          .then(r => r.json()).then(d => {
            if (d.success) setMetrics(m => ({ ...m, websites: (d.data || []).length }));
          }).catch(() => {}),

      ]);
      setLoading(false);
    };

    fetchAll();
  }, [apiKey, locationId, integrations]);

  if (isAuthLoading) return <Spinner />;
  if (!isAuthenticated) return (
    <AuthGate icon="⊞" title="Dashboard" subtitle="Open this app from your GoHighLevel account." />
  );

  const cards = [
    { key: 'tools',     icon: '🔌', label: 'Integrations Active',  color: '#6366f1', sub: 'Connected tools & APIs' },
    { key: 'workflows', icon: '⟳',  label: 'Workflows Saved',      color: '#10b981', sub: 'Automated workflows' },
    { key: 'agents',    icon: '🤖', label: 'AI Agents',            color: '#a855f7', sub: 'GHL Agent Studio' },
    { key: 'brains',    icon: '🧠', label: 'Brains',               color: '#14b8a6', sub: 'Knowledge bases' },
    { key: 'socials',   icon: '📱', label: 'Socials Connected',    color: '#ec4899', sub: 'Social platforms' },
    { key: 'ads',       icon: '⚡', label: 'Ads in Library',       color: '#f59e0b', sub: 'Saved ad creatives' },
    { key: 'websites',  icon: '🌐', label: 'Websites Built',       color: '#3b82f6', sub: 'GHL websites' },
    { key: 'funnels',   icon: '🚀', label: 'Funnels',              color: '#f97316', sub: 'Built with GHL Builder' },
    { key: 'campaigns', icon: '✉️', label: 'Email Campaigns',      color: '#8b5cf6', sub: 'AI-generated emails' },
  ];

  return (
    <div className="flex flex-col" style={{ height: '100%', background: '#0f0f13', overflowY: 'auto' }}>
      <div className="p-5 md:p-6" style={{ maxWidth: '72rem', margin: '0 auto', width: '100%' }}>

        {/* ── Header ── */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">Overview of your {bizProfile?.name || 'HL Pro Tools'} activity</p>
        </div>

        {/* ── 3-column stat cards ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {cards.map(c => (
            <StatCard
              key={c.key}
              icon={c.icon}
              label={c.label}
              color={c.color}
              sub={c.sub}
              loading={loading && metrics[c.key] === null}
              value={metrics[c.key]}
            />
          ))}
        </div>

        {/* ── Quick nav ── */}
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">Quick Actions</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
            {[
              { label: 'AI Assistant', icon: '🤖', href: '/workflows', hint: 'Chat with GHL AI' },
              { label: 'Build a Funnel', icon: '🚀', href: '/funnel-builder', hint: 'AI funnel builder' },
              { label: 'Create Ads', icon: '⚡', href: '/ads', hint: 'Bulk ad generator' },
              { label: 'Brain Search', icon: '🧠', href: '/agents', hint: 'Query your brain' },
              { label: 'Social Posts', icon: '📱', href: '/social', hint: 'Schedule content' },
              { label: 'Integrations', icon: '🔌', href: '/settings', hint: 'Connect tools' },
            ].map(({ label, icon, href, hint }) => (
              <a
                key={href}
                href={`/ui${href}`}
                className="glass rounded-xl p-4 flex items-center gap-3 transition-all no-underline"
                style={{ border: '1px solid rgba(255,255,255,0.06)', textDecoration: 'none' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.35)'; e.currentTarget.style.background = 'rgba(99,102,241,0.06)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; e.currentTarget.style.background = ''; }}
              >
                <span className="text-xl">{icon}</span>
                <div>
                  <p className="text-sm font-medium text-gray-200">{label}</p>
                  <p className="text-xs text-gray-600">{hint}</p>
                </div>
              </a>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
