/**
 * src/routes/manychat.js
 *
 * ManyChat integration routes.
 *
 *  GET  /manychat/info                — verify API key + get page info
 *  POST /manychat/generate-sequence   — Claude generates a "0 to Hero" subscriber sequence
 *  POST /manychat/broadcast           — send a broadcast to all ManyChat subscribers
 */

const express      = require('express');
const router       = express.Router();
const axios        = require('axios');
const authenticate = require('../middleware/authenticate');
const toolRegistry = require('../tools/toolRegistry');
const Anthropic    = require('@anthropic-ai/sdk');

router.use(authenticate);

const MC_BASE = 'https://api.manychat.com';

async function getMcApiKey(locationId) {
  const configs = await toolRegistry.getToolConfig(locationId);
  return configs?.manychat?.apiKey || null;
}

async function mcRequest(apiKey, method, path, data = null) {
  const res = await axios({
    method,
    url: `${MC_BASE}${path}`,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    ...(data ? { data } : {}),
    validateStatus: () => true,
  });
  if (res.status >= 400) {
    throw new Error(res.data?.message || `ManyChat API error ${res.status}`);
  }
  return res.data;
}

// GET /manychat/info — verify connection
router.get('/info', async (req, res) => {
  try {
    const apiKey = await getMcApiKey(req.locationId);
    if (!apiKey) return res.status(400).json({ error: 'ManyChat API key not configured. Add it in Settings → ManyChat.' });
    const data = await mcRequest(apiKey, 'GET', '/fb/page/getInfo');
    res.json({ success: true, data: data.data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /manychat/generate-sequence
// Body: { topic, channels?, steps?, endDay?, context? }
router.post('/generate-sequence', async (req, res) => {
  const { topic, channels = ['messenger'], steps = 7, endDay = 30, context } = req.body;
  if (!topic) return res.status(400).json({ error: 'topic is required.' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured.' });

  try {
    const client = new Anthropic({ apiKey: anthropicKey });

    // Define the delay schedule based on steps count
    const defaultDays = [0, 1, 3, 7, 14, 21, 30, 45, 60, 90].slice(0, steps);
    while (defaultDays.length < steps) {
      defaultDays.push(defaultDays[defaultDays.length - 1] + 7);
    }

    const arcLabels = {
      0: 'Welcome + Immediate Value',
      1: 'Quick Win / First Tip',
      3: 'Deeper Education',
      7: 'Social Proof / Case Study',
      14: 'Objection Handling',
      21: 'Soft Offer / Invitation',
      30: 'Strong CTA / Conversion',
    };

    const channelList = Array.isArray(channels) ? channels.join(', ') : channels;

    const prompt = `You are a world-class ManyChat funnel strategist. Generate a complete "0 to Hero" subscriber nurture sequence.

Business/Topic: ${topic}${context ? `\nAdditional context: ${context}` : ''}
Channels: ${channelList}
Number of messages: ${steps}
Sequence span: Day 0 to Day ${endDay}

Message schedule (days from opt-in): ${defaultDays.join(', ')}

The arc to follow:
${defaultDays.map(d => `- Day ${d}: ${arcLabels[d] || `Continued nurture (day ${d})`}`).join('\n')}

RULES:
- Messages must be conversational and feel human — never robotic or salesy
- Length: 2–4 sentences + 1 clear CTA per message
- Use {{first name}} for personalization
- SMS messages must be under 160 characters
- Messenger/Instagram: casual, emoji-friendly
- Each CTA should be actionable and specific
- Build trust before pitching — no hard sells before Day 14
- delay_hours is cumulative hours from Day 0 (Day 0 = 0h, Day 1 = 24h, Day 7 = 168h, etc.)

Respond with ONLY valid JSON (no markdown, no explanation):
{
  "topic": "${topic}",
  "sequence": [
    {
      "day": 0,
      "delay_hours": 0,
      "label": "Day 0 — Welcome",
      "channel": "messenger",
      "message": "full message text here",
      "cta": "call to action text"
    }
  ]
}`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0]?.text?.trim() || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Claude did not return valid JSON for the sequence.' });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    res.json({ success: true, ...parsed });
  } catch (err) {
    console.error('[ManyChat] generate-sequence error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /manychat/broadcast
// Body: { message, buttons? }
// Sends a text broadcast to all bot subscribers
router.post('/broadcast', async (req, res) => {
  try {
    const apiKey = await getMcApiKey(req.locationId);
    if (!apiKey) return res.status(400).json({ error: 'ManyChat API key not configured.' });

    const { message, buttons } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required.' });

    const msgObj = { type: 'text', text: message };
    if (Array.isArray(buttons) && buttons.length) {
      msgObj.buttons = buttons.map(b => ({ type: 'url', caption: b.label, url: b.url }));
    }

    const payload = {
      data: {
        version: 'v2',
        content: { messages: [msgObj] },
      },
    };

    const data = await mcRequest(apiKey, 'POST', '/fb/broadcasting/sendContent', payload);
    res.json({ success: true, data: data.data });
  } catch (err) {
    console.error('[ManyChat] broadcast error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
