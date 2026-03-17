/**
 * src/services/claudeService.js
 *
 * Claude AI service — agentic loop that gives Claude access to all GHL tools.
 *
 * Claude (claude-opus-4-6) acts as the reasoning engine. On each turn it can
 * call any GHL tool; results feed back in and Claude continues until the task
 * is done or the turn limit is reached.
 *
 * Streaming support: pass an `onEvent` callback to receive events as they occur:
 *   onEvent({ type: 'text',        text: '...' })
 *   onEvent({ type: 'tool_call',   name, input })
 *   onEvent({ type: 'tool_result', name, result })
 *   onEvent({ type: 'done',        message, turns })
 *   onEvent({ type: 'error',       error })
 */

const Anthropic      = require('@anthropic-ai/sdk');
const https          = require('https');
const config         = require('../config');
const toolRegistry   = require('../tools/toolRegistry');
const activityLogger = require('./activityLogger');

const MAX_TURNS = 40; // safety ceiling on tool-call iterations (complex campaigns need more turns)

// Create a per-location Anthropic client using the key stored in tool configs.
// Falls back to the server-level ANTHROPIC_API_KEY env var (for local dev).
async function getClientForLocation(locationId) {
  const configs = await toolRegistry.loadToolConfigs(locationId);
  const apiKey  = configs.anthropic?.apiKey || config.anthropic.apiKey;
  if (!apiKey) {
    throw new Error('Anthropic API key not configured. Go to Settings → Integrations → Claude AI to add your key.');
  }
  return new Anthropic.default({ apiKey });
}

// ─── System Prompt ────────────────────────────────────────────────────────────

