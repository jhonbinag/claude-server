/**
 * Workflows.jsx — Visual canvas workflow builder (n8n / ManyChat style)
 *
 * - Drag nodes from palette onto canvas
 * - Connect nodes by dragging from output port → input port
 * - Click an edge to open the field-mapping panel (map output fields to input fields)
 * - Run Workflow → Claude executes all nodes in topological order
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { Link }           from 'react-router-dom';
import { useApp }         from '../context/AppContext';
import { useStreamFetch } from '../hooks/useStreamFetch';
import AuthGate           from '../components/AuthGate';
import Header             from '../components/Header';
import StreamOutput       from '../components/StreamOutput';
import Spinner            from '../components/Spinner';
import { INTEGRATIONS }   from '../lib/integrations';

// ─── Constants ────────────────────────────────────────────────────────────────

const TOOL_COLOR = {
  ghl: '#22c55e', perplexity: '#6366f1', openai: '#10b981',
  facebook_ads: '#1877f2', sendgrid: '#00a8a8', slack: '#9333ea',
  apollo: '#f97316', heygen: '#a855f7', manychat: '#0084ff',
  hubspot: '#ff7a00', keap: '#00a3e0', social_hub: '#8b5cf6', payment_hub: '#10b981',
};

const NODE_W = 240;
const PORT_R = 7;

// ─── Field schemas ────────────────────────────────────────────────────────────

const TOOL_FIELDS = {
  ghl: {
    inputs:  ['contactId', 'email', 'phone', 'firstName', 'lastName', 'tag', 'offer', 'audience'],
    outputs: ['contactId', 'email', 'phone', 'firstName', 'lastName', 'funnelUrl', 'pageUrl', 'opportunityId'],
  },
  openai: {
    inputs:  ['prompt', 'context', 'topic', 'audience', 'offer'],
    outputs: ['generatedText', 'headline', 'subject', 'body', 'cta', 'socialPost'],
  },
  perplexity: {
    inputs:  ['query', 'topic', 'niche'],
    outputs: ['research', 'summary', 'keyPoints', 'competitors', 'trends'],
  },
  sendgrid: {
    inputs:  ['to_email', 'subject', 'body', 'fromEmail', 'fromName'],
    outputs: ['messageId', 'status'],
  },
  apollo: {
    inputs:  ['jobTitle', 'industry', 'companySize', 'location', 'keywords'],
    outputs: ['email', 'phone', 'firstName', 'lastName', 'company', 'linkedIn', 'contactId'],
  },
  slack: {
    inputs:  ['channel', 'message', 'content'],
    outputs: ['messageId', 'timestamp'],
  },
  facebook_ads: {
    inputs:  ['audience', 'budget', 'adCopy', 'image'],
    outputs: ['campaignId', 'adSetId', 'adId', 'impressions'],
  },
  heygen: {
    inputs:  ['script', 'avatarId', 'voiceId'],
    outputs: ['videoUrl', 'videoId'],
  },
  manychat: {
    inputs:  ['topic', 'context', 'audience', 'offer', 'channels'],
    outputs: ['sequence', 'day0Message', 'day1Message', 'day7Message', 'day30Message'],
  },
  hubspot: {
    inputs:  ['contactEmail', 'firstName', 'lastName', 'company', 'tag', 'dealName', 'stage', 'amount'],
    outputs: ['contactId', 'email', 'firstName', 'lastName', 'company', 'dealId', 'dealStage', 'notes'],
  },
  keap: {
    inputs:  ['contactEmail', 'firstName', 'lastName', 'tag', 'sequenceId', 'note'],
    outputs: ['contactId', 'email', 'firstName', 'lastName', 'tags', 'sequenceStatus'],
  },
  social_hub: {
    inputs:  ['postContent', 'imageUrl', 'platform', 'scheduledTime', 'replyTo'],
    outputs: ['postId', 'postUrl', 'platform', 'publishedAt', 'engagement'],
  },
  payment_hub: {
    inputs:  ['customerEmail', 'amount', 'currency', 'description', 'customerId'],
    outputs: ['paymentId', 'paymentUrl', 'status', 'invoiceId', 'receiptUrl'],
  },
};

// ─── GHL action catalogue ─────────────────────────────────────────────────────

const GHL_ACTIONS = [
  { key: 'funnel',   label: 'Build Funnel',    icon: '🚀' },
  { key: 'website',  label: 'Build Website',   icon: '🌐' },
  { key: 'blog',     label: 'Blog Post',       icon: '✍️' },
  { key: 'email',    label: 'Email Campaign',  icon: '✉️' },
  { key: 'pipeline', label: 'Pipeline / CRM',  icon: '📊' },
  { key: 'contacts', label: 'Contacts',        icon: '👥' },
  { key: 'social',   label: 'Social Posts',    icon: '📱' },
  { key: 'custom',   label: 'Custom Action',   icon: '⚡' },
];

const FUNNEL_TYPES = [
  { key: 'sales',          label: 'Sales Funnel',     pages: [{ key:'opt-in',label:'Opt-in',url:'opt-in',req:true},{key:'sales',label:'Sales',url:'sales',req:true},{key:'order',label:'Order',url:'order',req:true},{key:'upsell',label:'Upsell',url:'upsell',req:false},{key:'thank-you',label:'Thank You',url:'thank-you',req:true}] },
  { key: 'webinar',        label: 'Webinar Funnel',   pages: [{ key:'registration',label:'Registration',url:'register',req:true},{key:'confirmation',label:'Confirmation',url:'confirm',req:true},{key:'replay',label:'Replay',url:'replay',req:false},{key:'thank-you',label:'Thank You',url:'thank-you',req:true}] },
  { key: 'lead-gen',       label: 'Lead Gen',         pages: [{ key:'squeeze',label:'Squeeze',url:'get-access',req:true},{key:'thank-you',label:'Thank You',url:'thank-you',req:true}] },
  { key: 'tripwire',       label: 'Tripwire',         pages: [{ key:'landing',label:'Landing',url:'landing',req:true},{key:'tripwire',label:'Offer',url:'offer',req:true},{key:'upsell',label:'Upsell',url:'upsell',req:true},{key:'thank-you',label:'Thank You',url:'thank-you',req:true}] },
  { key: 'product-launch', label: 'Product Launch',   pages: [{ key:'prelaunch',label:'Pre-launch',url:'coming-soon',req:true},{key:'launch',label:'Launch',url:'launch',req:true},{key:'order',label:'Order',url:'order',req:true},{key:'thank-you',label:'Thank You',url:'thank-you',req:true}] },
  { key: 'free-trial',     label: 'Free Trial / SaaS',pages: [{ key:'landing',label:'Landing',url:'start',req:true},{key:'signup',label:'Sign Up',url:'sign-up',req:true},{key:'welcome',label:'Welcome',url:'welcome',req:true}] },
  { key: 'membership',     label: 'Membership',       pages: [{ key:'sales',label:'Sales',url:'join',req:true},{key:'registration',label:'Registration',url:'register',req:true},{key:'thank-you',label:'Thank You',url:'thank-you',req:true}] },
];

const WEBSITE_TYPES = [
  { key: 'business',  label: 'Business Website', pages: [{key:'home',label:'Home',url:'home',req:true},{key:'about',label:'About',url:'about',req:true},{key:'services',label:'Services',url:'services',req:true},{key:'contact',label:'Contact',url:'contact',req:true}] },
  { key: 'service',   label: 'Service Business', pages: [{key:'home',label:'Home',url:'home',req:true},{key:'services',label:'Services',url:'services',req:true},{key:'faq',label:'FAQ',url:'faq',req:false},{key:'contact',label:'Contact',url:'contact',req:true}] },
  { key: 'portfolio', label: 'Portfolio',        pages: [{key:'home',label:'Home',url:'home',req:true},{key:'portfolio',label:'Portfolio',url:'work',req:true},{key:'contact',label:'Contact',url:'contact',req:true}] },
];

const BLOG_TYPES = ['How-To Guide','Listicle','Case Study','News / Announcement','SEO Pillar Post','Comparison Post'];
const EMAIL_TYPES = ['Welcome','Value / Nurture','Case Study','Objection Handler','Sales / Offer','Follow-up','Re-engagement'];
const PIPELINE_ACTIONS = ['Create opportunity','Move to stage','List open opportunities'];
const CONTACT_ACTIONS  = ['Search contacts','Create contact','Add tags','Add to workflow'];

// CRM actions (HubSpot / Keap)
const CRM_ACTIONS = [
  { key: 'search_contacts',  label: 'Search Contacts',        icon: '🔍' },
  { key: 'create_contact',   label: 'Create Contact',         icon: '➕' },
  { key: 'update_contact',   label: 'Update Contact',         icon: '✏️' },
  { key: 'add_tags',         label: 'Add Tags / Labels',      icon: '🏷️' },
  { key: 'add_sequence',     label: 'Add to Sequence',        icon: '📋' },
  { key: 'create_deal',      label: 'Create Deal / Opportunity', icon: '💰' },
  { key: 'update_deal',      label: 'Update Deal Stage',      icon: '📊' },
  { key: 'create_note',      label: 'Create Note',            icon: '📝' },
  { key: 'list_contacts',    label: 'List Contacts',          icon: '👥' },
  { key: 'search_companies', label: 'Search Companies',       icon: '🏢' },
  { key: 'create_company',   label: 'Create Company',         icon: '🏗️' },
  { key: 'custom',           label: 'Custom Action',          icon: '⚡' },
];

// Social Hub
const SOCIAL_PLATFORMS = [
  { key: 'facebook',  label: 'Facebook',          icon: '📘' },
  { key: 'instagram', label: 'Instagram',         icon: '📸' },
  { key: 'tiktok',    label: 'TikTok',            icon: '🎵' },
  { key: 'youtube',   label: 'YouTube',           icon: '▶️'  },
  { key: 'linkedin',  label: 'LinkedIn',          icon: '💼' },
  { key: 'pinterest', label: 'Pinterest',         icon: '📌' },
  { key: 'twitter',   label: 'Twitter / X',       icon: '🐦' },
  { key: 'gmb',       label: 'Google Business',   icon: '📍' },
];
const SOCIAL_ACTIONS = [
  { key: 'create_post',    label: 'Create & Publish Post',    icon: '📢' },
  { key: 'schedule_post',  label: 'Schedule Post',            icon: '📅' },
  { key: 'reply_comment',  label: 'Reply to Comment',         icon: '💬' },
  { key: 'send_dm',        label: 'Send Direct Message',      icon: '✉️' },
  { key: 'get_analytics',  label: 'Get Post Analytics',       icon: '📊' },
  { key: 'list_posts',     label: 'List Recent Posts',        icon: '📋' },
  { key: 'custom',         label: 'Custom Action',            icon: '⚡' },
];

// Payment Hub
const PAYMENT_GATEWAYS = [
  { key: 'stripe',       label: 'Stripe',         icon: '💳' },
  { key: 'paypal',       label: 'PayPal',         icon: '🔵' },
  { key: 'square',       label: 'Square',         icon: '⬛' },
  { key: 'authorizenet', label: 'Authorize.net',  icon: '🔐' },
];
const PAYMENT_ACTIONS = [
  { key: 'create_payment_link', label: 'Create Payment Link',    icon: '🔗' },
  { key: 'create_invoice',      label: 'Create Invoice',         icon: '🧾' },
  { key: 'charge_customer',     label: 'Charge Customer',        icon: '💰' },
  { key: 'check_subscription',  label: 'Check Subscription',     icon: '🔄' },
  { key: 'list_transactions',   label: 'List Transactions',      icon: '📋' },
  { key: 'refund_payment',      label: 'Refund Payment',         icon: '↩️' },
  { key: 'create_coupon',       label: 'Create Coupon / Discount', icon: '🎟️' },
  { key: 'get_customer',        label: 'Get Customer Details',   icon: '👤' },
  { key: 'custom',              label: 'Custom Action',          icon: '⚡' },
];

// ─── Config → instruction ─────────────────────────────────────────────────────

function configToInstruction(config, context) {
  const ctx = context ? ` Context: ${context}.` : '';
  switch (config?.action) {
    case 'funnel': {
      const ft    = FUNNEL_TYPES.find(f => f.key === config.funnelType);
      const pages = (config.selectedPages || []).map(p => `  - ${p.label} (/${p.url})`).join('\n');
      return `Build a complete ${ft?.label || 'funnel'} in GHL.${ctx}\nPages:\n${pages}\nUse list_funnels then create_funnel_page with GHL native element sections.`;
    }
    case 'website': {
      const wt    = WEBSITE_TYPES.find(w => w.key === config.websiteType);
      const pages = (config.selectedPages || []).map(p => `  - ${p.label} (/${p.url})`).join('\n');
      return `Build a complete ${wt?.label || 'website'} in GHL.${ctx}\nPages:\n${pages}\nUse list_websites then create_website_page with GHL native element sections.`;
    }
    case 'blog':
      return `Write and publish a ${config.blogType || 'blog post'} in GHL.${ctx}\nWrite complete SEO-optimised post, generate/upload hero image, create with create_blog_post.`;
    case 'email': {
      const types = (config.emailTypes || []).join(', ');
      return `Generate email sequence: ${types}.${ctx}\nFor each email: subject (2 A/B options), preview text, full body, P.S. Output as a table ready to paste into GHL.`;
    }
    case 'pipeline':
      return `GHL Pipeline: ${config.pipelineAction || 'manage opportunities'}.${ctx} ${config.pipelineDetail || ''}`;
    case 'contacts':
      return `GHL Contacts: ${config.contactAction || 'manage contacts'}.${ctx} ${config.contactDetail || ''}`;
    case 'social':
      return `Create and schedule social posts in GHL Social Planner.${ctx} ${config.socialDetail || 'Post for all connected accounts.'}`;
    case 'manychat_sequence': {
      const ch    = config.channels?.join(', ') || 'Messenger';
      const n     = config.steps   || 7;
      const end   = config.endDay  || 30;
      const extra = config.extraContext ? `\nExtra context: ${config.extraContext}` : '';
      return `Generate a ManyChat "0 to Hero" subscriber nurture sequence.${ctx}${extra}
Topic/Business: ${config.topic || '[fill in topic]'}
Channels: ${ch}
Messages: ${n} (Day 0 → Day ${end})

For each message output:
- day (number), delay_hours (cumulative from Day 0), label (e.g. "Day 0 — Welcome")
- channel (${ch.split(',')[0].trim().toLowerCase()})
- message (conversational, 2–4 sentences, includes {{first name}} personalization)
- cta (clear call-to-action)

Arc: Day 0 = Welcome, Day 1 = Quick win, Day 3 = Education, Day 7 = Social proof, Day 14 = Objections, Day 21 = Soft offer, Day 30 = Strong CTA.
Output the full sequence as a JSON array and then a human-readable summary of each message.`;
    }
    case 'crm_action': {
      const crmLabel = CRM_ACTIONS.find(a => a.key === config.crmAction)?.label || config.crmAction;
      return `${node?.toolLabel || 'CRM'}: ${crmLabel}.${ctx} ${config.crmDetail || ''}`;
    }
    case 'social_hub': {
      const platforms = (config.platforms || []).map(p => SOCIAL_PLATFORMS.find(x => x.key === p)?.label || p).join(', ') || 'all connected platforms';
      const actionLabel = SOCIAL_ACTIONS.find(a => a.key === config.action)?.label || config.action;
      return `Social Hub — ${actionLabel} on ${platforms}.${ctx} ${config.detail || ''}`;
    }
    case 'payment_hub': {
      const gw = PAYMENT_GATEWAYS.find(g => g.key === config.gateway)?.label || config.gateway || 'Payment Gateway';
      const actionLabel = PAYMENT_ACTIONS.find(a => a.key === config.paymentAction)?.label || config.paymentAction;
      return `${gw}: ${actionLabel || 'process payment'}.${ctx} ${config.detail || ''}`;
    }
    case 'custom':
    default:
      return config?.customInstruction || '(no instruction set)';
  }
}

// ─── Topological sort ─────────────────────────────────────────────────────────

function topoSort(nodes, edges) {
  const inDeg = new Map(nodes.map(n => [n.id, 0]));
  const adj   = new Map(nodes.map(n => [n.id, []]));
  for (const e of edges) {
    adj.get(e.fromNodeId)?.push(e.toNodeId);
    inDeg.set(e.toNodeId, (inDeg.get(e.toNodeId) || 0) + 1);
  }
  const queue  = nodes.filter(n => inDeg.get(n.id) === 0);
  const result = [];
  while (queue.length) {
    const n = queue.shift();
    result.push(n);
    for (const nid of adj.get(n.id) || []) {
      const d = inDeg.get(nid) - 1;
      inDeg.set(nid, d);
      if (d === 0) queue.push(nodes.find(x => x.id === nid));
    }
  }
  const seen = new Set(result.map(n => n.id));
  return [...result, ...nodes.filter(n => !seen.has(n.id))];
}

function buildGraphPrompt(nodes, edges, context) {
  const sorted = topoSort(nodes, edges);
  const lines  = sorted.map((node, idx) => {
    const inEdges  = edges.filter(e => e.toNodeId === node.id);
    const mappings = inEdges.flatMap(e => (e.mappings || []).map(m => `"${m.from}" → "${m.to}"`));
    const mapNote  = mappings.length ? `\n  Field inputs from previous steps: ${mappings.join(', ')}` : '';
    const instr    = ['ghl', 'manychat', 'hubspot', 'keap', 'social_hub', 'payment_hub'].includes(node.tool) && node.config
      ? configToInstruction(node.config, context)
      : (node.instruction || `Execute ${node.label}`);
    return `STEP ${idx + 1} [${node.label}]:\n${instr}${mapNote}`;
  }).join('\n\n');
  return `Execute this multi-step workflow in order. Complete every step before the next.\n${context ? `Context: ${context}\n` : ''}\n${lines}\n\nAfter all steps: full summary of everything created, with GHL IDs and URLs.`;
}

// ─── ID helpers ───────────────────────────────────────────────────────────────

function uid() { return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

function mkNode(tool, label, icon, x, y) {
  let config = null;
  if (tool === 'ghl') config = { action: null };
  else if (tool === 'hubspot' || tool === 'keap') config = { action: 'crm_action', crmAction: null };
  else if (tool === 'social_hub') config = { action: 'social_hub', platforms: [], socialAction: null };
  else if (tool === 'payment_hub') config = { action: 'payment_hub', gateway: null, paymentAction: null };
  return { id: `n_${uid()}`, tool, label, icon, x, y, instruction: '', config };
}

// ─── Port position helpers ────────────────────────────────────────────────────

function outPortPos(node) { return { x: node.x + NODE_W, y: node.y + 24 }; }
function inPortPos(node)  { return { x: node.x,          y: node.y + 24 }; }

function edgePath(x1, y1, x2, y2) {
  const cx = (x1 + x2) / 2;
  return `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`;
}

// ─── Quick templates ──────────────────────────────────────────────────────────

const TEMPLATES = [
  {
    name: '🚀 Full Campaign Launch',
    context: 'Complete go-to-market campaign',
    nodes: [
      { tool:'perplexity', label:'Research',      icon:'🔍', x:60,  y:80,  instruction:'Research the niche, competitors, target audience, and key messaging angles.' },
      { tool:'openai',     label:'Write Copy',    icon:'✨', x:380, y:80,  instruction:'Using the research, write complete campaign copy: headlines, body, CTAs, email subject lines.' },
      { tool:'ghl',        label:'Build Funnel',  icon:'⚡', x:700, y:80,  config:{ action:'funnel', funnelType:'sales', selectedPages:[{key:'opt-in',label:'Opt-in',url:'opt-in',req:true},{key:'sales',label:'Sales',url:'sales',req:true},{key:'thank-you',label:'Thank You',url:'thank-you',req:true}] } },
      { tool:'ghl',        label:'Email Sequence',icon:'✉️', x:700, y:280, config:{ action:'email', emailTypes:['welcome','value','offer'] } },
      { tool:'ghl',        label:'Social Posts',  icon:'📱', x:700, y:460, config:{ action:'social', socialDetail:'Promote the funnel launch across all connected social accounts.' } },
    ],
    edges: [
      { fromIdx:0, toIdx:1, mappings:[{from:'research',to:'context'}] },
      { fromIdx:1, toIdx:2, mappings:[{from:'headline',to:'offer'},{from:'body',to:'audience'}] },
      { fromIdx:1, toIdx:3, mappings:[{from:'body',to:'context'}] },
      { fromIdx:2, toIdx:4, mappings:[{from:'funnelUrl',to:'content'}] },
    ],
  },
  {
    name: '🔍 Research → Blog',
    context: 'SEO content workflow',
    nodes: [
      { tool:'perplexity', label:'Research',    icon:'🔍', x:60,  y:100, instruction:'Research [topic] and find top-ranking competitor content, key questions, and statistics.' },
      { tool:'ghl',        label:'Blog Post',   icon:'✍️', x:380, y:100, config:{ action:'blog', blogType:'SEO Pillar Post' } },
      { tool:'ghl',        label:'Social Posts',icon:'📱', x:700, y:100, config:{ action:'social', socialDetail:'Create 3 promotional posts for the blog article.' } },
    ],
    edges: [
      { fromIdx:0, toIdx:1, mappings:[{from:'keyPoints',to:'context'},{from:'competitors',to:'context'}] },
      { fromIdx:1, toIdx:2, mappings:[{from:'pageUrl',to:'content'}] },
    ],
  },
  {
    name: '🚀 Lead Outreach',
    context: 'B2B outbound',
    nodes: [
      { tool:'apollo', label:'Find Leads',     icon:'🚀', x:60,  y:100, instruction:'Find 10 [job title] prospects at [industry] companies.' },
      { tool:'ghl',    label:'Add Contacts',   icon:'👥', x:380, y:100, config:{ action:'contacts', contactAction:'Create contact', contactDetail:'Add found prospects tagged "apollo-lead".' } },
      { tool:'sendgrid',label:'Send Emails',   icon:'📧', x:700, y:100, instruction:'Send a personalised outreach email to each new GHL contact.' },
    ],
    edges: [
      { fromIdx:0, toIdx:1, mappings:[{from:'email',to:'email'},{from:'firstName',to:'firstName'},{from:'phone',to:'phone'}] },
      { fromIdx:1, toIdx:2, mappings:[{from:'email',to:'to_email'},{from:'firstName',to:'context'}] },
    ],
  },
  {
    name: '💙 0 to Hero (ManyChat)',
    context: 'Complete subscriber nurture sequence',
    nodes: [
      { tool:'perplexity', label:'Research Audience', icon:'🔍', x:60,  y:100, instruction:'Research the target audience, their pain points, objections, and what motivates them to buy. Include competitor messaging and proven hooks.' },
      { tool:'manychat',   label:'ManyChat Sequence', icon:'💙', x:380, y:100, config:{ action:'manychat_sequence', topic:'[your product/service]', channels:['messenger','instagram'], steps:7, endDay:30 } },
      { tool:'ghl',        label:'Add to Workflow',   icon:'⚡', x:700, y:100, config:{ action:'contacts', contactAction:'Add to workflow', contactDetail:'Add new subscribers to the ManyChat nurture GHL workflow and tag them "mc-sequence-active".' } },
    ],
    edges: [
      { fromIdx:0, toIdx:1, mappings:[{from:'summary',to:'context'},{from:'keyPoints',to:'topic'}] },
      { fromIdx:1, toIdx:2, mappings:[{from:'day0Message',to:'context'}] },
    ],
  },
];

// ─── applyEvent ───────────────────────────────────────────────────────────────

function applyEvent(prev, type, data) {
  if (type === 'text') {
    const last = prev[prev.length - 1];
    if (last?.type === 'text') return [...prev.slice(0, -1), { ...last, text: last.text + data.text }];
    return [...prev, { type: 'text', text: data.text }];
  }
  if (type === 'tool_call')   return [...prev, { type:'tool_call',   name:data.name,  input:data.input }];
  if (type === 'tool_result') return [...prev, { type:'tool_result', name:data.name,  result:data.result }];
  if (type === 'done')        return [...prev, { type:'done',        turns:data.turns, toolCallCount:data.toolCallCount }];
  if (type === 'error')       return [...prev, { type:'error',       error:data.error }];
  return prev;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Workflows() {
  const { isAuthenticated, isAuthLoading, locationId, integrations } = useApp();
  const { isRunning, stream, stop } = useStreamFetch();

  const [nodes,     setNodes]     = useState([]);
  const [edges,     setEdges]     = useState([]);
  const [wfName,    setWfName]    = useState('');
  const [context,   setContext]   = useState('');
  const [messages,  setMessages]  = useState([]);
  const [saved,     setSaved]     = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [webhookUrl,setWebhookUrl]= useState('');
  const [saving,    setSaving]    = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [copyDone,  setCopyDone]  = useState(false);
  const [showOutput,setShowOutput]= useState(false);

  // Connecting state
  const [connecting, setConnecting] = useState(null); // { fromNodeId, x, y }
  const [mousePos,   setMousePos]   = useState({ x: 0, y: 0 });

  // Selected edge for field mapping
  const [selectedEdge, setSelectedEdge] = useState(null);

  // Selected node for config panel
  const [selectedNode, setSelectedNode] = useState(null);

  const canvasRef = useRef(null);

  const enabledKeys = new Set((integrations || []).filter(i => i.enabled).map(i => i.key));

  // ── Saved workflows ────────────────────────────────────────────────────────

  const loadSaved = useCallback(async () => {
    if (!locationId) return;
    try {
      const res  = await fetch('/workflows', { headers: { 'x-location-id': locationId } });
      const data = await res.json();
      if (data.success) setSaved(data.data || []);
    } catch { /* non-fatal */ }
  }, [locationId]);

  useEffect(() => { loadSaved(); }, [loadSaved]);

  // ── Canvas mouse ───────────────────────────────────────────────────────────

  function canvasXY(e) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onCanvasMouseMove(e) {
    if (connecting) setMousePos(canvasXY(e));
  }

  function onCanvasClick(e) {
    if (connecting && e.target === canvasRef.current) {
      setConnecting(null); // cancel if click on empty canvas
    }
    if (e.target === canvasRef.current) {
      setSelectedEdge(null);
      setSelectedNode(null);
    }
  }

  // ── Drop node from palette ─────────────────────────────────────────────────

  function dropNode(tool, label, icon, e) {
    const { x, y } = canvasXY(e);
    const nx = Math.max(0, x - NODE_W / 2);
    const ny = Math.max(0, y - 24);
    setNodes(prev => [...prev, mkNode(tool, label, icon, nx, ny)]);
  }

  function addNode(tool, label, icon) {
    // Place in a cascading position
    const last = nodes[nodes.length - 1];
    const x = last ? last.x + NODE_W + 80 : 60;
    const y = last ? last.y : 120;
    setNodes(prev => [...prev, mkNode(tool, label, icon, x, y)]);
  }

  // ── Node drag ─────────────────────────────────────────────────────────────

  function startDrag(nodeId, e) {
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const node   = nodes.find(n => n.id === nodeId);
    const ox = node.x, oy = node.y;

    function onMove(ev) {
      setNodes(prev => prev.map(n =>
        n.id === nodeId ? { ...n, x: ox + ev.clientX - startX, y: oy + ev.clientY - startY } : n
      ));
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // ── Ports ─────────────────────────────────────────────────────────────────

  function startConnect(nodeId, e) {
    e.stopPropagation();
    const p = outPortPos(nodes.find(n => n.id === nodeId));
    setConnecting({ fromNodeId: nodeId, x: p.x, y: p.y });
    setMousePos(canvasXY(e));
  }

  function finishConnect(toNodeId, e) {
    e.stopPropagation();
    if (!connecting || connecting.fromNodeId === toNodeId) { setConnecting(null); return; }
    const newEdge = { id: `e_${uid()}`, fromNodeId: connecting.fromNodeId, toNodeId, mappings: [] };
    setEdges(prev => [...prev, newEdge]);
    setSelectedEdge(newEdge);
    setConnecting(null);
  }

  // ── Node config ───────────────────────────────────────────────────────────

  function updateNode(id, patch) {
    setNodes(prev => prev.map(n => n.id === id ? { ...n, ...patch } : n));
    if (selectedNode?.id === id) setSelectedNode(prev => ({ ...prev, ...patch }));
  }

  function updateNodeConfig(id, cfg) {
    updateNode(id, { config: cfg });
  }

  function deleteNode(id) {
    setNodes(prev => prev.filter(n => n.id !== id));
    setEdges(prev => prev.filter(e => e.fromNodeId !== id && e.toNodeId !== id));
    if (selectedNode?.id === id) setSelectedNode(null);
  }

  function deleteEdge(id) {
    setEdges(prev => prev.filter(e => e.id !== id));
    if (selectedEdge?.id === id) setSelectedEdge(null);
  }

  function updateEdgeMappings(edgeId, mappings) {
    setEdges(prev => prev.map(e => e.id === edgeId ? { ...e, mappings } : e));
    setSelectedEdge(prev => prev?.id === edgeId ? { ...prev, mappings } : prev);
  }

  // ── Run ───────────────────────────────────────────────────────────────────

  const run = useCallback(async () => {
    if (!nodes.length || isRunning) return;
    setMessages([]);
    setShowOutput(true);
    const prompt  = buildGraphPrompt(nodes, edges, context);
    const allowed = [...new Set(nodes.map(n => n.tool).filter(t => t !== 'ghl'))];
    await stream(
      '/claude/task',
      { task: prompt, allowedIntegrations: allowed.length ? allowed : null },
      (evtType, data) => setMessages(prev => applyEvent(prev, evtType, data)),
      locationId,
    );
  }, [nodes, edges, context, isRunning, stream, locationId]);

  // ── Save / load ───────────────────────────────────────────────────────────

  const save = async () => {
    if (!wfName.trim() || !nodes.length) return;
    setSaving(true);
    try {
      const steps = nodes.map(n => ({ ...n, instruction: n.instruction || '' }));
      const res  = await fetch('/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-location-id': locationId },
        body: JSON.stringify({ id: currentId, name: wfName.trim(), steps, context, edges }),
      });
      const data = await res.json();
      if (data.success) {
        setCurrentId(data.data.id);
        setWebhookUrl(`${window.location.origin}/workflows/trigger/${data.data.webhookToken}`);
        await loadSaved();
        setShowSaved(false);
      }
    } catch { /* non-fatal */ }
    finally { setSaving(false); }
  };

  const loadWorkflow = wf => {
    setWfName(wf.name); setContext(wf.context || '');
    setNodes((wf.steps || []).map(s => ({ ...s, id: s.id || `n_${uid()}` })));
    setEdges(wf.edges || []);
    setCurrentId(wf.id);
    setWebhookUrl(`${window.location.origin}/workflows/trigger/${wf.webhookToken}`);
    setMessages([]); setShowSaved(false); setSelectedEdge(null); setSelectedNode(null);
  };

  const newWorkflow = () => {
    setNodes([]); setEdges([]); setWfName(''); setContext([]);
    setMessages([]); setCurrentId(null); setWebhookUrl('');
    setSelectedEdge(null); setSelectedNode(null); setShowOutput(false);
  };

  const applyTemplate = tpl => {
    const ns = tpl.nodes.map(n => ({ ...mkNode(n.tool, n.label, n.icon, n.x, n.y), instruction: n.instruction || '', config: n.config || (n.tool === 'ghl' ? { action: null } : null) }));
    const es = (tpl.edges || []).map(e => ({ id: `e_${uid()}`, fromNodeId: ns[e.fromIdx].id, toNodeId: ns[e.toIdx].id, mappings: e.mappings || [] }));
    setNodes(ns); setEdges(es); setWfName(tpl.name); setContext(tpl.context);
    setMessages([]); setCurrentId(null); setWebhookUrl('');
    setSelectedEdge(null); setSelectedNode(null);
  };

  const copyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopyDone(true);
    setTimeout(() => setCopyDone(false), 2000);
  };

  // ── Guards ────────────────────────────────────────────────────────────────

  if (isAuthLoading)    return <Spinner />;
  if (!isAuthenticated) return (
    <AuthGate icon="🔀" title="Workflow Builder" subtitle="Connect your API key to build AI workflows">
      <Link to="/" className="block text-center text-xs text-gray-500 mt-4 hover:text-gray-300">← Back</Link>
    </AuthGate>
  );

  // SVG temp edge
  const tempEdge = connecting
    ? edgePath(connecting.x, connecting.y, mousePos.x, mousePos.y)
    : null;

  return (
    <div className="flex flex-col" style={{ height: '100vh', background: '#0f0f13' }}>
      <Header icon="🔀" title="Workflow Builder" subtitle="Visual canvas — drag, connect, map fields, run" />

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 flex-shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.25)' }}>
        <input value={wfName} onChange={e => setWfName(e.target.value)} placeholder="Workflow name…"
          className="field text-sm" style={{ width: 200 }} />
        <input value={context} onChange={e => setContext(e.target.value)}
          placeholder="Campaign context — e.g. FitPro coaching for busy moms, $297/mo"
          className="field text-xs flex-1" />
        <button onClick={newWorkflow} className="btn-ghost px-3 py-1.5 text-xs whitespace-nowrap">+ New</button>
        <button onClick={() => setShowSaved(v => !v)} className={`btn-ghost px-3 py-1.5 text-xs whitespace-nowrap${showSaved ? ' text-indigo-400' : ''}`}>
          📂 {saved.length > 0 ? `Saved (${saved.length})` : 'Saved'}
        </button>
        <button onClick={save} disabled={saving || !wfName.trim() || !nodes.length}
          className="btn-ghost px-3 py-1.5 text-xs whitespace-nowrap">
          {saving ? '…' : '💾 Save'}
        </button>
        <button onClick={isRunning ? stop : run} disabled={!isRunning && !nodes.length}
          className="btn-primary px-4 py-1.5 text-sm whitespace-nowrap">
          {isRunning ? '⏹ Stop' : '▶ Run Workflow'}
        </button>
        <button onClick={() => setShowOutput(v => !v)}
          className={`btn-ghost px-3 py-1.5 text-xs whitespace-nowrap${showOutput ? ' text-indigo-400' : ''}`}>
          ⚡ Output
        </button>
      </div>

      {/* Saved list */}
      {showSaved && (
        <div className="flex-shrink-0 overflow-y-auto" style={{ maxHeight: 180, borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.3)' }}>
          {saved.length === 0
            ? <p className="text-xs text-gray-600 px-4 py-3 text-center">No saved workflows.</p>
            : saved.map(wf => (
              <div key={wf.id} className="flex items-center gap-2 px-4 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <button onClick={() => loadWorkflow(wf)} className="flex-1 text-left text-xs text-gray-300 hover:text-white truncate">
                  {wf.name} <span className="text-gray-600 ml-2">{wf.steps?.length} nodes</span>
                </button>
                <button onClick={async () => {
                  await fetch(`/workflows/${wf.id}`, { method: 'DELETE', headers: { 'x-location-id': locationId } });
                  loadSaved();
                }} className="text-gray-600 hover:text-red-400 text-sm px-1">×</button>
              </div>
            ))
          }
        </div>
      )}

      <div className="flex flex-1 overflow-hidden" style={{ minHeight: 0 }}>

        {/* ── Tool Palette ── */}
        <aside className="flex-shrink-0 w-44 flex flex-col overflow-y-auto"
          style={{ borderRight: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.2)' }}>
          <div className="px-3 pt-3 pb-1">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Tools</p>
            <p className="text-xs text-gray-700 mt-0.5">Click to add</p>
          </div>
          <div className="flex flex-col gap-1 px-2 py-2">
            {(() => {
              const SOCIAL_KEYS_SIDEBAR = ['ghl_social_planner','social_facebook','social_instagram','social_tiktok_organic','social_youtube','social_linkedin_organic','social_pinterest','social_twitter','social_gmb'];
              const PAYMENT_KEYS_SIDEBAR = ['stripe','paypal','square','authorizenet'];
              const paletteTools = [
                { key:'ghl', label:'GHL CRM', icon:'⚡', alwaysOn:true },
                { key:'social_hub', label:'Social Hub', icon:'📱', enabled: SOCIAL_KEYS_SIDEBAR.some(k => enabledKeys.has(k)) },
                { key:'payment_hub', label:'Payment Hub', icon:'💳', enabled: PAYMENT_KEYS_SIDEBAR.some(k => enabledKeys.has(k)) },
                ...INTEGRATIONS.map(i => ({ key:i.key, label:i.label, icon:i.icon })),
              ];
              return paletteTools.map(t => {
                const enabled = t.alwaysOn || ('enabled' in t ? t.enabled : enabledKeys.has(t.key));
                const color   = TOOL_COLOR[t.key] || '#6366f1';
                return (
                  <button key={t.key} onClick={() => enabled && addNode(t.key, t.label, t.icon)}
                    title={enabled ? `Add ${t.label}` : 'Connect in Settings first'}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-left transition-all"
                    style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)', opacity: enabled ? 1 : 0.35, cursor: enabled ? 'pointer' : 'not-allowed' }}
                    onMouseOver={e => { if (enabled) e.currentTarget.style.borderColor = `${color}60`; }}
                    onMouseOut={e  => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; }}
                  >
                    <span className="text-base flex-shrink-0">{t.icon}</span>
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-white truncate">{t.label}</div>
                      <div className="text-xs" style={{ color: enabled ? color : '#4b5563' }}>
                        {enabled ? (t.alwaysOn ? 'Always on' : '✓ Connected') : 'Not connected'}
                      </div>
                    </div>
                  </button>
                );
              });
            })()}
          </div>
          <div className="flex-1" />
          <Link to="/settings" className="text-xs text-center text-indigo-400 hover:text-indigo-300 py-3 block">+ Connect APIs</Link>
        </aside>

        {/* ── Canvas ── */}
        <div className="flex-1 relative overflow-hidden" style={{ minWidth: 0 }}>
          {/* Canvas area */}
          <div
            ref={canvasRef}
            className="absolute inset-0 overflow-auto"
            style={{
              background: '#09090f',
              backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)',
              backgroundSize: '28px 28px',
              cursor: connecting ? 'crosshair' : 'default',
              minWidth: 1200,
              minHeight: 800,
            }}
            onMouseMove={onCanvasMouseMove}
            onClick={onCanvasClick}
          >
            {/* Nodes */}
            {nodes.map(node => (
              <CanvasNode
                key={node.id}
                node={node}
                selected={selectedNode?.id === node.id}
                connecting={connecting}
                onHeaderMouseDown={e => startDrag(node.id, e)}
                onOutPort={e => startConnect(node.id, e)}
                onInPort={e => finishConnect(node.id, e)}
                onSelect={() => { setSelectedNode(node); setSelectedEdge(null); }}
                onDelete={() => deleteNode(node.id)}
              />
            ))}

            {/* SVG edge layer */}
            <svg
              className="absolute inset-0 pointer-events-none"
              style={{ width: '100%', height: '100%', overflow: 'visible' }}
            >
              <defs>
                {Object.entries(TOOL_COLOR).map(([k, c]) => (
                  <marker key={k} id={`arrow-${k}`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L8,3 z" fill={c} />
                  </marker>
                ))}
              </defs>

              {edges.map(edge => {
                const fromNode = nodes.find(n => n.id === edge.fromNodeId);
                const toNode   = nodes.find(n => n.id === edge.toNodeId);
                if (!fromNode || !toNode) return null;
                const p1 = outPortPos(fromNode);
                const p2 = inPortPos(toNode);
                const color = TOOL_COLOR[fromNode.tool] || '#6366f1';
                const isSelected = selectedEdge?.id === edge.id;
                const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
                return (
                  <g key={edge.id}>
                    {/* Invisible wide hit area */}
                    <path d={edgePath(p1.x, p1.y, p2.x, p2.y)} fill="none" stroke="transparent" strokeWidth={16}
                      style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                      onClick={e => { e.stopPropagation(); setSelectedEdge(edge); setSelectedNode(null); }} />
                    {/* Visible edge */}
                    <path d={edgePath(p1.x, p1.y, p2.x, p2.y)} fill="none"
                      stroke={isSelected ? '#fff' : color}
                      strokeWidth={isSelected ? 2.5 : 1.5}
                      strokeDasharray={isSelected ? undefined : undefined}
                      markerEnd={`url(#arrow-${fromNode.tool})`}
                      style={{ transition: 'stroke 0.15s' }}
                    />
                    {/* Mapping count badge */}
                    {edge.mappings?.length > 0 && (
                      <g style={{ cursor: 'pointer', pointerEvents: 'all' }}
                        onClick={e => { e.stopPropagation(); setSelectedEdge(edge); setSelectedNode(null); }}>
                        <circle cx={mid.x} cy={mid.y} r={10} fill={color} opacity={0.9} />
                        <text x={mid.x} y={mid.y + 4} textAnchor="middle" fill="#fff" fontSize={10} fontWeight="bold">{edge.mappings.length}</text>
                      </g>
                    )}
                  </g>
                );
              })}

              {/* Temp edge while connecting */}
              {tempEdge && (
                <path d={tempEdge} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={1.5} strokeDasharray="6 3" />
              )}
            </svg>

            {/* Empty state */}
            {nodes.length === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 pointer-events-none">
                <p className="text-gray-600 text-sm">Click a tool to add it to the canvas</p>
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Quick templates</p>
                <div className="flex gap-3 pointer-events-auto">
                  {TEMPLATES.map(tpl => (
                    <button key={tpl.name} onClick={() => applyTemplate(tpl)}
                      className="text-xs px-4 py-2 rounded-xl text-gray-400 hover:text-indigo-300 transition-all"
                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                      onMouseOver={e => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.4)'; }}
                      onMouseOut={e  => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
                    >{tpl.name}</button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Hint bar */}
          {nodes.length > 0 && !connecting && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-xs text-gray-600 pointer-events-none px-3 py-1 rounded-full"
              style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.06)' }}>
              Click a node to configure · Drag the green dot to connect · Click an edge to map fields
            </div>
          )}
          {connecting && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-xs text-yellow-400 pointer-events-none px-3 py-1 rounded-full"
              style={{ background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(251,191,36,0.3)' }}>
              Click an input port (left side of a node) to connect · Press Escape to cancel
            </div>
          )}
        </div>

        {/* ── Right panel: node config OR field mapping OR output ── */}
        {(selectedNode || selectedEdge || showOutput) && (
          <div className="flex-shrink-0 flex flex-col overflow-hidden"
            style={{ width: 360, borderLeft: '1px solid rgba(255,255,255,0.06)', background: '#0f0f15' }}>

            {selectedNode && !selectedEdge && (
              <NodeConfigPanel
                node={selectedNode}
                onClose={() => setSelectedNode(null)}
                onChange={(patch) => updateNode(selectedNode.id, patch)}
                onConfigChange={(cfg) => updateNodeConfig(selectedNode.id, cfg)}
                onDelete={() => deleteNode(selectedNode.id)}
              />
            )}

            {selectedEdge && !selectedNode && (
              <FieldMappingPanel
                edge={selectedEdge}
                nodes={nodes}
                onClose={() => setSelectedEdge(null)}
                onDelete={() => deleteEdge(selectedEdge.id)}
                onSave={(mappings) => updateEdgeMappings(selectedEdge.id, mappings)}
              />
            )}

            {showOutput && !selectedNode && !selectedEdge && (
              <div className="flex flex-col flex-1 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <span className="text-sm font-semibold text-white flex-1">⚡ Live Output</span>
                  {isRunning && <span className="text-xs text-yellow-400 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />Running…</span>}
                  <button onClick={() => setShowOutput(false)} className="text-gray-600 hover:text-gray-300 text-sm">×</button>
                </div>
                <StreamOutput messages={messages} isRunning={isRunning}
                  placeholder={{ icon:'🔀', text:'Run the workflow to see output here' }} />
                {webhookUrl && (
                  <div className="px-3 py-2 flex-shrink-0 flex items-center gap-2"
                    style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(99,102,241,0.06)' }}>
                    <span className="text-xs text-indigo-400 flex-shrink-0">🔗</span>
                    <input readOnly value={webhookUrl} className="flex-1 bg-transparent text-xs text-gray-500 outline-none min-w-0" onClick={e => e.target.select()} />
                    <button onClick={copyWebhook} className="text-xs flex-shrink-0" style={{ color: copyDone ? '#4ade80' : '#818cf8' }}>{copyDone ? 'Copied!' : 'Copy'}</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Canvas Node ──────────────────────────────────────────────────────────────

function CanvasNode({ node, selected, connecting, onHeaderMouseDown, onOutPort, onInPort, onSelect, onDelete }) {
  const color  = TOOL_COLOR[node.tool] || '#6366f1';
  const action = node.config?.action ? GHL_ACTIONS.find(a => a.key === node.config.action) : null;

  return (
    <div
      style={{ position: 'absolute', left: node.x, top: node.y, width: NODE_W, zIndex: selected ? 10 : 1 }}
      onClick={e => { e.stopPropagation(); onSelect(); }}
    >
      {/* Input port (left) */}
      <div
        onMouseDown={e => e.stopPropagation()}
        onClick={onInPort}
        style={{
          position: 'absolute', left: -PORT_R, top: 24 - PORT_R,
          width: PORT_R * 2, height: PORT_R * 2, borderRadius: '50%',
          background: '#1f2937', border: `2px solid ${color}`,
          cursor: connecting ? 'crosshair' : 'default',
          zIndex: 20, transition: 'transform 0.1s',
        }}
        onMouseOver={e => { if (connecting) e.currentTarget.style.transform = 'scale(1.5)'; }}
        onMouseOut={e  => { e.currentTarget.style.transform = 'scale(1)'; }}
      />

      {/* Card */}
      <div style={{
        borderRadius: 14, overflow: 'hidden',
        border: `1px solid ${selected ? color : `${color}40`}`,
        background: '#13131a',
        boxShadow: selected ? `0 0 0 2px ${color}40` : 'none',
      }}>
        {/* Header */}
        <div
          onMouseDown={onHeaderMouseDown}
          style={{ background: `${color}18`, borderBottom: `1px solid ${color}30`, padding: '8px 10px', cursor: 'grab', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <span style={{ fontSize: 14, flexShrink: 0 }}>{node.icon}</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#fff', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.label}</span>
          {action && (
            <span style={{ fontSize: 10, color, background: `${color}20`, padding: '1px 6px', borderRadius: 4, flexShrink: 0 }}>{action.icon} {action.label}</span>
          )}
          <button onClick={e => { e.stopPropagation(); onDelete(); }}
            style={{ color: '#4b5563', fontSize: 14, lineHeight: 1, cursor: 'pointer', background: 'none', border: 'none', padding: 0, flexShrink: 0 }}
            onMouseOver={e => { e.currentTarget.style.color = '#f87171'; }}
            onMouseOut={e  => { e.currentTarget.style.color = '#4b5563'; }}
          >×</button>
        </div>

        {/* Status line */}
        <div style={{ padding: '6px 10px', fontSize: 11, color: '#6b7280' }}>
          {(() => {
            const isConfigTool = ['ghl','manychat','hubspot','keap','social_hub','payment_hub'].includes(node.tool);
            return (
              <>
                {node.tool === 'ghl' && !node.config?.action && <span style={{ color: '#f59e0b' }}>⚠ Click to configure action</span>}
                {node.tool === 'ghl' && node.config?.action && <span style={{ color: '#86efac' }}>✓ Configured</span>}
                {node.tool === 'manychat' && !node.config?.topic && <span style={{ color: '#f59e0b' }}>⚠ Click to set topic</span>}
                {node.tool === 'manychat' && node.config?.topic && <span style={{ color: '#60a5fa' }}>💙 {node.config.steps || 7}-msg sequence · {(node.config.channels || ['messenger']).join(', ')}</span>}
                {(node.tool === 'hubspot' || node.tool === 'keap') && !node.config?.crmAction && <span style={{ color: '#f59e0b' }}>⚠ Click to configure action</span>}
                {(node.tool === 'hubspot' || node.tool === 'keap') && node.config?.crmAction && <span style={{ color: '#86efac' }}>✓ {CRM_ACTIONS.find(a=>a.key===node.config.crmAction)?.label || node.config.crmAction}</span>}
                {node.tool === 'social_hub' && !node.config?.socialAction && <span style={{ color: '#f59e0b' }}>⚠ Click to select platform + action</span>}
                {node.tool === 'social_hub' && node.config?.socialAction && <span style={{ color: '#a78bfa' }}>📱 {(node.config.platforms||[]).join(', ') || 'all'} · {SOCIAL_ACTIONS.find(a=>a.key===node.config.socialAction)?.label}</span>}
                {node.tool === 'payment_hub' && !node.config?.paymentAction && <span style={{ color: '#f59e0b' }}>⚠ Click to select gateway + action</span>}
                {node.tool === 'payment_hub' && node.config?.paymentAction && <span style={{ color: '#34d399' }}>💳 {PAYMENT_GATEWAYS.find(g=>g.key===node.config.gateway)?.label || 'Gateway'} · {PAYMENT_ACTIONS.find(a=>a.key===node.config.paymentAction)?.label}</span>}
                {!isConfigTool && !node.instruction && <span style={{ color: '#f59e0b' }}>⚠ Click to add instruction</span>}
                {!isConfigTool && node.instruction && <span style={{ color: '#86efac', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>✓ {node.instruction.slice(0, 40)}{node.instruction.length > 40 ? '…' : ''}</span>}
              </>
            );
          })()}
        </div>
      </div>

      {/* Output port (right) */}
      <div
        onMouseDown={e => { e.stopPropagation(); onOutPort(e); }}
        style={{
          position: 'absolute', right: -PORT_R, top: 24 - PORT_R,
          width: PORT_R * 2, height: PORT_R * 2, borderRadius: '50%',
          background: color, border: `2px solid #fff`,
          cursor: 'crosshair', zIndex: 20, transition: 'transform 0.1s',
        }}
        onMouseOver={e => { e.currentTarget.style.transform = 'scale(1.4)'; }}
        onMouseOut={e  => { e.currentTarget.style.transform = 'scale(1)'; }}
      />
    </div>
  );
}

// ─── Node Config Panel ────────────────────────────────────────────────────────

function NodeConfigPanel({ node, onClose, onChange, onConfigChange, onDelete }) {
  const color = TOOL_COLOR[node.tool] || '#6366f1';
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span className="text-base">{node.icon}</span>
        <span className="text-sm font-semibold text-white flex-1">{node.label}</span>
        <button onClick={onDelete} className="text-gray-600 hover:text-red-400 text-xs mr-2">Delete</button>
        <button onClick={onClose} className="text-gray-600 hover:text-gray-300 text-sm">×</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {node.tool === 'ghl' ? (
          <GHLConfigInPanel config={node.config || { action: null }} onChange={onConfigChange} color={color} />
        ) : node.tool === 'manychat' ? (
          <ManyChatConfigInPanel config={node.config || { action: 'manychat_sequence', channels: ['messenger'], steps: 7, endDay: 30 }} onChange={onConfigChange} color={color} />
        ) : (node.tool === 'hubspot' || node.tool === 'keap') ? (
          <CRMConfigInPanel config={node.config || { action: 'crm_action', crmAction: null }} onChange={onConfigChange} color={color} toolLabel={node.label} />
        ) : node.tool === 'social_hub' ? (
          <SocialHubConfigInPanel config={node.config || { action: 'social_hub', platforms: [], socialAction: null }} onChange={onConfigChange} color={color} />
        ) : node.tool === 'payment_hub' ? (
          <PaymentConfigInPanel config={node.config || { action: 'payment_hub', gateway: null, paymentAction: null }} onChange={onConfigChange} color={color} />
        ) : (
          <div>
            <label className="block text-xs text-gray-400 mb-2">Instruction for {node.label}</label>
            <textarea value={node.instruction} onChange={e => onChange({ instruction: e.target.value })}
              placeholder={`What should ${node.label} do in this step?`}
              rows={6} className="field w-full text-sm" style={{ resize: 'vertical' }} />
            <p className="text-xs text-gray-600 mt-1">
              Available output fields: {(TOOL_FIELDS[node.tool]?.outputs || []).join(', ')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ManyChat Config In Panel ─────────────────────────────────────────────────

const MC_CHANNELS  = ['messenger', 'instagram', 'sms', 'email'];
const MC_STEP_OPTS = [5, 7, 10, 14];
const MC_END_DAYS  = [14, 21, 30, 45, 60, 90];

function ManyChatConfigInPanel({ config, onChange, color }) {
  const set = patch => onChange({ ...config, ...patch });
  const channels = config.channels || ['messenger'];

  function toggleChannel(ch) {
    if (channels.includes(ch)) {
      if (channels.length === 1) return; // keep at least one
      set({ channels: channels.filter(c => c !== ch) });
    } else {
      set({ channels: [...channels, ch] });
    }
  }

  return (
    <div className="space-y-4">
      {/* Topic */}
      <div>
        <p className="text-xs text-gray-400 mb-1">Topic / Business</p>
        <input
          value={config.topic || ''}
          onChange={e => set({ topic: e.target.value })}
          placeholder="e.g. Online fitness coaching, SaaS tool for agencies…"
          className="field w-full text-sm"
        />
        <p className="text-xs text-gray-600 mt-1">Claude will tailor every message to this topic.</p>
      </div>

      {/* Channels */}
      <div>
        <p className="text-xs text-gray-400 mb-1">Channels</p>
        <div className="grid grid-cols-2 gap-1.5">
          {MC_CHANNELS.map(ch => {
            const on = channels.includes(ch);
            const icons = { messenger:'💬', instagram:'📸', sms:'📱', email:'✉️' };
            return (
              <div key={ch} onClick={() => toggleChannel(ch)}
                className="flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer text-xs transition-all"
                style={{ background: on ? `${color}20` : 'rgba(255,255,255,0.03)', border:`1px solid ${on ? color+'60' : 'rgba(255,255,255,0.07)'}`, color: on ? '#fff' : '#9ca3af' }}>
                <span>{icons[ch]}</span>
                <span style={{ textTransform: 'capitalize' }}>{ch}</span>
                {on && <span style={{ color, fontWeight:700, marginLeft:'auto' }}>✓</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Steps */}
      <div>
        <p className="text-xs text-gray-400 mb-1">Number of messages</p>
        <div className="flex gap-1.5">
          {MC_STEP_OPTS.map(n => (
            <button key={n} onClick={() => set({ steps: n })}
              className="flex-1 py-1.5 rounded-lg text-xs transition-all"
              style={{ background: config.steps===n ? `${color}20` : 'rgba(255,255,255,0.03)', border:`1px solid ${config.steps===n ? color+'60' : 'rgba(255,255,255,0.07)'}`, color: config.steps===n ? '#fff' : '#9ca3af' }}>
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* End day */}
      <div>
        <p className="text-xs text-gray-400 mb-1">Sequence length (days)</p>
        <div className="grid grid-cols-3 gap-1">
          {MC_END_DAYS.map(d => (
            <button key={d} onClick={() => set({ endDay: d })}
              className="py-1.5 rounded-lg text-xs transition-all"
              style={{ background: config.endDay===d ? `${color}20` : 'rgba(255,255,255,0.03)', border:`1px solid ${config.endDay===d ? color+'60' : 'rgba(255,255,255,0.07)'}`, color: config.endDay===d ? '#fff' : '#9ca3af' }}>
              Day {d}
            </button>
          ))}
        </div>
      </div>

      {/* Context note */}
      <div>
        <p className="text-xs text-gray-400 mb-1">Extra context (optional)</p>
        <textarea value={config.extraContext || ''} onChange={e => set({ extraContext: e.target.value })}
          placeholder="Target audience, offer details, brand voice, key objections…"
          rows={3} className="field w-full text-xs" style={{ resize:'none' }} />
      </div>

      {/* Summary */}
      <div className="rounded-xl p-3 text-xs" style={{ background: `${color}10`, border: `1px solid ${color}30` }}>
        <p className="font-semibold" style={{ color }}>💙 Sequence Plan</p>
        <p className="text-gray-400 mt-1">
          {config.steps || 7} messages · {channels.join(' + ')} · Day 0 → Day {config.endDay || 30}
        </p>
        <p className="text-gray-500 mt-1">
          Arc: Welcome → Quick Win → Education → Social Proof → Objections → Soft Offer → CTA
        </p>
      </div>
    </div>
  );
}

// ─── GHL Config In Panel ──────────────────────────────────────────────────────

function GHLConfigInPanel({ config, onChange, color }) {
  const set = patch => onChange({ ...config, ...patch });
  const FUNNEL_TYPES_ALL = [
    { key:'sales',label:'Sales Funnel',pages:[{key:'opt-in',label:'Opt-in',url:'opt-in',req:true},{key:'sales',label:'Sales',url:'sales',req:true},{key:'order',label:'Order',url:'order',req:true},{key:'upsell',label:'Upsell',url:'upsell',req:false},{key:'thank-you',label:'Thank You',url:'thank-you',req:true}]},
    { key:'webinar',label:'Webinar',pages:[{key:'registration',label:'Registration',url:'register',req:true},{key:'confirmation',label:'Confirmation',url:'confirm',req:true},{key:'replay',label:'Replay',url:'replay',req:false},{key:'thank-you',label:'Thank You',url:'thank-you',req:true}]},
    { key:'lead-gen',label:'Lead Gen',pages:[{key:'squeeze',label:'Squeeze',url:'get-access',req:true},{key:'thank-you',label:'Thank You',url:'thank-you',req:true}]},
    { key:'tripwire',label:'Tripwire',pages:[{key:'landing',label:'Landing',url:'landing',req:true},{key:'tripwire',label:'Offer',url:'offer',req:true},{key:'upsell',label:'Upsell',url:'upsell',req:true},{key:'thank-you',label:'Thank You',url:'thank-you',req:true}]},
    { key:'product-launch',label:'Product Launch',pages:[{key:'prelaunch',label:'Pre-launch',url:'coming-soon',req:true},{key:'launch',label:'Launch',url:'launch',req:true},{key:'order',label:'Order',url:'order',req:true},{key:'thank-you',label:'Thank You',url:'thank-you',req:true}]},
    { key:'free-trial',label:'Free Trial / SaaS',pages:[{key:'landing',label:'Landing',url:'start',req:true},{key:'signup',label:'Sign Up',url:'sign-up',req:true},{key:'welcome',label:'Welcome',url:'welcome',req:true}]},
    { key:'membership',label:'Membership',pages:[{key:'sales',label:'Sales',url:'join',req:true},{key:'registration',label:'Registration',url:'register',req:true},{key:'thank-you',label:'Thank You',url:'thank-you',req:true}]},
  ];
  const WEBSITE_TYPES_ALL = [
    { key:'business', label:'Business Website',pages:[{key:'home',label:'Home',url:'home',req:true},{key:'about',label:'About',url:'about',req:true},{key:'services',label:'Services',url:'services',req:true},{key:'contact',label:'Contact',url:'contact',req:true}]},
    { key:'service',  label:'Service Business',pages:[{key:'home',label:'Home',url:'home',req:true},{key:'services',label:'Services',url:'services',req:true},{key:'faq',label:'FAQ',url:'faq',req:false},{key:'contact',label:'Contact',url:'contact',req:true}]},
    { key:'portfolio',label:'Portfolio',pages:[{key:'home',label:'Home',url:'home',req:true},{key:'portfolio',label:'Portfolio',url:'work',req:true},{key:'contact',label:'Contact',url:'contact',req:true}]},
  ];

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs text-gray-400 mb-2">GHL Action</p>
        <div className="grid grid-cols-2 gap-1.5">
          {GHL_ACTIONS.map(a => (
            <button key={a.key} onClick={() => set({ action: a.key })}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-all text-left"
              style={{ background: config.action===a.key ? `${color}20` : 'rgba(255,255,255,0.03)', border: `1px solid ${config.action===a.key ? color+'60' : 'rgba(255,255,255,0.07)'}`, color: config.action===a.key ? '#fff' : '#9ca3af' }}>
              <span>{a.icon}</span><span>{a.label}</span>
            </button>
          ))}
        </div>
      </div>

      {config.action === 'funnel' && (
        <SubTypeConfig label="Funnel type" types={FUNNEL_TYPES_ALL} selected={config.funnelType} selectedPages={config.selectedPages}
          onType={key => { const ft=FUNNEL_TYPES_ALL.find(f=>f.key===key); set({ funnelType:key, selectedPages: ft?.pages.map(p=>({...p})) || [] }); }}
          onTogglePage={page => { const cur=config.selectedPages||[]; set({ selectedPages: cur.find(p=>p.key===page.key) ? cur.filter(p=>p.key!==page.key) : [...cur,page] }); }}
        />
      )}
      {config.action === 'website' && (
        <SubTypeConfig label="Website type" types={WEBSITE_TYPES_ALL} selected={config.websiteType} selectedPages={config.selectedPages}
          onType={key => { const wt=WEBSITE_TYPES_ALL.find(w=>w.key===key); set({ websiteType:key, selectedPages: wt?.pages.map(p=>({...p})) || [] }); }}
          onTogglePage={page => { const cur=config.selectedPages||[]; set({ selectedPages: cur.find(p=>p.key===page.key) ? cur.filter(p=>p.key!==page.key) : [...cur,page] }); }}
        />
      )}
      {config.action === 'blog' && (
        <div>
          <p className="text-xs text-gray-400 mb-1">Blog type</p>
          <div className="grid grid-cols-2 gap-1">
            {BLOG_TYPES.map(bt => (
              <button key={bt} onClick={() => set({ blogType: bt })}
                className="text-xs px-2 py-1.5 rounded-lg text-left transition-all"
                style={{ background: config.blogType===bt ? `${color}20` : 'rgba(255,255,255,0.03)', border:`1px solid ${config.blogType===bt ? color+'60' : 'rgba(255,255,255,0.07)'}`, color: config.blogType===bt ? '#fff' : '#9ca3af' }}>
                {bt}
              </button>
            ))}
          </div>
        </div>
      )}
      {config.action === 'email' && (
        <div>
          <p className="text-xs text-gray-400 mb-1">Email types ({(config.emailTypes||[]).length} selected)</p>
          <div className="grid grid-cols-2 gap-1">
            {EMAIL_TYPES.map(et => {
              const on = (config.emailTypes||[]).includes(et);
              return (
                <div key={et} onClick={() => { const cur=config.emailTypes||[]; set({ emailTypes: on ? cur.filter(k=>k!==et) : [...cur,et] }); }}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 cursor-pointer text-xs transition-all"
                  style={{ background: on ? `${color}15` : 'rgba(255,255,255,0.03)', border:`1px solid ${on ? color+'50' : 'rgba(255,255,255,0.07)'}`, color: on ? '#fff' : '#9ca3af' }}>
                  <span style={{ color: on ? color : '#4b5563', fontWeight:700 }}>{on?'✓':'○'}</span>{et}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {config.action === 'pipeline' && (
        <div className="space-y-2">
          <p className="text-xs text-gray-400">Action</p>
          {PIPELINE_ACTIONS.map(a => (
            <div key={a} onClick={() => set({ pipelineAction: a })}
              className="flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer text-xs transition-all"
              style={{ background: config.pipelineAction===a ? `${color}15` : 'rgba(255,255,255,0.03)', border:`1px solid ${config.pipelineAction===a ? color+'50' : 'rgba(255,255,255,0.07)'}`, color: config.pipelineAction===a ? '#fff' : '#9ca3af' }}>
              <span style={{ color: config.pipelineAction===a ? color : '#4b5563', fontWeight:700 }}>{config.pipelineAction===a?'✓':'○'}</span>{a}
            </div>
          ))}
          <textarea value={config.pipelineDetail||''} onChange={e => set({ pipelineDetail: e.target.value })}
            placeholder='e.g. "Move contacts tagged lead-hot to Proposal Sent stage"'
            rows={2} className="field w-full text-xs mt-1" style={{ resize:'none' }} />
        </div>
      )}
      {config.action === 'contacts' && (
        <div className="space-y-2">
          <p className="text-xs text-gray-400">Action</p>
          {CONTACT_ACTIONS.map(a => (
            <div key={a} onClick={() => set({ contactAction: a })}
              className="flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer text-xs transition-all"
              style={{ background: config.contactAction===a ? `${color}15` : 'rgba(255,255,255,0.03)', border:`1px solid ${config.contactAction===a ? color+'50' : 'rgba(255,255,255,0.07)'}`, color: config.contactAction===a ? '#fff' : '#9ca3af' }}>
              <span style={{ color: config.contactAction===a ? color : '#4b5563', fontWeight:700 }}>{config.contactAction===a?'✓':'○'}</span>{a}
            </div>
          ))}
          <textarea value={config.contactDetail||''} onChange={e => set({ contactDetail: e.target.value })}
            placeholder='e.g. "Find all contacts tagged cold-lead and add to re-engagement workflow"'
            rows={2} className="field w-full text-xs mt-1" style={{ resize:'none' }} />
        </div>
      )}
      {config.action === 'social' && (
        <textarea value={config.socialDetail||''} onChange={e => set({ socialDetail: e.target.value })}
          placeholder='e.g. "Create 3 posts promoting the funnel launch across all connected accounts"'
          rows={3} className="field w-full text-xs" style={{ resize:'none' }} />
      )}
      {config.action === 'custom' && (
        <textarea value={config.customInstruction||''} onChange={e => set({ customInstruction: e.target.value })}
          placeholder="Describe what Claude should do with GHL in this step…"
          rows={4} className="field w-full text-sm" style={{ resize:'none' }} />
      )}
    </div>
  );
}

function SubTypeConfig({ label, types, selected, selectedPages, onType, onTogglePage }) {
  const tmpl = types.find(t => t.key === selected);
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-400">{label}</p>
      <div className="grid grid-cols-2 gap-1">
        {types.map(t => (
          <button key={t.key} onClick={() => onType(t.key)}
            className="text-xs px-2 py-1.5 rounded-lg text-left transition-all"
            style={{ background: selected===t.key ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.03)', border:`1px solid ${selected===t.key ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.07)'}`, color: selected===t.key ? '#86efac' : '#9ca3af' }}>
            {t.label}
          </button>
        ))}
      </div>
      {tmpl && (
        <>
          <p className="text-xs text-gray-400 mt-1">Pages</p>
          <div className="grid grid-cols-2 gap-1">
            {tmpl.pages.map(page => {
              const checked = !!(selectedPages||[]).find(p=>p.key===page.key);
              return (
                <div key={page.key} onClick={() => !page.req && onTogglePage(page)}
                  className="flex items-center gap-1.5 rounded px-2 py-1.5 text-xs transition-all"
                  style={{ background: checked ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.03)', border:`1px solid ${checked ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.06)'}`, color: checked ? '#86efac' : '#9ca3af', cursor: page.req ? 'default' : 'pointer' }}>
                  <span style={{ color: checked ? '#22c55e' : '#4b5563', fontWeight:700 }}>{checked?'✓':'○'}</span>
                  <span className="truncate">{page.label}</span>
                  {page.req && <span className="text-gray-700 ml-auto text-xs flex-shrink-0">req</span>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ─── CRM Config In Panel ──────────────────────────────────────────────────────

function CRMConfigInPanel({ config, onChange, color, toolLabel }) {
  const set = patch => onChange({ ...config, ...patch });
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs text-gray-400 mb-2">{toolLabel} Action</p>
        <div className="grid grid-cols-2 gap-1.5">
          {CRM_ACTIONS.map(a => (
            <button key={a.key} onClick={() => set({ crmAction: a.key })}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-all text-left"
              style={{ background: config.crmAction===a.key ? `${color}20` : 'rgba(255,255,255,0.03)', border: `1px solid ${config.crmAction===a.key ? color+'60' : 'rgba(255,255,255,0.07)'}`, color: config.crmAction===a.key ? '#fff' : '#9ca3af' }}>
              <span>{a.icon}</span><span>{a.label}</span>
            </button>
          ))}
        </div>
      </div>
      {config.crmAction && (
        <div>
          <p className="text-xs text-gray-400 mb-1">Details</p>
          <textarea value={config.crmDetail||''} onChange={e => set({ crmDetail: e.target.value })}
            placeholder={`e.g. "Search by email domain, tag as hot-lead, add to Q2 sequence"`}
            rows={3} className="field w-full text-xs" style={{ resize:'none' }} />
        </div>
      )}
    </div>
  );
}

// ─── Social Hub Config In Panel ───────────────────────────────────────────────

function SocialHubConfigInPanel({ config, onChange, color }) {
  const set = patch => onChange({ ...config, ...patch });
  const platforms = config.platforms || [];

  function togglePlatform(key) {
    if (platforms.includes(key)) set({ platforms: platforms.filter(p => p !== key) });
    else set({ platforms: [...platforms, key] });
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-gray-400 mb-2">Platform(s)</p>
        <div className="grid grid-cols-2 gap-1.5">
          {SOCIAL_PLATFORMS.map(p => {
            const on = platforms.includes(p.key);
            return (
              <div key={p.key} onClick={() => togglePlatform(p.key)}
                className="flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer text-xs transition-all"
                style={{ background: on ? `${color}20` : 'rgba(255,255,255,0.03)', border:`1px solid ${on ? color+'60' : 'rgba(255,255,255,0.07)'}`, color: on ? '#fff' : '#9ca3af' }}>
                <span>{p.icon}</span>
                <span>{p.label}</span>
                {on && <span style={{ color, fontWeight:700, marginLeft:'auto' }}>✓</span>}
              </div>
            );
          })}
        </div>
      </div>
      <div>
        <p className="text-xs text-gray-400 mb-2">Action</p>
        <div className="grid grid-cols-1 gap-1">
          {SOCIAL_ACTIONS.map(a => (
            <div key={a.key} onClick={() => set({ socialAction: a.key })}
              className="flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer text-xs transition-all"
              style={{ background: config.socialAction===a.key ? `${color}20` : 'rgba(255,255,255,0.03)', border:`1px solid ${config.socialAction===a.key ? color+'60' : 'rgba(255,255,255,0.07)'}`, color: config.socialAction===a.key ? '#fff' : '#9ca3af' }}>
              <span>{a.icon}</span>
              <span>{a.label}</span>
              {config.socialAction===a.key && <span style={{ color, fontWeight:700, marginLeft:'auto' }}>✓</span>}
            </div>
          ))}
        </div>
      </div>
      {config.socialAction && (
        <div>
          <p className="text-xs text-gray-400 mb-1">Details</p>
          <textarea value={config.detail||''} onChange={e => set({ detail: e.target.value })}
            placeholder={`e.g. "Post a short video teaser with the launch date and a CTA link"`}
            rows={3} className="field w-full text-xs" style={{ resize:'none' }} />
        </div>
      )}
    </div>
  );
}

// ─── Payment Config In Panel ──────────────────────────────────────────────────

function PaymentConfigInPanel({ config, onChange, color }) {
  const set = patch => onChange({ ...config, ...patch });

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-gray-400 mb-2">Payment Gateway</p>
        <div className="grid grid-cols-2 gap-1.5">
          {PAYMENT_GATEWAYS.map(g => (
            <div key={g.key} onClick={() => set({ gateway: g.key })}
              className="flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer text-xs transition-all"
              style={{ background: config.gateway===g.key ? `${color}20` : 'rgba(255,255,255,0.03)', border:`1px solid ${config.gateway===g.key ? color+'60' : 'rgba(255,255,255,0.07)'}`, color: config.gateway===g.key ? '#fff' : '#9ca3af' }}>
              <span>{g.icon}</span>
              <span>{g.label}</span>
              {config.gateway===g.key && <span style={{ color, fontWeight:700, marginLeft:'auto' }}>✓</span>}
            </div>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs text-gray-400 mb-2">Action</p>
        <div className="grid grid-cols-1 gap-1">
          {PAYMENT_ACTIONS.map(a => (
            <div key={a.key} onClick={() => set({ paymentAction: a.key })}
              className="flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer text-xs transition-all"
              style={{ background: config.paymentAction===a.key ? `${color}20` : 'rgba(255,255,255,0.03)', border:`1px solid ${config.paymentAction===a.key ? color+'60' : 'rgba(255,255,255,0.07)'}`, color: config.paymentAction===a.key ? '#fff' : '#9ca3af' }}>
              <span>{a.icon}</span>
              <span>{a.label}</span>
              {config.paymentAction===a.key && <span style={{ color, fontWeight:700, marginLeft:'auto' }}>✓</span>}
            </div>
          ))}
        </div>
      </div>
      {config.paymentAction && (
        <div>
          <p className="text-xs text-gray-400 mb-1">Details</p>
          <textarea value={config.detail||''} onChange={e => set({ detail: e.target.value })}
            placeholder={`e.g. "Create a $297 payment link for the coaching program with 30-day trial"`}
            rows={3} className="field w-full text-xs" style={{ resize:'none' }} />
        </div>
      )}
    </div>
  );
}

// ─── Field Mapping Panel ──────────────────────────────────────────────────────

function FieldMappingPanel({ edge, nodes, onClose, onDelete, onSave }) {
  const fromNode = nodes.find(n => n.id === edge.fromNodeId);
  const toNode   = nodes.find(n => n.id === edge.toNodeId);
  const [mappings, setMappings] = useState(edge.mappings || []);
  const [pending,  setPending]  = useState(null); // field being connected from source

  if (!fromNode || !toNode) return null;

  const fromFields = TOOL_FIELDS[fromNode.tool]?.outputs || [];
  const toFields   = TOOL_FIELDS[toNode.tool]?.inputs   || [];

  const fromColor = TOOL_COLOR[fromNode.tool] || '#6366f1';
  const toColor   = TOOL_COLOR[toNode.tool]   || '#6366f1';

  function clickFrom(field) {
    setPending(field);
  }

  function clickTo(field) {
    if (!pending) return;
    // Replace existing mapping to same target or from same source
    const next = mappings.filter(m => m.from !== pending && m.to !== field);
    setMappings([...next, { from: pending, to: field }]);
    setPending(null);
  }

  function removeMapping(m) {
    setMappings(prev => prev.filter(x => !(x.from === m.from && x.to === m.to)));
  }

  function save() {
    onSave(mappings);
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span className="text-sm font-semibold text-white flex-1">Field Mapping</span>
        <button onClick={onDelete} className="text-gray-600 hover:text-red-400 text-xs mr-2">Delete edge</button>
        <button onClick={onClose} className="text-gray-600 hover:text-gray-300 text-sm">×</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center gap-2 mb-3 text-xs text-gray-500">
          <span style={{ color: fromColor }}>{fromNode.icon} {fromNode.label}</span>
          <span>→</span>
          <span style={{ color: toColor }}>{toNode.icon} {toNode.label}</span>
        </div>

        {pending && (
          <div className="mb-3 px-3 py-2 rounded-lg text-xs" style={{ background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)', color: '#fbbf24' }}>
            "{pending}" selected — now click a field on the right to map it →
          </div>
        )}

        {/* Two-column mapping */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          {/* From fields */}
          <div>
            <p className="text-xs font-semibold mb-2" style={{ color: fromColor }}>
              {fromNode.icon} From: {fromNode.label}
            </p>
            <div className="space-y-1">
              {fromFields.map(f => {
                const isMapped  = mappings.some(m => m.from === f);
                const isPending = pending === f;
                return (
                  <button key={f} onClick={() => clickFrom(f)}
                    className="w-full text-left text-xs px-3 py-2 rounded-lg transition-all"
                    style={{
                      background:  isPending ? `${fromColor}30` : isMapped ? `${fromColor}15` : 'rgba(255,255,255,0.03)',
                      border:      `1px solid ${isPending ? fromColor : isMapped ? fromColor+'50' : 'rgba(255,255,255,0.07)'}`,
                      color:       isMapped || isPending ? '#fff' : '#9ca3af',
                    }}>
                    {isMapped && <span style={{ color: fromColor, marginRight: 4 }}>→</span>}
                    {f}
                  </button>
                );
              })}
            </div>
          </div>

          {/* To fields */}
          <div>
            <p className="text-xs font-semibold mb-2" style={{ color: toColor }}>
              {toNode.icon} To: {toNode.label}
            </p>
            <div className="space-y-1">
              {toFields.map(f => {
                const mapping   = mappings.find(m => m.to === f);
                const isMapped  = !!mapping;
                return (
                  <button key={f} onClick={() => clickTo(f)}
                    className="w-full text-left text-xs px-3 py-2 rounded-lg transition-all"
                    style={{
                      background:  isMapped ? `${toColor}15` : pending ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.03)',
                      border:      `1px solid ${isMapped ? toColor+'50' : pending ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.07)'}`,
                      color:       isMapped ? '#fff' : '#9ca3af',
                      cursor:      pending ? 'pointer' : 'default',
                    }}>
                    {isMapped && <span style={{ color: toColor, marginRight: 4 }}>←</span>}
                    {f}
                    {isMapped && <span style={{ color: '#6b7280', marginLeft: 4 }}>({mapping.from})</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Active mappings */}
        {mappings.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 mb-2">Active mappings</p>
            <div className="space-y-1">
              {mappings.map((m, i) => (
                <div key={i} className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  <span style={{ color: fromColor }}>{m.from}</span>
                  <span className="text-gray-600">→</span>
                  <span style={{ color: toColor }}>{m.to}</span>
                  <button onClick={() => removeMapping(m)} className="ml-auto text-gray-600 hover:text-red-400">×</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {mappings.length === 0 && !pending && (
          <p className="text-xs text-gray-600 text-center py-3">Click a field on the left, then click a field on the right to create a mapping.</p>
        )}
      </div>

      <div className="px-4 pb-4 flex-shrink-0">
        <button onClick={save} className="btn-primary w-full py-2 text-sm">Save Mappings</button>
      </div>
    </div>
  );
}
