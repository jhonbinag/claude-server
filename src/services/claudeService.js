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
- GHL Content: create blog posts, schedule social media posts
- GHL Media: upload images to GHL media library (use after generating with DALL-E)
- GHL Funnels: list funnels and their pages
- GHL Admin: calendars, appointments, forms, surveys, products, invoices, users
${hasApollo   ? '- Apollo.io: search B2B prospects, enrich contact data\n' : ''}\
${hasFacebook ? '- Facebook Ads: create/manage campaigns, read ad insights\n' : ''}\
${hasHeyGen   ? '- HeyGen: generate AI avatar videos for personalised outreach\n' : ''}\
${hasSendGrid ? '- SendGrid: send transactional/marketing emails at scale\n' : ''}\
${hasSlack    ? '- Slack: send notifications and summaries to channels\n' : ''}\

## How to build a complete campaign or funnel setup:
When the user asks for a funnel, campaign, landing page, or marketing automation, follow this sequence:

1. **Research & Strategy** — ${researchNote.replace('- **Research**: ', '')}
2. **Copy** — ${copyNote.replace('- **Copy generation**: ', '')}
3. **Visuals** — ${imageNote.replace('- **Image generation**: ', '')}
4. **GHL Setup** — Create the GHL artifacts in order:
   a. Create a blog post as the landing page (with full HTML/rich copy and the uploaded hero image)
   b. Create social posts promoting the funnel across connected accounts
   c. List existing workflows and add relevant contacts to the right automation
   d. If applicable, create an opportunity in the pipeline
   e. If email is needed, draft and send via GHL email tool${hasSendGrid ? ' or SendGrid' : ''}
5. **Summary** — Report all created assets with links/IDs so the user can find them in GHL

## When building a workflow automation:
- List existing workflows first to understand what's already set up
- Design the sequence logic: trigger → delay → action (SMS/email/tag)
- Generate all message copy for each step
- Add test contacts to the workflow to validate it
- Document the full sequence in your summary

## When the user asks for ad creative or paid campaign:
${hasFacebook ? '- Use facebook_create_campaign to set up the Facebook campaign\n- Use openai_generate_image for ad creatives\n- Use perplexity_research to validate targeting\n' : '- Suggest Facebook/Google ad setup steps even if API not connected\n'}\
- Always generate the full ad copy (headline, primary text, CTA, description)
- Generate matching visual concepts or actual images

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
async function runTask({ task, locationId, companyId, allowedIntegrations, onEvent }) {
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

module.exports = { runTask };