// enabledIntegrations is pre-fetched before the loop and passed in to avoid
// one Firestore/Redis read per Claude turn (could be up to MAX_TURNS reads).
function buildSystemPrompt(locationId, companyId, enabledIntegrations = []) {
  const hasOpenAI     = enabledIntegrations.includes('openai');
  const hasPerplexity = enabledIntegrations.includes('perplexity');
  const hasSendGrid   = enabledIntegrations.includes('sendgrid');
  const hasSlack      = enabledIntegrations.includes('slack');
  const hasApollo     = enabledIntegrations.includes('apollo');
  const hasHeyGen     = enabledIntegrations.includes('heygen');
  const hasFacebook   = enabledIntegrations.includes('facebook_ads');

  const integrationList = enabledIntegrations.length
    ? `\n## Connected external integrations:\n${enabledIntegrations.map((k) => `- ${k}`).join('\n')}\n`
    : '\n## No external integrations connected yet (user can add them in Settings).\n';

  const imageNote = hasOpenAI
    ? `- **Image generation**: Use \`openai_generate_image\` (DALL-E 3) to create visuals. After generating, upload them to GHL with \`upload_media\` so they can be embedded in pages and emails.`
    : `- **Image generation**: OpenAI not connected — describe what images are needed and provide placeholder suggestions.`;

  const copyNote = hasOpenAI
    ? `- **Copy generation**: Use \`openai_generate_content\` (GPT-4o) for all marketing copy — headlines, body, CTAs, email sequences, ad copy, SMS templates.`
    : `- **Copy generation**: Write all copy directly yourself using Claude's capabilities.`;

  const researchNote = hasPerplexity
    ? `- **Research**: Use \`perplexity_research\` to research the niche, competitors, target audience, and messaging angles BEFORE writing copy.`
    : `- **Research**: Apply your built-in knowledge for niche/audience research.`;

  return `You are an expert GTM (Go-To-Market) AI assistant and campaign builder with full access to GHL (GoHighLevel) and connected marketing tools.
${integrationList}
You have direct access to a GHL sub-account (locationId: ${locationId}).
Today's date: ${new Date().toISOString().split('T')[0]}

## Core capabilities:
- GHL CRM: search/create/update contacts, tags, notes, custom fields
- GHL Messaging: send SMS and email to contacts
- GHL Pipelines: create and update opportunities
- GHL Automation: list workflows, add contacts to workflows, trigger sequences
- GHL Blogs: create blog articles/posts (\`create_blog_post\`) — Sites → Blogs
- GHL Websites: list websites (\`list_websites\`), list pages (\`list_website_pages\`), CREATE pages (\`create_website_page\`), UPDATE pages (\`update_website_page\`) — Sites → Websites
- GHL Funnels: list funnels (\`list_funnels\`), list pages (\`list_funnel_pages\`), CREATE pages (\`create_funnel_page\`), UPDATE pages (\`update_funnel_page\`) — Sites → Funnels
- GHL Media: upload images to GHL media library via \`upload_media\` (use after DALL-E)
- GHL Social Planner: create/schedule social media posts via \`create_social_post\` + \`list_social_accounts\`. **ALWAYS use status: 'DRAFT' when generating from this command center** — the user reviews drafts in the Social Planner UI (/social) before publishing.
- Social Hub — organic social channels (if connected): Facebook Pages (\`fb_page_*\`), Instagram Business (\`ig_*\`), TikTok Creator (\`tiktok_org_*\`), YouTube Channel (\`yt_*\`), LinkedIn Pages (\`linkedin_org_*\`), Pinterest (\`pinterest_*\`). Use these for reading analytics, posting content, and managing organic presence. These are SEPARATE from paid ads integrations.
- GHL Admin: calendars, appointments, forms, surveys, products, invoices, users
${hasApollo   ? '- Apollo.io: search B2B prospects, enrich contact data\n' : ''}\
${hasFacebook ? '- Facebook Ads: create/manage campaigns, read ad insights\n' : ''}\
${hasHeyGen   ? '- HeyGen: generate AI avatar videos for personalised outreach\n' : ''}\
${hasSendGrid ? '- SendGrid: send transactional/marketing emails at scale\n' : ''}\
${hasSlack    ? '- Slack: send notifications and summaries to channels\n' : ''}\

## How to build a complete funnel, website, or campaign — EXECUTE ALL STEPS:
When the user asks for a funnel, website page, landing page, campaign, or marketing automation, follow this exact sequence without stopping:

### Step 1 — Research & Strategy
${researchNote.replace('- **Research**: ', '')}
Define: target audience, core offer, unique value proposition, funnel structure (pages needed), and messaging angle.

### Step 2 — Generate All Copy
${copyNote.replace('- **Copy generation**: ', '')}
Write complete copy for EVERY page: headline, subheadline, 3–5 bullet benefits, body paragraphs, CTA button text, social proof blurb, FAQ section.

### Step 3 — Generate & Upload Images
${imageNote.replace('- **Image generation**: ', '')}
For each page that needs a hero image:
  1. Call \`openai_generate_image\` with a detailed prompt for a professional marketing visual
  2. Immediately call \`upload_media\` with the returned image URL to store it in GHL
  3. Use the GHL media URL (from upload_media response) as the 'url' in an 'image' element inside the hero section

### Step 4 — Build Funnel Pages in GHL using native element format
  a. Call \`list_funnels\` — use an existing funnel if one matches the purpose
  b. For each funnel page (opt-in → sales → upsell → thank-you, or as appropriate):
     - Call \`create_funnel_page\` with: funnelId, name, url slug, SEO title, meta description, stepOrder, and a **sections** array
     - Build sections using GHL's native page builder element types — NOT raw HTML:
       * Hero section: bgColor dark, headline (h1) + subheadline + image (use uploaded GHL URL) + button → "#form"
       * Benefits section: bgColor white, subheadline "Why Choose Us" + bullets with 5-7 benefits
       * Social proof section: 2-3 testimonial elements in a columns element (count:3)
       * CTA/Form section: id "form", headline + form element with fields + submit button
       * Footer: text with copyright, links
     - Example section: \`{ bgColor:"#1a1a2e", padding:"80px 40px", elements:[{type:"headline",text:"...",level:"h1",color:"#fff",align:"center"},{type:"button",text:"Get Started",href:"#form",bgColor:"#ff6b35",color:"#fff",size:"large",align:"center"}] }\`
  c. After creation, confirm with \`list_funnel_pages\` that pages are live

### Step 5a — Website Pages (Sites → Websites)
If the user wants a multi-page website (home, about, services, contact):
  a. Call \`list_websites\` — use an existing website if one exists
  b. For each website page, call \`create_website_page\` with websiteId, name, url slug, and sections array
     - Home: dark hero + about intro + services columns + testimonials + contact form section
     - About: headline + team text + image + mission bullets
     - Services: headline + per-service columns (each with icon, title, text) + CTA button
     - Contact: headline + form with all fields
  c. Confirm with \`list_website_pages\` after creation

### Step 5b — Blog Posts (Sites → Blogs)
For SEO content, articles, or news posts use \`create_blog_post\`:
- Intro section: 'text' element with opening paragraph
- Image section: 'image' element with the uploaded GHL media URL
- Body sections: alternating 'text' paragraphs + 'bullets' for key points
- CTA section: 'headline' + 'button' linking to the opt-in funnel page

**Important: Funnels ≠ Websites ≠ Blogs — they are three separate things in GHL:**
- **Funnel** = step-by-step conversion sequence (opt-in → sales → upsell → thank-you)
- **Website** = multi-page informational site (home, about, services, contact)
- **Blog** = written articles/posts for SEO and content marketing

### Step 6 — Social & Email Promotion
Create social posts on all connected accounts promoting the funnel entry page URL.
**Always use status: 'DRAFT' for all social posts** — they will appear in the Social Planner (/social) for the user to review and publish. Never post immediately (status: 'NOW') unless the user explicitly asks.
Draft email/SMS follow-up sequences for leads who opt in.

### Step 7 — Automation Setup
List existing workflows. Add tags to identify which funnel the contact came from.
Enrol appropriate contacts in follow-up sequences.

### Step 8 — Summary
Report every created asset with: name, type (funnel page / blog post / social post), GHL ID, URL, and next steps the user should take in GHL.

## When building a workflow automation:
- List existing workflows first to understand what's already set up
- Design the sequence: trigger (tag/form/opt-in) → delay → action (SMS/email/tag)
- Generate all message copy for each step
- Document the full sequence so the user can replicate it in GHL's workflow builder

## When the user asks for ad creative or paid campaign:
${hasFacebook ? '- Use facebook_create_campaign to set up the Facebook campaign\n- Use openai_generate_image for ad creatives\n- Use perplexity_research to validate targeting\n' : '- Provide complete Facebook/Google ad setup instructions\n'}\
- Always generate the full ad copy (headline, primary text, CTA, description)
- Generate matching visuals with openai_generate_image and upload to GHL

## General guidelines:
- **Always be proactive**: if the user asks for X, also create Y and Z if they obviously belong together (e.g. blog post + social posts + email = one campaign).
- **Never stop at planning**: execute all steps using the available tools — don't just list what could be done.
- **Confirm before bulk/destructive operations** (mass SMS, deleting records, large batch jobs).
- **Verify before messaging**: check the contact exists before sending SMS/email.
- **Professional quality**: all generated copy and images should be polished, on-brand, and ready to use.
- **Show your work**: after each major step, briefly note what was created and its GHL ID/URL.
- **Error handling**: if a tool fails, try an alternative approach and explain what happened.
`;
}

