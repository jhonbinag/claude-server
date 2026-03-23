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

// ─── Render plain HTML for the html field in /emails/builder/data ─────────────

function renderEmailHtml(content, colors) {
  const { primaryColor = '#4f46e5', bgColor = '#ffffff', textColor = '#111827' } = colors;
  const bodyParas = (content.body || '').split('\n').filter(Boolean)
    .map(p => `<p style="color:${textColor};font-size:15px;line-height:1.7;margin:0 0 14px 0;">${p}</p>`).join('');
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${content.subject || ''}</title></head>
<body style="margin:0;padding:0;background:${bgColor};font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:${bgColor};">
  <tr><td style="padding:30px 40px 10px;">
    <h1 style="color:${textColor};font-size:32px;font-weight:bold;line-height:1.2;margin:0 0 12px 0;">${content.headline || ''}</h1>
    <p style="color:#6b7280;font-size:16px;line-height:1.6;margin:0;">${content.subheadline || ''}</p>
  </td></tr>
  <tr><td style="padding:10px 40px;">${bodyParas}</td></tr>
  <tr><td style="padding:20px 40px 30px;text-align:center;">
    <a href="${content.ctaUrl || '#'}" style="display:inline-block;background:${primaryColor};color:#fff;font-size:16px;font-weight:bold;text-decoration:none;padding:14px 40px;border-radius:8px;">${content.ctaText || 'Get Started'}</a>
  </td></tr>
  <tr><td style="padding:20px 40px;background:#f9fafb;border-top:1px solid #e5e7eb;">
    <p style="color:#9ca3af;font-size:12px;text-align:center;line-height:1.6;margin:0;">
      ${content.footer || ''}<br><a href="{{unsubscribe_link}}" style="color:#9ca3af;">Unsubscribe</a>
    </p>
  </td></tr>
</table></td></tr></table>
</body></html>`;
}

// ─── GHL Native MJML DND builder ──────────────────────────────────────────────
// GHL email builder uses MJML-style elements (mj-section → mj-column → mj-text/mj-button).
// dnd.elements = tree of {id, tagName, children[]}
// dnd.attrs    = flat map keyed by id, value = {tagName, attributes[], content?}

function mkId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function sectionNode(id, children) {
  return { id, tagName: 'mj-section', children };
}
function columnNode(id, children) {
  return { id, tagName: 'mj-column', children };
}
function leafNode(id, tagName) {
  return { id, tagName };
}

function sectionAttrs(bgColor, paddingTop = 24, paddingBottom = 24, title = '', desc = '') {
  return {
    tagName: 'mj-section',
    attributes: [
      { name: 'data-section-title', default: title },
      { name: 'data-section-description', default: desc },
      { name: 'background-color', default: bgColor },
      { name: 'padding-top', default: paddingTop, unit: 'px' },
      { name: 'padding-bottom', default: paddingBottom, unit: 'px' },
      { name: 'padding-left', default: 20, unit: 'px' },
      { name: 'padding-right', default: 20, unit: 'px' },
      { name: 'enable-padding', default: true },
      { name: 'background-url', default: '' },
      { name: 'background-size', default: '' },
      { name: 'background-repeat', default: '' },
      { name: 'background-position', default: '' },
      { name: 'text-align', default: 'center' },
      { name: 'direction', default: 'ltr' },
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
      { name: 'padding-top', default: 0, unit: 'px' },
      { name: 'padding-bottom', default: 0, unit: 'px' },
      { name: 'padding-left', default: 0, unit: 'px' },
      { name: 'padding-right', default: 0, unit: 'px' },
      { name: 'background-color', default: '' },
      { name: 'border-radius', default: 0, unit: 'px' },
      { name: 'vertical-align', default: 'top' },
    ],
  };
}

function textAttrs(html, { align = 'center', fontSize = 14, pt = 12, pb = 12, pl = 24, pr = 24 } = {}) {
  return {
    tagName: 'mj-text',
    attributes: [
      { name: 'align', default: align },
      { name: 'enable-padding', default: true },
      { name: 'padding-top', default: pt, unit: 'px' },
      { name: 'padding-bottom', default: pb, unit: 'px' },
      { name: 'padding-left', default: pl, unit: 'px' },
      { name: 'padding-right', default: pr, unit: 'px' },
      { name: 'line-height', default: 1.5 },
      { name: 'font-family', default: 'Arial, Helvetica, sans-serif' },
      { name: 'font-size', default: fontSize, unit: 'px' },
      { name: 'height', default: null, unit: 'px' },
      { name: 'container-background-color', default: '' },
    ],
    content: html,
  };
}

function buttonAttrs(label, href, bgColor = '#4f46e5', color = '#FFFFFF') {
  return {
    tagName: 'mj-button',
    attributes: [
      { name: 'href', default: href || '#' },
      { name: 'align', default: 'center' },
      { name: 'background-color', default: bgColor },
      { name: 'color', default: color },
      { name: 'border-radius', default: 8, unit: 'px' },
      { name: 'border-top-left-radius', default: 8, unit: 'px' },
      { name: 'border-top-right-radius', default: 8, unit: 'px' },
      { name: 'border-bottom-left-radius', default: 8, unit: 'px' },
      { name: 'border-bottom-right-radius', default: 8, unit: 'px' },
      { name: 'inner-padding', default: '16px 40px' },
      { name: 'font-size', default: 16, unit: 'px' },
      { name: 'font-weight', default: 600 },
      { name: 'enable-padding', default: true },
      { name: 'padding-top', default: 10, unit: 'px' },
      { name: 'padding-bottom', default: 10, unit: 'px' },
      { name: 'padding-left', default: 20, unit: 'px' },
      { name: 'padding-right', default: 20, unit: 'px' },
      { name: 'width', default: '' },
      { name: 'font-family', default: 'Ubuntu, Helvetica, Arial, sans-serif' },
      { name: 'action', default: 'url' },
      { name: 'url', default: href || '' },
    ],
    content: label,
  };
}

function buildMjmlDnd(content, colors) {
  const { primaryColor = '#4f46e5', bgColor = '#ffffff', textColor = '#111827' } = colors;
  const bodyParas = (content.body || '').split('\n').filter(Boolean);

  // — IDs —
  const preSecId  = mkId('mj-section'), preColId  = mkId('mj-column'), preTxtId  = mkId('mj-text');
  const heroSecId = mkId('mj-section'), heroColId = mkId('mj-column');
  const heroH1Id  = mkId('mj-text'),   heroSubId  = mkId('mj-text'),   heroBtnId = mkId('mj-button');
  const bodySecId = mkId('mj-section'), bodyColId = mkId('mj-column');
  const bodyParaIds = bodyParas.map(() => mkId('mj-text'));
  const ctaSecId  = mkId('mj-section'), ctaColId  = mkId('mj-column'), ctaBtnId  = mkId('mj-button');
  const footSecId = mkId('mj-section'), footColId = mkId('mj-column'), footTxtId = mkId('mj-text');

  // — Tree —
  const elements = [
    sectionNode(preSecId, [
      columnNode(preColId, [leafNode(preTxtId, 'mj-text')]),
    ]),
    sectionNode(heroSecId, [
      columnNode(heroColId, [
        leafNode(heroH1Id,  'mj-text'),
        leafNode(heroSubId, 'mj-text'),
        leafNode(heroBtnId, 'mj-button'),
      ]),
    ]),
    sectionNode(bodySecId, [
      columnNode(bodyColId, bodyParaIds.map(id => leafNode(id, 'mj-text'))),
    ]),
    sectionNode(ctaSecId, [
      columnNode(ctaColId, [leafNode(ctaBtnId, 'mj-button')]),
    ]),
    sectionNode(footSecId, [
      columnNode(footColId, [leafNode(footTxtId, 'mj-text')]),
    ]),
  ];

  // — Attrs map —
  const attrs = {
    // Preheader
    [preSecId]:  sectionAttrs('#f9fafb', 10, 10, 'Preheader', 'Preview text shown in inbox'),
    [preColId]:  columnAttrs(),
    [preTxtId]:  textAttrs(
      `<p style="margin:0;text-align:center;"><span style="font-family:Arial,sans-serif;font-size:12px;color:#6b7280;">${content.previewText || ''}</span></p>`,
      { align: 'center', fontSize: 12, pt: 10, pb: 10 }
    ),

    // Hero
    [heroSecId]: sectionAttrs(primaryColor, 50, 50, 'Hero', 'Main headline and CTA'),
    [heroColId]: columnAttrs(),
    [heroH1Id]:  textAttrs(
      `<h1 style="margin:0;text-align:center;"><span style="font-family:Arial,sans-serif;font-size:36px;font-weight:bold;line-height:1.2;color:#ffffff;">${(content.headline || '').replace(/\*\*/g, '')}</span></h1>`,
      { align: 'center', fontSize: 36, pt: 16, pb: 8 }
    ),
    [heroSubId]: textAttrs(
      `<p style="margin:0;text-align:center;"><span style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:rgba(255,255,255,0.9);">${content.subheadline || ''}</span></p>`,
      { align: 'center', fontSize: 16, pt: 8, pb: 24 }
    ),
    [heroBtnId]: buttonAttrs(content.ctaText || 'Get Started', content.ctaUrl || '#', '#ffffff', primaryColor),

    // Body
    [bodySecId]: sectionAttrs(bgColor, 40, 40, 'Body', 'Email body content'),
    [bodyColId]: columnAttrs(),
    ...Object.fromEntries(bodyParaIds.map((id, i) => [
      id,
      textAttrs(
        `<p style="margin:0;"><span style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:${textColor};">${bodyParas[i]}</span></p>`,
        { align: 'left', fontSize: 15, pt: i === 0 ? 0 : 14, pb: 14, pl: 32, pr: 32 }
      ),
    ])),

    // CTA section
    [ctaSecId]:  sectionAttrs('#f3f4f6', 40, 40, 'Call to Action', ''),
    [ctaColId]:  columnAttrs(),
    [ctaBtnId]:  buttonAttrs(content.ctaText || 'Get Started', content.ctaUrl || '#', primaryColor, '#ffffff'),

    // Footer
    [footSecId]: sectionAttrs('#f9fafb', 20, 20, 'Footer', 'Unsubscribe and legal'),
    [footColId]: columnAttrs(),
    [footTxtId]: textAttrs(
      `<p style="margin:0;text-align:center;"><span style="font-family:Arial,sans-serif;font-size:12px;line-height:1.6;color:#9ca3af;">${content.footer || ''}<br><a href="{{unsubscribe_link}}" style="color:#9ca3af;">Unsubscribe</a></span></p>`,
      { align: 'center', fontSize: 12, pt: 10, pb: 10 }
    ),
  };

  return { elements, attrs, templateSettings: {} };
}

