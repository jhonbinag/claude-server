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

const MAX_TURNS = 20; // safety ceiling on tool-call iterations

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
  const integrationNote = enabledIntegrations.length
    ? `\n## Connected external integrations:\n${enabledIntegrations.map((k) => `- ${k}`).join('\n')}\nUse these alongside GHL tools to complete tasks end-to-end.\n`
    : '';

  return `You are an intelligent GTM (Go-To-Market) automation assistant with access to GHL (GoHighLevel) and connected marketing tools.${integrationNote}

You have direct access to a GHL sub-account (locationId: ${locationId}) via a set of tools.
Use these tools to autonomously complete marketing, CRM, and communication tasks.

## Your capabilities:
- Search, create, update contacts and their tags/notes
- Send SMS and email messages to contacts
- Manage opportunities and pipelines
- List and trigger automation workflows
- Manage calendars and appointments
- Schedule social media posts
- Create blog content
- List campaigns, forms, surveys, products, and invoices
- Query location and team details

## Guidelines:
- Always confirm what you are about to do before executing destructive or bulk operations.
- When sending messages, verify the contact exists first.
- When creating content (emails, blogs, social posts), craft professional, on-brand copy unless the user specifies otherwise.
- Be thorough — if a task has multiple steps (e.g. "create a lead and enroll them in a workflow"), complete all steps.
- Summarize what you did at the end in a concise, human-readable format.
- If a tool returns an error, explain what went wrong and what you tried.

Today's date: ${new Date().toISOString().split('T')[0]}
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