// ─── Agentic Loop ─────────────────────────────────────────────────────────────

/**
 * Run a task through Claude with GHL tool access.
 *
 * @param {object} options
 * @param {string} options.task        - Natural language task description
 * @param {string} options.locationId  - GHL location/sub-account ID
 * @param {string} [options.companyId] - GHL company/agency ID
 * @param {function} [options.onEvent] - Streaming callback (optional)
 * @returns {Promise<{result: string, turns: number, toolCallCount: number}>}
 */
/**
 * @param {string[]=} options.allowedIntegrations  Optional whitelist of external
 *   integration categories (e.g. ['openai','sendgrid']). null = all enabled.
 */
async function runTaskWithAnthropic({ task, locationId, companyId, allowedIntegrations, onEvent }) {
  const client = await getClientForLocation(locationId);
  const emit   = onEvent || (() => {});

  // Pre-fetch tools and enabled integrations once before the loop.
  // Both calls share the same Redis/Firebase cache read, so only one
  // round-trip occurs regardless of MAX_TURNS iterations.
  const [tools, enabledIntegrations] = await Promise.all([
    toolRegistry.getTools(locationId, allowedIntegrations ?? null),
    toolRegistry.getEnabledIntegrations(locationId),
  ]);

  const messages = [{ role: 'user', content: task }];
  let turns         = 0;
  let toolCallCount = 0;
  let finalText     = '';

  while (turns < MAX_TURNS) {
    turns++;

    // ── Stream this API call ────────────────────────────────────────────────
    const stream = client.messages.stream({
      model:      'claude-opus-4-6',
      max_tokens: 8192,
      thinking:   { type: 'adaptive' },
      system:     buildSystemPrompt(locationId, companyId, enabledIntegrations),
      tools,
      messages,
    });

    // Collect streamed text for this turn
    let turnText = '';

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        turnText += event.delta.text;
        emit({ type: 'text', text: event.delta.text });
      }
    }

    const message = await stream.finalMessage();

    if (turnText) finalText = turnText;

    // Append assistant response to history
    messages.push({ role: 'assistant', content: message.content });

    // ── Check stop reason ────────────────────────────────────────────────────
    if (message.stop_reason === 'end_turn') {
      emit({ type: 'done', message: finalText, turns, toolCallCount });
      return { result: finalText, turns, toolCallCount };
    }

    if (message.stop_reason !== 'tool_use') {
      // Unexpected stop (e.g. max_tokens, refusal)
      emit({ type: 'done', message: finalText, turns, toolCallCount });
      return { result: finalText, turns, toolCallCount };
    }

    // ── Execute all tool calls in this turn ──────────────────────────────────
    const toolUseBlocks = message.content.filter((b) => b.type === 'tool_use');
    const toolResults   = [];

    for (const block of toolUseBlocks) {
      toolCallCount++;
      emit({ type: 'tool_call', name: block.name, input: block.input });

      let toolResult;
      try {
        toolResult = await toolRegistry.executeTool(block.name, block.input, locationId, companyId);
        emit({ type: 'tool_result', name: block.name, result: toolResult });
        activityLogger.log({ locationId, event: 'tool_call', detail: { tool: block.name }, success: true });
      } catch (err) {
        toolResult = { error: true, message: err.message };
        emit({ type: 'tool_result', name: block.name, result: toolResult });
        activityLogger.log({ locationId, event: 'tool_call', detail: { tool: block.name, error: err.message }, success: false });
      }

      toolResults.push({
        type:        'tool_result',
        tool_use_id: block.id,
        content:     JSON.stringify(toolResult),
      });
    }

    // Feed tool results back to Claude
    messages.push({ role: 'user', content: toolResults });
  }

  // Reached MAX_TURNS
  const limitMsg = `[Task reached the ${MAX_TURNS}-turn limit. Partial result: ${finalText}]`;
  emit({ type: 'done', message: limitMsg, turns, toolCallCount });
  return { result: limitMsg, turns, toolCallCount };
}

