/**
 * src/routes/emailBuilder.js
 *
 * AI Email Campaign Builder — generates native GHL email templates.
 *
 * Mounts at /email-builder
 *
 * GHL v2 API (OAuth, services.leadconnectorhq.com)
 * Required scope: emails/builder.write
 *
 * POST /email-builder/generate   — SSE: AI generates email → creates GHL template
 * GET  /email-builder/list       — list email templates for this location
 *
 * Two-step save:
 *   1. POST /emails/builder          → creates shell, returns templateId
 *   2. POST /emails/builder/data     → saves MJML-based dnd + rendered html
 */

require('dotenv').config();

const express      = require('express');
const router       = express.Router();
const authenticate = require('../middleware/authenticate');
const aiService    = require('../services/aiService');
const ghlClient    = require('../services/ghlClient');

router.use(authenticate);

// ─── JSON parse helper ────────────────────────────────────────────────────────

function parseJsonSafe(raw) {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end   = cleaned.lastIndexOf('}');
  const slice = (start !== -1 && end > start) ? cleaned.slice(start, end + 1) : cleaned;
  try { return JSON.parse(slice); } catch {
    try {
      const { jsonrepair } = require('jsonrepair');
      return JSON.parse(jsonrepair(slice));
    } catch {
      throw new Error(`AI returned non-JSON: ${raw.slice(0, 120)}`);
    }
  }
}

// ─── Render HTML fallback (used for the html field in /emails/builder/data) ───