// ─── AI: generate email content ───────────────────────────────────────────────

const EMAIL_TYPE_CONTEXT = {
  welcome:      'Welcome email — warm, celebratory, sets expectations, delivers first value',
  promotional:  'Promotional email — compelling offer, clear value, urgency, strong CTA',
  newsletter:   'Newsletter — educational, valuable insights, builds relationship, soft CTA',
  followup:     'Follow-up email — re-engages, reminds of value, overcomes objections',
  reengagement: 'Re-engagement — acknowledges silence, offers new value, asks to reconnect',
  announcement: 'Announcement email — exciting news, clear details, action-oriented',
};

async function generateEmailContent(brief) {
  const { campaignName, subject, emailType, niche, offer, audience, tone, ctaText, ctaUrl, brandName } = brief;
  const typeCtx = EMAIL_TYPE_CONTEXT[emailType] || EMAIL_TYPE_CONTEXT.promotional;

  const system = `You are a world-class email copywriter who writes emails that get opened, read, and clicked. You write in a human, conversational tone — never corporate or generic. Return only valid JSON.`;

  const user = `Write a complete, high-converting email for this campaign:

Campaign: ${campaignName}
Subject (hint — you may refine it): ${subject}
Email Type: ${typeCtx}
Niche/Topic: ${niche}
Offer/Product: ${offer || 'their core product/service'}
Audience: ${audience || 'subscribers'}
Tone: ${tone || 'professional and warm'}
Brand Name: ${brandName || 'the brand'}
CTA Button: "${ctaText || 'Get Started'}" → ${ctaUrl || '#'}

Rules:
1. Subject line — specific, curiosity-driven, 6-8 words max
2. Preview text — expands on subject, creates urgency/curiosity, 80-100 chars
3. Headline — bold, benefit-focused, 8-12 words, NO markdown bold markers
4. Subheadline — supports headline, adds specificity, 1 sentence
5. Body — 3-4 paragraphs, each 2-3 sentences. Conversational, no fluff. Each paragraph on its own line separated by \\n\\n.
6. Footer — short legal-friendly unsubscribe notice

Return this exact JSON:
{
  "subject": "refined subject line",
  "previewText": "90-char preview text",
  "brandName": "${brandName || niche}",
  "headline": "bold email headline — NO asterisks or markdown",
  "subheadline": "one supporting sentence",
  "body": "paragraph 1\\n\\nparagraph 2\\n\\nparagraph 3",
  "ctaText": "${ctaText || 'Get Started'}",
  "ctaUrl": "${ctaUrl || '#'}",
  "footer": "short footer / unsubscribe notice",
  "suggestedColors": {
    "primaryColor": "#hex",
    "bgColor": "#ffffff",
    "textColor": "#111827"
  }
}`;

  const raw = await aiService.generate(system, user, { maxTokens: 1200 });
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
    tone         = 'professional and warm',
    ctaText      = 'Get Started',
    ctaUrl       = '',
    brandName    = '',
  } = req.body;

  if (!niche && !subject) {
    return res.status(400).json({ success: false, error: 'Provide at least a niche or subject.' });
  }

  // SSE setup
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    // ── Step 1: Generate email content ────────────────────────────────────
    send('step', { step: 1, total: 3, label: 'Generating email copy with AI…' });

    const content = await generateEmailContent({ campaignName, subject, emailType, niche, offer, audience, tone, ctaText, ctaUrl, brandName });
    send('content', content);
    send('step', { step: 2, total: 3, label: 'Building native GHL email template…' });

    // ── Step 2: Build MJML DND + HTML ─────────────────────────────────────
    const colors = content.suggestedColors || { primaryColor: '#4f46e5', bgColor: '#ffffff', textColor: '#111827' };
    const dnd  = buildMjmlDnd(content, colors);
    const html = renderEmailHtml(content, colors);

    // ── Step 3a: Create template shell ────────────────────────────────────
    send('step', { step: 3, total: 3, label: 'Saving draft to GHL email builder…' });

    const shellPayload = {
      locationId: req.locationId,
      type:       'builder',
      title:      campaignName,
      name:       campaignName,
      builderVersion: '2',
    };

    let emailId = null;
    console.log('[EmailBuilder] POST /emails/builder (shell)');
    try {
      const ghlShell = await ghlClient.ghlRequest(req.locationId, 'POST', '/emails/builder', shellPayload);
      console.log('[EmailBuilder] shell result:', JSON.stringify(ghlShell || '').slice(0, 200));
      emailId = ghlShell?.id || ghlShell?.templateId || ghlShell?._id || null;
    } catch (e) {
      console.error('[EmailBuilder] shell error:', e.message);
      const is401 = e.message.includes('401');
      send('error', { error: is401 ? 'Missing scope: emails/builder.write. Reinstall the app to grant it.' : `GHL error: ${e.message}`, needsReinstall: is401 });
      send('done', { success: false, content, needsReinstall: is401 });
      return res.end();
    }

    if (!emailId) {
      send('error', { error: 'GHL created the template but returned no ID.' });
      send('done', { success: false, content });
      return res.end();
    }

    // ── Step 3b: Save MJML DND content ────────────────────────────────────
    const dataPayload = {
      locationId:  req.locationId,
      templateId:  emailId,
      updatedBy:   req.locationId,
      editorType:  'builder',
      dnd,
      html,
      previewText: content.previewText || '',
    };
    console.log('[EmailBuilder] POST /emails/builder/data for', emailId);
    try {
      const ghlData = await ghlClient.ghlRequest(req.locationId, 'POST', '/emails/builder/data', dataPayload);
      console.log('[EmailBuilder] data result:', JSON.stringify(ghlData || '').slice(0, 200));
    } catch (e) {
      console.error('[EmailBuilder] data save error (non-fatal):', e.message);
      send('warn', { message: `Template created but content may not have saved: ${e.message}` });
    }

    console.log('[EmailBuilder] done — id:', emailId);
    const editUrl = `https://app.gohighlevel.com/v2/location/${req.locationId}/marketing/email-marketing/email-builder/${emailId}`;

    send('done', {
      success: true,
      emailId,
      editUrl,
      subject:  content.subject,
      content,
    });

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