// ─── Gemini Agentic Loop ──────────────────────────────────────────────────────

// Recursively sanitize a JSON Schema for Gemini:
//  - Every array type must have an `items` field
//  - Remove keywords Gemini doesn't support (additionalProperties, $schema, etc.)
function sanitizeSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;

  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    // Drop unsupported keywords
    if (['$schema', 'additionalProperties', 'default', 'examples', '$defs', '$ref'].includes(k)) continue;
    out[k] = v;
  }

  if (out.type === 'array') {
    out.items = sanitizeSchema(out.items) || { type: 'string' };
  }

  if (out.properties && typeof out.properties === 'object') {
    const cleaned = {};
    for (const [k, v] of Object.entries(out.properties)) {
      cleaned[k] = sanitizeSchema(v);
    }
    out.properties = cleaned;
  }

  if (out.items && typeof out.items === 'object') {
    out.items = sanitizeSchema(out.items);
  }

  if (Array.isArray(out.anyOf)) out.anyOf = out.anyOf.map(sanitizeSchema);
  if (Array.isArray(out.oneOf)) out.oneOf = out.oneOf.map(sanitizeSchema);

  return out;
}

// Convert Anthropic input_schema tools → Gemini functionDeclarations
function toGeminiFunctions(tools) {
  return tools.map(t => ({
    name:        t.name,
    description: t.description,
    parameters:  sanitizeSchema(t.input_schema) || { type: 'object', properties: {} },
  }));
}