function renderEmailHtml(c, colors) {
  const { primaryColor = '#4f46e5', bgColor = '#ffffff', textColor = '#111827' } = colors;
  const painHtml = (c.painPoints || []).map(p =>
    `<li style="margin:0 0 8px;font-size:15px;color:${textColor};line-height:1.6;">${p}</li>`).join('');
  const benefitHtml = (c.benefits || []).map(b =>
    `<li style="margin:0 0 8px;font-size:15px;color:${textColor};line-height:1.6;"><strong>${b.split(':')[0]}</strong>${b.includes(':') ? ': ' + b.split(':').slice(1).join(':') : ''}</li>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${c.subject || ''}</title></head>
<body style="margin:0;padding:0;background:${bgColor};font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:${primaryColor};">
  <tr><td style="padding:48px 40px 40px;text-align:center;">
    <p style="margin:0 0 8px;font-size:13px;font-weight:600;letter-spacing:2px;color:rgba(255,255,255,0.7);text-transform:uppercase;">${c.preheadLabel || ''}</p>
    <h1 style="margin:0 0 16px;font-size:34px;font-weight:bold;line-height:1.2;color:#fff;">${c.headline || ''}</h1>
    <p style="margin:0;font-size:17px;line-height:1.6;color:rgba(255,255,255,0.88);">${c.subheadline || ''}</p>
  </td></tr>
</table>
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:${bgColor};">
  <tr><td style="padding:36px 40px 10px;">
    <p style="margin:0 0 16px;font-size:20px;font-weight:bold;color:${textColor};line-height:1.4;">${c.hook || ''}</p>
    <p style="margin:0;font-size:15px;line-height:1.8;color:${textColor};">${c.openingPara || ''}</p>
  </td></tr>
  ${painHtml ? `<tr><td style="padding:10px 40px 24px;">
    <p style="margin:0 0 12px;font-size:16px;font-weight:bold;color:${textColor};">Sound familiar?</p>
    <ul style="margin:0;padding-left:20px;">${painHtml}</ul>
  </td></tr>` : ''}
  <tr><td style="padding:10px 40px 24px;">
    <p style="margin:0;font-size:15px;line-height:1.8;color:${textColor};">${c.transitionText || ''}</p>
  </td></tr>
  <tr><td style="padding:0 40px 24px;">
    <p style="margin:0;font-size:15px;line-height:1.8;color:${textColor};">${c.solutionPara || ''}</p>
  </td></tr>
  ${benefitHtml ? `<tr><td style="padding:0 40px 24px;">
    <p style="margin:0 0 12px;font-size:16px;font-weight:bold;color:${textColor};">Here's what you get:</p>
    <ul style="margin:0;padding-left:20px;">${benefitHtml}</ul>
  </td></tr>` : ''}
  <tr><td style="padding:0 40px 10px;">
    <p style="margin:0;font-size:15px;line-height:1.8;color:${textColor};">${c.closingPara || ''}</p>
  </td></tr>
  <tr><td style="padding:24px 40px 8px;text-align:center;">
    <a href="${c.ctaUrl || '#'}" style="display:inline-block;background:${primaryColor};color:#fff;font-size:17px;font-weight:bold;text-decoration:none;padding:16px 44px;border-radius:8px;">${c.ctaText || 'Get Started'}</a>
    ${c.ctaSubtext ? `<p style="margin:12px 0 0;font-size:13px;color:#6b7280;">${c.ctaSubtext}</p>` : ''}
  </td></tr>
  <tr><td style="padding:32px 40px 24px;border-top:1px solid #e5e7eb;margin-top:32px;">
    <p style="margin:0;font-size:13px;color:#9ca3af;text-align:center;line-height:1.6;">
      ${c.footer || ''}<br><a href="{{unsubscribe_link}}" style="color:#9ca3af;">Unsubscribe</a>
    </p>
  </td></tr>
</table></td></tr></table>
</body></html>`;
}

// ─── GHL Native MJML DND builder ──────────────────────────────────────────────

function mkId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
function sectionNode(id, children) { return { id, tagName: 'mj-section', children }; }
function columnNode(id, children)  { return { id, tagName: 'mj-column', children }; }
function leafNode(id, tagName)     { return { id, tagName }; }

function sectionAttrs(bgColor, paddingTop = 24, paddingBottom = 24, title = '', desc = '') {
  return {
    tagName: 'mj-section',
    attributes: [
      { name: 'data-section-title', default: title },
      { name: 'data-section-description', default: desc },
      { name: 'background-color', default: bgColor },
      { name: 'padding-top',    default: paddingTop,    unit: 'px' },
      { name: 'padding-bottom', default: paddingBottom, unit: 'px' },
      { name: 'padding-left',   default: 20, unit: 'px' },
      { name: 'padding-right',  default: 20, unit: 'px' },
      { name: 'enable-padding', default: true },
      { name: 'background-url', default: '' },
      { name: 'background-size', default: '' },
      { name: 'background-repeat', default: '' },
      { name: 'background-position', default: '' },
      { name: 'text-align', default: 'center' },
      { name: 'direction',  default: 'ltr' },
      { name: 'border-radius', default: 0, unit: 'px' },
      { name: 'full-width', default: false },
    ],
    customFlags: { layoutId: 1 },
  };
}
function columnAttrs() {
  return {
    tagName: 'mj-column',
    attributes: [
      { name: 'width', default: 100, unit: '%' },
      { name: 'enable-padding', default: true },
      { name: 'padding-top',    default: 0, unit: 'px' },
      { name: 'padding-bottom', default: 0, unit: 'px' },
      { name: 'padding-left',   default: 0, unit: 'px' },
      { name: 'padding-right',  default: 0, unit: 'px' },
      { name: 'background-color', default: '' },
      { name: 'border-radius',    default: 0, unit: 'px' },
      { name: 'vertical-align',   default: 'top' },
    ],
  };
}
function textAttrs(html, { align = 'left', fontSize = 15, pt = 12, pb = 12, pl = 32, pr = 32 } = {}) {
  return {
    tagName: 'mj-text',
    attributes: [
      { name: 'align',          default: align },
      { name: 'enable-padding', default: true },
      { name: 'padding-top',    default: pt,  unit: 'px' },
      { name: 'padding-bottom', default: pb,  unit: 'px' },
      { name: 'padding-left',   default: pl,  unit: 'px' },
      { name: 'padding-right',  default: pr,  unit: 'px' },
      { name: 'line-height',    default: 1.6 },
      { name: 'font-family',    default: 'Arial, Helvetica, sans-serif' },
      { name: 'font-size',      default: fontSize, unit: 'px' },
      { name: 'height',         default: null, unit: 'px' },
      { name: 'container-background-color', default: '' },
    ],
    content: html,
  };
}
function buttonAttrs(label, href, bgColor = '#4f46e5', color = '#FFFFFF') {
  return {
    tagName: 'mj-button',
    attributes: [
      { name: 'href',   default: href || '#' },
      { name: 'align',  default: 'center' },
      { name: 'background-color', default: bgColor },
      { name: 'color',  default: color },
      { name: 'border-radius', default: 8, unit: 'px' },
      { name: 'border-top-left-radius',     default: 8, unit: 'px' },
      { name: 'border-top-right-radius',    default: 8, unit: 'px' },
      { name: 'border-bottom-left-radius',  default: 8, unit: 'px' },
      { name: 'border-bottom-right-radius', default: 8, unit: 'px' },
      { name: 'inner-padding', default: '18px 48px' },
      { name: 'font-size',   default: 17, unit: 'px' },
      { name: 'font-weight', default: 700 },
      { name: 'enable-padding', default: true },
      { name: 'padding-top',    default: 10, unit: 'px' },
      { name: 'padding-bottom', default: 10, unit: 'px' },
      { name: 'padding-left',   default: 20, unit: 'px' },
      { name: 'padding-right',  default: 20, unit: 'px' },
      { name: 'width', default: '' },
      { name: 'font-family', default: 'Ubuntu, Helvetica, Arial, sans-serif' },
      { name: 'action', default: 'url' },
      { name: 'url', default: href || '' },
    ],
    content: label,
  };
}

function buildMjmlDnd(c, colors) {
  const { primaryColor = '#4f46e5', bgColor = '#ffffff', textColor = '#111827' } = colors;
  const painPoints = c.painPoints || [];
  const benefits   = c.benefits   || [];

  // ─ IDs ─
  const preSecId   = mkId('mj-section'), preColId   = mkId('mj-column'), preTxtId   = mkId('mj-text');
  const heroSecId  = mkId('mj-section'), heroColId  = mkId('mj-column');
  const heroLabelId = mkId('mj-text'), heroH1Id = mkId('mj-text'), heroSubId = mkId('mj-text');
  const hookSecId  = mkId('mj-section'), hookColId  = mkId('mj-column');
  const hookTxtId  = mkId('mj-text'), openTxtId = mkId('mj-text');
  const painSecId  = mkId('mj-section'), painColId  = mkId('mj-column');
  const painHdrId  = mkId('mj-text'),  painListId = mkId('mj-text');
  const tranSecId  = mkId('mj-section'), tranColId  = mkId('mj-column'), tranTxtId  = mkId('mj-text');
  const solSecId   = mkId('mj-section'), solColId   = mkId('mj-column'), solTxtId   = mkId('mj-text');
  const benSecId   = mkId('mj-section'), benColId   = mkId('mj-column');
  const benHdrId   = mkId('mj-text'),  benListId  = mkId('mj-text');
  const closeSecId = mkId('mj-section'), closeColId = mkId('mj-column'), closeTxtId = mkId('mj-text');
  const ctaSecId   = mkId('mj-section'), ctaColId   = mkId('mj-column');
  const ctaBtnId   = mkId('mj-button'), ctaSubId   = mkId('mj-text');
  const footSecId  = mkId('mj-section'), footColId  = mkId('mj-column'), footTxtId  = mkId('mj-text');

  // ─ Tree ─
  const elements = [
    sectionNode(preSecId,  [columnNode(preColId,  [leafNode(preTxtId, 'mj-text')])]),
    sectionNode(heroSecId, [columnNode(heroColId, [
      leafNode(heroLabelId, 'mj-text'),
      leafNode(heroH1Id,    'mj-text'),
      leafNode(heroSubId,   'mj-text'),
    ])]),
    sectionNode(hookSecId, [columnNode(hookColId, [
      leafNode(hookTxtId,  'mj-text'),
      leafNode(openTxtId,  'mj-text'),
    ])]),
    sectionNode(painSecId, [columnNode(painColId, [
      leafNode(painHdrId,  'mj-text'),
      leafNode(painListId, 'mj-text'),
    ])]),
    sectionNode(tranSecId, [columnNode(tranColId, [leafNode(tranTxtId, 'mj-text')])]),
    sectionNode(solSecId,  [columnNode(solColId,  [leafNode(solTxtId,  'mj-text')])]),
    sectionNode(benSecId,  [columnNode(benColId,  [
      leafNode(benHdrId,  'mj-text'),
      leafNode(benListId, 'mj-text'),
    ])]),
    sectionNode(closeSecId,[columnNode(closeColId,[leafNode(closeTxtId,'mj-text')])]),
    sectionNode(ctaSecId,  [columnNode(ctaColId,  [
      leafNode(ctaBtnId, 'mj-button'),
      leafNode(ctaSubId, 'mj-text'),
    ])]),
    sectionNode(footSecId, [columnNode(footColId, [leafNode(footTxtId, 'mj-text')])]),
  ];

  // ─ Bullet HTML helpers ─
  const painBullets = painPoints.map(p =>
    `<p style="margin:0 0 10px;padding-left:20px;position:relative;font-size:15px;line-height:1.7;color:${textColor};"><span style="position:absolute;left:0;">❌</span>${p}</p>`
  ).join('');
  const benefitBullets = benefits.map(b => {
    const [title, ...rest] = b.split(':');
    return `<p style="margin:0 0 10px;padding-left:20px;position:relative;font-size:15px;line-height:1.7;color:${textColor};"><span style="position:absolute;left:0;">✅</span><strong>${title}</strong>${rest.length ? ': ' + rest.join(':') : ''}</p>`;
  }).join('');

  // ─ Attrs ─
  const attrs = {
    // Preheader
    [preSecId]: sectionAttrs('#f3f4f6', 8, 8, 'Preheader', ''),
    [preColId]: columnAttrs(),
    [preTxtId]: textAttrs(
      `<p style="margin:0;text-align:center;font-size:12px;color:#6b7280;">${c.previewText || ''}</p>`,
      { align: 'center', fontSize: 12, pt: 8, pb: 8, pl: 20, pr: 20 }
    ),

    // Hero (primary color bg)
    [heroSecId]:   sectionAttrs(primaryColor, 48, 40, 'Hero', 'Main headline'),
    [heroColId]:   columnAttrs(),
    [heroLabelId]: textAttrs(
      `<p style="margin:0;font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.65);">${c.preheadLabel || c.brandName || ''}</p>`,
      { align: 'center', fontSize: 12, pt: 0, pb: 10, pl: 32, pr: 32 }
    ),
    [heroH1Id]: textAttrs(
      `<h1 style="margin:0 0 16px;font-size:34px;font-weight:bold;line-height:1.2;color:#ffffff;">${(c.headline || '').replace(/\*\*/g, '')}</h1>`,
      { align: 'center', fontSize: 34, pt: 0, pb: 0, pl: 32, pr: 32 }
    ),
    [heroSubId]: textAttrs(
      `<p style="margin:0;font-size:17px;line-height:1.6;color:rgba(255,255,255,0.88);">${c.subheadline || ''}</p>`,
      { align: 'center', fontSize: 17, pt: 14, pb: 0, pl: 32, pr: 32 }
    ),

    // Hook + opening paragraph
    [hookSecId]: sectionAttrs(bgColor, 36, 8, 'Hook', ''),
    [hookColId]: columnAttrs(),
    [hookTxtId]: textAttrs(
      `<p style="margin:0;font-size:20px;font-weight:bold;line-height:1.4;color:${textColor};">${c.hook || ''}</p>`,
      { align: 'left', fontSize: 20, pt: 0, pb: 16, pl: 32, pr: 32 }
    ),
    [openTxtId]: textAttrs(
      `<p style="margin:0;font-size:15px;line-height:1.8;color:${textColor};">${c.openingPara || ''}</p>`,
      { align: 'left', fontSize: 15, pt: 0, pb: 0, pl: 32, pr: 32 }
    ),

    // Pain points
    [painSecId]: sectionAttrs('#fff8f8', 28, 24, 'Pain Points', ''),
    [painColId]: columnAttrs(),
    [painHdrId]: textAttrs(
      `<p style="margin:0;font-size:16px;font-weight:bold;color:${textColor};">Sound familiar? You're probably dealing with...</p>`,
      { align: 'left', fontSize: 16, pt: 0, pb: 16, pl: 32, pr: 32 }
    ),
    [painListId]: textAttrs(
      painBullets || `<p style="margin:0;color:${textColor};">Common challenges that hold you back.</p>`,
      { align: 'left', fontSize: 15, pt: 0, pb: 0, pl: 32, pr: 32 }
    ),

    // Transition
    [tranSecId]: sectionAttrs(bgColor, 28, 8, 'Transition', ''),
    [tranColId]: columnAttrs(),
    [tranTxtId]: textAttrs(
      `<p style="margin:0;font-size:15px;font-style:italic;line-height:1.8;color:#4b5563;">${c.transitionText || ''}</p>`,
      { align: 'left', fontSize: 15, pt: 0, pb: 0, pl: 32, pr: 32 }
    ),

    // Solution
    [solSecId]: sectionAttrs(bgColor, 20, 8, 'Solution', ''),
    [solColId]: columnAttrs(),
    [solTxtId]: textAttrs(
      `<p style="margin:0;font-size:15px;line-height:1.8;color:${textColor};">${c.solutionPara || ''}</p>`,
      { align: 'left', fontSize: 15, pt: 0, pb: 0, pl: 32, pr: 32 }
    ),

    // Benefits
    [benSecId]: sectionAttrs('#f0fdf4', 28, 24, 'Benefits', ''),
    [benColId]: columnAttrs(),
    [benHdrId]: textAttrs(
      `<p style="margin:0;font-size:16px;font-weight:bold;color:${textColor};">Here's exactly what you get:</p>`,
      { align: 'left', fontSize: 16, pt: 0, pb: 16, pl: 32, pr: 32 }
    ),
    [benListId]: textAttrs(
      benefitBullets || `<p style="margin:0;color:${textColor};">Everything you need to succeed.</p>`,
      { align: 'left', fontSize: 15, pt: 0, pb: 0, pl: 32, pr: 32 }
    ),

    // Closing paragraph
    [closeSecId]: sectionAttrs(bgColor, 28, 8, 'Closing', ''),
    [closeColId]: columnAttrs(),
    [closeTxtId]: textAttrs(
      `<p style="margin:0;font-size:15px;line-height:1.8;color:${textColor};">${c.closingPara || ''}</p>`,
      { align: 'left', fontSize: 15, pt: 0, pb: 0, pl: 32, pr: 32 }
    ),

    // CTA
    [ctaSecId]: sectionAttrs('#f3f4f6', 36, 36, 'CTA', ''),
    [ctaColId]: columnAttrs(),
    [ctaBtnId]: buttonAttrs(c.ctaText || 'Get Started', c.ctaUrl || '#', primaryColor, '#ffffff'),
    [ctaSubId]: textAttrs(
      `<p style="margin:0;font-size:13px;color:#6b7280;text-align:center;">${c.ctaSubtext || ''}</p>`,
      { align: 'center', fontSize: 13, pt: 12, pb: 0, pl: 24, pr: 24 }
    ),

    // Footer
    [footSecId]: sectionAttrs('#f9fafb', 24, 24, 'Footer', ''),
    [footColId]: columnAttrs(),
    [footTxtId]: textAttrs(
      `<p style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af;text-align:center;">${c.footer || ''}<br><a href="{{unsubscribe_link}}" style="color:#9ca3af;">Unsubscribe</a></p>`,
      { align: 'center', fontSize: 12, pt: 10, pb: 10, pl: 20, pr: 20 }
    ),
  };

  return { elements, attrs, templateSettings: {} };
}

// ─── AI: generate email content ───────────────────────────────────────────────

const EMAIL_TYPE_CONTEXT = {
  welcome:      'Welcome email — warm, celebratory, feels like a message from a friend, sets expectations, delivers immediate value',
  promotional:  'Promotional/offer email — creates desire not urgency, leads with value, makes the offer feel obvious',
  newsletter:   'Newsletter — teaches something genuinely useful, builds trust, soft CTA that feels natural',
  followup:     'Follow-up — picks up a conversation, acknowledges they haven\'t responded, removes friction and objection',
  reengagement: 'Re-engagement — acknowledges the gap, brings something new and valuable, makes coming back feel easy',
  announcement: 'Announcement — big news told with energy, makes the reader feel part of something exciting',
};

async function generateEmailContent(brief) {
  const { campaignName, subject, emailType, niche, offer, audience, tone, ctaText, ctaUrl, brandName, brainContext, brainName } = brief;
  const typeCtx = EMAIL_TYPE_CONTEXT[emailType] || EMAIL_TYPE_CONTEXT.promotional;

  const brainBlock = brainContext ? `\n\nKNOWLEDGE BASE — "${brainName || 'Brand Brain'}"\nYou MUST base all copy, messaging, voice, pain points, benefits, and claims on the following brand knowledge. Do NOT invent facts, testimonials, or product details that contradict or go beyond this information:\n\n${brainContext}\n\n---` : '';

  const system = `You are a direct-response email copywriter with 15+ years of experience writing emails that generate millions in revenue. You write like a human, not a brand. Your emails feel personal, honest, and insightful — never salesy or corporate. You understand buyer psychology deeply: you lead with pain, build empathy, then present the solution as the obvious next step.

Your emails always have:
- A scroll-stopping hook that makes the reader think "this is about me"
- Specific pain points that make readers feel understood
- A clear, logical bridge from problem to solution
- Benefits written as outcomes, not features
- A CTA that feels inevitable, not pushy
${brainContext ? '\nIMPORTANT: A knowledge base has been provided. Every claim, pain point, benefit, and product detail MUST match what is documented in the knowledge base. Accuracy to the brand\'s documented information is non-negotiable.' : ''}
Return only valid JSON — no markdown, no extra text.`;

  const user = `Write a full direct-response email for this campaign. Make it feel human, personal, and specific — not generic.${brainBlock}

Campaign: ${campaignName}
Email Type: ${typeCtx}
Niche/Industry: ${niche}
Offer/Product: ${offer || 'their main product or service'}
Target Audience: ${audience || 'ideal customers'}
Tone: ${tone || 'conversational and direct — like a trusted advisor, not a salesperson'}
Brand: ${brandName || 'the business'}
CTA: "${ctaText || 'Get Started'}" → ${ctaUrl || '#'}

Writing rules:
- Hook: 1 bold punchy sentence that calls out the reader's exact situation. No "Hi" or "I hope this finds you well". Start with something they feel immediately.
- Opening paragraph: 2-3 sentences of empathy and context. Make them nod their head.
- Pain points: 3-5 specific, tangible pains this audience actually feels. Be precise. Use their language.
- Transition: 1-2 sentences that pivot from "here's the problem" to "here's what changed for others"
- Solution paragraph: 2-3 sentences explaining the offer as a solution — no fluff, no hype
- Benefits: 4-6 concrete outcomes. Format as "Outcome: brief explanation". Focus on transformation, not features.
- Closing paragraph: 1-2 sentences creating natural urgency or a final emotional nudge. No fake scarcity.
- CTA text: Action-oriented and specific. Not just "Click here". Something they want to do.
- CTA subtext: A short trust line (guarantee, social proof number, or risk reducer)
- Subject: 6-9 words, curiosity-driven or calls out the pain. No emojis. No all-caps.
- Preview text: 80-100 chars that expand on the subject and pull them in

Return this exact JSON structure:
{
  "subject": "subject line",
  "previewText": "80-100 char preview text",
  "brandName": "${brandName || niche}",
  "preheadLabel": "short category label e.g. 'For ${audience || 'Business Owners'}' or the brand name",
  "headline": "Bold headline — the big promise or transformation (NO asterisks/markdown)",
  "subheadline": "One sentence that adds specificity or credibility to the headline",
  "hook": "The opening hook sentence — the one that stops the scroll. Call out their exact situation.",
  "openingPara": "2-3 sentence empathy paragraph. No line breaks, just one flowing block.",
  "painPoints": [
    "Specific pain point 1 — be precise, use their language",
    "Specific pain point 2",
    "Specific pain point 3",
    "Specific pain point 4"
  ],
  "transitionText": "1-2 sentence bridge from pain to solution. Empathetic, not dismissive.",
  "solutionPara": "2-3 sentences on how the offer solves the above. Specific. No hype words like 'revolutionary' or 'game-changing'.",
  "benefits": [
    "Outcome title: brief specific explanation of what they gain",
    "Outcome title: brief specific explanation",
    "Outcome title: brief specific explanation",
    "Outcome title: brief specific explanation",
    "Outcome title: brief specific explanation"
  ],
  "closingPara": "1-2 sentences — final emotional nudge or natural urgency. Don't say 'limited time offer'.",
  "ctaText": "${ctaText || 'specific action-oriented CTA'}",
  "ctaUrl": "${ctaUrl || '#'}",
  "ctaSubtext": "Short trust line — guarantee, proof, or risk reducer",
  "footer": "1 sentence — warm sign-off or brand tagline",
  "suggestedColors": {
    "primaryColor": "#hex that fits this niche and tone",
    "bgColor": "#ffffff",
    "textColor": "#1a1a2e"
  }
}`;

  const raw = await aiService.generateForLocation(brief.locationId, system, user, { maxTokens: 2000 });
  return parseJsonSafe(raw);
}

// ─── POST /email-builder/generate ────────────────────────────────────────────

router.post('/generate', async (req, res) => {
  const {
    campaignName = 'New Email Campaign',
    subject      = '',
    emailType    = 'promotional',
    niche        = '',
    offer        = '',
    audience     = '',
    tone         = 'conversational and direct',
    ctaText      = 'Get Started',
    ctaUrl       = '',
    brandName    = '',
    brainContext = '',
    brainName    = '',
  } = req.body;

  if (!niche && !subject) {
    return res.status(400).json({ success: false, error: 'Provide at least a niche or subject.' });
  }

  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    send('step', { step: 1, total: 3, label: 'Writing email copy with AI…' });

    const content = await generateEmailContent({ campaignName, subject, emailType, niche, offer, audience, tone, ctaText, ctaUrl, brandName, brainContext, brainName, locationId: req.locationId });
    send('content', content);
    send('step', { step: 2, total: 3, label: 'Building native GHL email template…' });

    const colors = content.suggestedColors || { primaryColor: '#4f46e5', bgColor: '#ffffff', textColor: '#1a1a2e' };
    const dnd    = buildMjmlDnd(content, colors);
    const html   = renderEmailHtml(content, colors);

    send('step', { step: 3, total: 3, label: 'Saving to GHL email builder…' });

    // Step 3a: create shell
    let emailId = null;
    try {
      const shell = await ghlClient.ghlRequest(req.locationId, 'POST', '/emails/builder', {
        locationId: req.locationId,
        type:       'builder',
        title:      campaignName,
        name:       campaignName,
        builderVersion: '2',
      });
      emailId = shell?.id || shell?.templateId || shell?._id || null;
    } catch (e) {
      const is401 = e.message.includes('401');
      send('error', { error: is401 ? 'Missing scope: emails/builder.write. Reinstall the app.' : `GHL error: ${e.message}`, needsReinstall: is401 });
      send('done', { success: false, content, needsReinstall: is401 });
      return res.end();
    }

    if (!emailId) {
      send('error', { error: 'GHL returned no template ID.' });
      send('done', { success: false, content });
      return res.end();
    }

    // Step 3b: save dnd content
    try {
      await ghlClient.ghlRequest(req.locationId, 'POST', '/emails/builder/data', {
        locationId:  req.locationId,
        templateId:  emailId,
        updatedBy:   req.locationId,
        editorType:  'builder',
        dnd,
        html,
        previewText: content.previewText || '',
      });
    } catch (e) {
      console.error('[EmailBuilder] data save error (non-fatal):', e.message);
      send('warn', { message: `Template created but content may not have saved: ${e.message}` });
    }

    const editUrl = `https://app.gohighlevel.com/v2/location/${req.locationId}/marketing/email-marketing/email-builder/${emailId}`;
    send('done', { success: true, emailId, editUrl, subject: content.subject, content });

  } catch (err) {
    console.error('[EmailBuilder] error:', err.message);
    send('error', { error: err.message });
  }

  res.end();
});

// ─── GET /email-builder/list ──────────────────────────────────────────────────

router.get('/list', async (req, res) => {
  try {
    const data = await ghlClient.ghlRequest(req.locationId, 'GET', '/emails/builder', null, { locationId: req.locationId, limit: 20, skip: 0 });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