// POST to Gemini REST API with 429 retry
function geminiPost(body, retries = 3) {
  const key  = process.env.GOOGLE_API_KEY;
  const model = 'gemini-1.5-flash';
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname: 'generativelanguage.googleapis.com',
        path:     `/v1beta/models/${model}:generateContent?key=${key}`,
        method:   'POST',
        headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      },
      (resp) => {
        let d = '';
        resp.on('data', c => d += c);
        resp.on('end', async () => {
          try {
            const parsed = JSON.parse(d);
            if (resp.statusCode === 429 && retries > 0) {
              const wait = (4 - retries) * 15000;
              console.warn(`[Gemini] 429 — retrying in ${wait / 1000}s`);
              await new Promise(r => setTimeout(r, wait));
              geminiPost(body, retries - 1).then(resolve).catch(reject);
            } else if (resp.statusCode >= 400) {
              reject(new Error(`Gemini ${resp.statusCode}: ${JSON.stringify(parsed).slice(0, 300)}`));
            } else {
              resolve(parsed);
            }
          } catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function runTaskWithGemini({ task, locationId, companyId, allowedIntegrations, onEvent }) {
  const emit = onEvent || (() => {});

  const [tools, enabledIntegrations] = await Promise.all([
    toolRegistry.getTools(locationId, allowedIntegrations ?? null),
    toolRegistry.getEnabledIntegrations(locationId),
  ]);

  const systemPrompt = buildSystemPrompt(locationId, companyId, enabledIntegrations);
  const geminiFns    = toGeminiFunctions(tools);

  // Gemini conversation history
  const contents = [{ role: 'user', parts: [{ text: task }] }];

  let turns         = 0;
  let toolCallCount = 0;
  let finalText     = '';

  while (turns < MAX_TURNS) {
    turns++;

    const resp = await geminiPost({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      tools: geminiFns.length ? [{ functionDeclarations: geminiFns }] : undefined,
      generationConfig: { maxOutputTokens: 8192 },
    });

    const candidate = resp.candidates?.[0];
    if (!candidate) throw new Error('Gemini returned no candidates.');

    const parts       = candidate.content?.parts || [];
    const textParts   = parts.filter(p => p.text);
    const fnCallParts = parts.filter(p => p.functionCall);

    // Emit text
    const turnText = textParts.map(p => p.text).join('');
    if (turnText) {
      finalText = turnText;
      emit({ type: 'text', text: turnText });
    }

    // Append model turn to history
    contents.push({ role: 'model', parts });

    const finishReason = candidate.finishReason;

    // No function calls → done
    if (!fnCallParts.length || finishReason === 'STOP') {
      emit({ type: 'done', message: finalText, turns, toolCallCount });
      return { result: finalText, turns, toolCallCount };
    }

    // Execute function calls
    const fnResponses = [];
    for (const part of fnCallParts) {
      const { name, args } = part.functionCall;
      toolCallCount++;
      emit({ type: 'tool_call', name, input: args });

      let result;
      try {
        result = await toolRegistry.executeTool(name, args, locationId, companyId);
        emit({ type: 'tool_result', name, result });
        activityLogger.log({ locationId, event: 'tool_call', detail: { tool: name }, success: true });
      } catch (err) {
        result = { error: true, message: err.message };
        emit({ type: 'tool_result', name, result });
        activityLogger.log({ locationId, event: 'tool_call', detail: { tool: name, error: err.message }, success: false });
      }

      fnResponses.push({
        functionResponse: {
          name,
          response: { result: typeof result === 'string' ? result : JSON.stringify(result) },
        },
      });
    }

    // Feed results back
    contents.push({ role: 'user', parts: fnResponses });
  }

  const limitMsg = `[Task reached the ${MAX_TURNS}-turn limit. Partial result: ${finalText}]`;
  emit({ type: 'done', message: limitMsg, turns, toolCallCount });
  return { result: limitMsg, turns, toolCallCount };
}

// ─── Route to correct provider ────────────────────────────────────────────────

async function runTask(options) {
  const hasAnthropic = !!(process.env.ANTHROPIC_API_KEY);
  if (!hasAnthropic && process.env.GOOGLE_API_KEY) {
    return runTaskWithGemini(options);
  }
  return runTaskWithAnthropic(options);
}

module.exports = { runTask };