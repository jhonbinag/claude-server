/**
 * src/tools/externalTools.js
 *
 * External tool definitions and executors for the GTM toolkit.
 * Each tool has a Claude JSON-schema definition and an executor that calls
 * the external API using credentials stored per-location in toolConfigs.
 *
 * Supported tools:
 *   perplexity   — Research / web search via Perplexity AI
 *   openai       — Content generation + image generation (DALL-E) via OpenAI
 *   facebook_ads — Campaign/ad set/ad management via Facebook Marketing API
 *   sendgrid     — Transactional and bulk email via SendGrid
 *   slack        — Team notifications via Slack Incoming Webhooks
 *   apollo       — Contact enrichment via Apollo.io
 *   heygen       — AI video generation via HeyGen
 */

const axios = require('axios');

// ─── Tool Definitions ─────────────────────────────────────────────────────────

const EXTERNAL_TOOL_DEFINITIONS = {

  // ── Perplexity AI ───────────────────────────────────────────────────────────
  perplexity: [
    {
      name: 'perplexity_research',
      description: 'Research any topic using Perplexity AI with live web search. Great for competitor analysis, market research, trend research, and fact-checking before creating content.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The research question or topic to investigate' },
          focus: {
            type: 'string',
            enum: ['web', 'news', 'academic'],
            description: 'Search focus: web (general), news (recent news), academic (papers/research)',
          },
        },
        required: ['query'],
      },
    },
  ],

  // ── OpenAI ──────────────────────────────────────────────────────────────────
  openai: [
    {
      name: 'openai_generate_content',
      description: 'Generate written content using OpenAI GPT-4o: ad copy, email templates, social captions, blog outlines, landing page copy, scripts. Use this for large-volume content tasks or when a different AI voice is needed.',
      input_schema: {
        type: 'object',
        properties: {
          prompt:      { type: 'string', description: 'Detailed instructions for the content to generate' },
          contentType: { type: 'string', description: 'Type of content: "ad_copy", "email", "blog_post", "social_post", "script", "landing_page"' },
          tone:        { type: 'string', description: 'Tone: "professional", "casual", "urgent", "friendly", "authoritative"' },
          length:      { type: 'string', enum: ['short', 'medium', 'long'], description: 'Approximate length' },
        },
        required: ['prompt'],
      },
    },
    {
      name: 'openai_generate_image',
      description: 'Generate marketing images using DALL-E 3: ad creatives, social media visuals, blog header images, product mockups, logo concepts.',
      input_schema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Detailed description of the image to generate' },
          size:   { type: 'string', enum: ['1024x1024', '1792x1024', '1024x1792'], description: 'Image dimensions (default: 1024x1024)' },
          style:  { type: 'string', enum: ['vivid', 'natural'], description: 'vivid=bold/dramatic, natural=realistic' },
          n:      { type: 'number', description: 'Number of images to generate (1-4, default 1)' },
        },
        required: ['prompt'],
      },
    },
  ],

  // ── Facebook Ads ────────────────────────────────────────────────────────────
  facebook_ads: [
    {
      name: 'facebook_get_campaigns',
      description: 'List Facebook ad campaigns for the connected ad account with their status, budget, and spend.',
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ACTIVE', 'PAUSED', 'ARCHIVED', 'ALL'], description: 'Filter by campaign status (default: ALL)' },
          limit:  { type: 'number', description: 'Max campaigns to return (default 25)' },
        },
        required: [],
      },
    },
    {
      name: 'facebook_get_ad_insights',
      description: 'Get performance insights (spend, impressions, clicks, CTR, CPC, ROAS, conversions) for Facebook campaigns or ad sets.',
      input_schema: {
        type: 'object',
        properties: {
          level:      { type: 'string', enum: ['campaign', 'adset', 'ad'], description: 'Breakdown level' },
          datePreset: { type: 'string', enum: ['today', 'yesterday', 'last_7d', 'last_30d', 'last_90d', 'this_month', 'last_month'], description: 'Date range preset' },
          campaignId: { type: 'string', description: 'Filter to a specific campaign ID (optional)' },
        },
        required: ['level', 'datePreset'],
      },
    },
    {
      name: 'facebook_create_campaign',
      description: 'Create a new Facebook ad campaign with the specified objective and budget.',
      input_schema: {
        type: 'object',
        properties: {
          name:           { type: 'string', description: 'Campaign name' },
          objective:      { type: 'string', enum: ['OUTCOME_LEADS', 'OUTCOME_SALES', 'OUTCOME_AWARENESS', 'OUTCOME_TRAFFIC', 'OUTCOME_ENGAGEMENT'], description: 'Campaign objective' },
          dailyBudget:    { type: 'number', description: 'Daily budget in cents (e.g. 5000 = $50/day)' },
          lifetimeBudget: { type: 'number', description: 'Lifetime budget in cents (use instead of dailyBudget for fixed budget)' },
          startTime:      { type: 'string', description: 'ISO 8601 campaign start time (optional)' },
          stopTime:       { type: 'string', description: 'ISO 8601 campaign end time (optional)' },
        },
        required: ['name', 'objective'],
      },
    },
    {
      name: 'facebook_pause_campaign',
      description: 'Pause or reactivate a Facebook ad campaign.',
      input_schema: {
        type: 'object',
        properties: {
          campaignId: { type: 'string', description: 'Campaign ID to update' },
          status:     { type: 'string', enum: ['ACTIVE', 'PAUSED'], description: 'New status' },
        },
        required: ['campaignId', 'status'],
      },
    },
  ],

  // ── SendGrid ─────────────────────────────────────────────────────────────────
  sendgrid: [
    {
      name: 'sendgrid_send_email',
      description: 'Send a transactional or marketing email via SendGrid to one or more recipients.',
      input_schema: {
        type: 'object',
        properties: {
          to: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                email: { type: 'string' },
                name:  { type: 'string' },
              },
              required: ['email'],
            },
            description: 'Array of recipient objects with email and optional name',
          },
          subject:    { type: 'string', description: 'Email subject line' },
          htmlBody:   { type: 'string', description: 'HTML email body' },
          plainText:  { type: 'string', description: 'Plain text fallback body' },
          fromEmail:  { type: 'string', description: 'Sender email (must be verified in SendGrid)' },
          fromName:   { type: 'string', description: 'Sender display name' },
          replyTo:    { type: 'string', description: 'Reply-to email address (optional)' },
          templateId: { type: 'string', description: 'SendGrid dynamic template ID (optional — overrides htmlBody)' },
          dynamicData: { type: 'object', description: 'Template dynamic data key/values (used with templateId)' },
        },
        required: ['to', 'subject', 'fromEmail'],
      },
    },
    {
      name: 'sendgrid_get_stats',
      description: 'Get SendGrid email stats: delivered, opened, clicked, bounced, spam reports for a date range.',
      input_schema: {
        type: 'object',
        properties: {
          startDate: { type: 'string', description: 'Start date YYYY-MM-DD' },
          endDate:   { type: 'string', description: 'End date YYYY-MM-DD' },
        },
        required: ['startDate', 'endDate'],
      },
    },
  ],

  // ── Slack ────────────────────────────────────────────────────────────────────
  slack: [
    {
      name: 'slack_send_message',
      description: 'Send a notification or report to a Slack channel. Use this to report task completions, alerts, campaign results, or summaries to the team.',
      input_schema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Message text (supports Slack markdown: *bold*, _italic_, `code`)' },
          channel: { type: 'string', description: 'Slack channel name (e.g. #marketing) or leave blank to use the configured default channel' },
          emoji:   { type: 'string', description: 'Optional emoji for message flair (e.g. ":rocket:")' },
        },
        required: ['message'],
      },
    },
  ],

  // ── Apollo.io ────────────────────────────────────────────────────────────────
  apollo: [
    {
      name: 'apollo_enrich_contact',
      description: "Enrich a contact's profile with LinkedIn, company, job title, and social data using Apollo.io. Returns enriched contact data that can be used to update the GHL contact record.",
      input_schema: {
        type: 'object',
        properties: {
          email:     { type: 'string', description: "Contact's email address" },
          firstName: { type: 'string', description: "Contact's first name (optional, improves match accuracy)" },
          lastName:  { type: 'string', description: "Contact's last name (optional)" },
          domain:    { type: 'string', description: "Contact's company domain (optional)" },
        },
        required: ['email'],
      },
    },
    {
      name: 'apollo_search_people',
      description: "Search Apollo's database for prospects matching specific criteria: job title, company size, industry, location. Use for lead generation.",
      input_schema: {
        type: 'object',
        properties: {
          jobTitles:      { type: 'array', items: { type: 'string' }, description: 'Target job titles (e.g. ["CEO", "Founder", "Marketing Director"])' },
          companyDomains: { type: 'array', items: { type: 'string' }, description: 'Company domains to search within (optional)' },
          industries:     { type: 'array', items: { type: 'string' }, description: 'Industries to filter by (optional)' },
          locations:      { type: 'array', items: { type: 'string' }, description: 'Locations: city, state, or country (optional)' },
          employeeRanges: { type: 'array', items: { type: 'string' }, description: 'Company size ranges (e.g. ["1,10", "11,50", "51,200"])' },
          limit:          { type: 'number', description: 'Max results (default 25, max 100)' },
        },
        required: ['jobTitles'],
      },
    },
  ],

  // ── HeyGen ───────────────────────────────────────────────────────────────────
  heygen: [
    {
      name: 'heygen_create_video',
      description: 'Generate an AI spokesperson video using HeyGen. Great for personalized outreach videos, product demos, and social media content.',
      input_schema: {
        type: 'object',
        properties: {
          script:    { type: 'string', description: 'Video script / spoken text' },
          avatarId:  { type: 'string', description: 'HeyGen avatar ID to use as the spokesperson' },
          voiceId:   { type: 'string', description: 'HeyGen voice ID (optional — uses avatar default voice if omitted)' },
          title:     { type: 'string', description: 'Video title for organization' },
          dimension: {
            type: 'object',
            properties: {
              width:  { type: 'number' },
              height: { type: 'number' },
            },
            description: 'Video dimensions: e.g. {width: 1280, height: 720} for 16:9, {width: 720, height: 1280} for 9:16 (shorts/reels)',
          },
        },
        required: ['script', 'avatarId'],
      },
    },
    {
      name: 'heygen_list_avatars',
      description: 'List available HeyGen AI avatar IDs and names to pick a spokesperson for video generation.',
      input_schema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'heygen_get_video_status',
      description: 'Check the rendering status of a HeyGen video by its video ID. Returns status and download URL when complete.',
      input_schema: {
        type: 'object',
        properties: {
          videoId: { type: 'string', description: 'HeyGen video ID returned from heygen_create_video' },
        },
        required: ['videoId'],
      },
    },
  ],
};

// ─── Executors ────────────────────────────────────────────────────────────────

async function executeExternalTool(toolName, input, toolConfigs) {

  // ── Perplexity ──────────────────────────────────────────────────────────────
  if (toolName === 'perplexity_research') {
    const { apiKey } = toolConfigs.perplexity || {};
    if (!apiKey) throw new Error('Perplexity API key not configured for this location.');

    const model = input.focus === 'academic' ? 'llama-3.1-sonar-huge-128k-online'
      : input.focus === 'news'     ? 'llama-3.1-sonar-large-128k-online'
      :                              'llama-3.1-sonar-large-128k-online';

    const resp = await axios.post('https://api.perplexity.ai/chat/completions', {
      model,
      messages: [
        { role: 'system', content: 'You are a research assistant. Provide thorough, cited, up-to-date information.' },
        { role: 'user',   content: input.query },
      ],
      return_citations: true,
    }, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });

    return {
      content:   resp.data.choices[0].message.content,
      citations: resp.data.citations || [],
      model:     resp.data.model,
    };
  }

  // ── OpenAI Content ──────────────────────────────────────────────────────────
  if (toolName === 'openai_generate_content') {
    const { apiKey } = toolConfigs.openai || {};
    if (!apiKey) throw new Error('OpenAI API key not configured for this location.');

    const lengthGuide = { short: '~150 words', medium: '~400 words', long: '~800 words' };
    const systemPrompt = `You are an expert marketing copywriter. Generate ${input.contentType || 'content'} with a ${input.tone || 'professional'} tone. Target length: ${lengthGuide[input.length] || 'as appropriate'}.`;

    const resp = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: input.prompt },
      ],
      max_tokens: input.length === 'long' ? 1500 : input.length === 'short' ? 400 : 800,
    }, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });

    return { content: resp.data.choices[0].message.content, model: resp.data.model };
  }

  // ── OpenAI Image ────────────────────────────────────────────────────────────
  if (toolName === 'openai_generate_image') {
    const { apiKey } = toolConfigs.openai || {};
    if (!apiKey) throw new Error('OpenAI API key not configured for this location.');

    const resp = await axios.post('https://api.openai.com/v1/images/generations', {
      model:   'dall-e-3',
      prompt:  input.prompt,
      n:       Math.min(input.n || 1, 4),
      size:    input.size  || '1024x1024',
      style:   input.style || 'vivid',
      response_format: 'url',
    }, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });

    return { images: resp.data.data.map((img) => ({ url: img.url, revisedPrompt: img.revised_prompt })) };
  }

  // ── Facebook Ads ────────────────────────────────────────────────────────────
  if (toolName === 'facebook_get_campaigns') {
    const { accessToken, adAccountId } = toolConfigs.facebook_ads || {};
    if (!accessToken || !adAccountId) throw new Error('Facebook Ads not configured. Need accessToken and adAccountId.');

    // Strip act_ prefix if user accidentally included it
    const accountId = adAccountId.startsWith('act_') ? adAccountId.slice(4) : adAccountId;
    const status    = input.status === 'ALL' ? undefined : input.status;
    const params    = { access_token: accessToken, fields: 'id,name,status,objective,daily_budget,lifetime_budget,spend_cap', limit: input.limit || 25 };
    if (status) params.effective_status = `["${status}"]`;

    const resp = await axios.get(`https://graph.facebook.com/v20.0/act_${accountId}/campaigns`, { params });
    return resp.data;
  }

  if (toolName === 'facebook_get_ad_insights') {
    const { accessToken, adAccountId } = toolConfigs.facebook_ads || {};
    if (!accessToken || !adAccountId) throw new Error('Facebook Ads not configured.');

    const accountId = adAccountId.startsWith('act_') ? adAccountId.slice(4) : adAccountId;
    const params = {
      access_token: accessToken,
      level:        input.level,
      date_preset:  input.datePreset,
      fields:       'campaign_name,adset_name,ad_name,spend,impressions,clicks,ctr,cpc,actions,roas',
      limit:        100,
    };
    const url = input.campaignId
      ? `https://graph.facebook.com/v20.0/${input.campaignId}/insights`
      : `https://graph.facebook.com/v20.0/act_${accountId}/insights`;

    const resp = await axios.get(url, { params });
    return resp.data;
  }

  if (toolName === 'facebook_create_campaign') {
    const { accessToken, adAccountId } = toolConfigs.facebook_ads || {};
    if (!accessToken || !adAccountId) throw new Error('Facebook Ads not configured.');

    const accountId = adAccountId.startsWith('act_') ? adAccountId.slice(4) : adAccountId;
    const body = {
      access_token:          accessToken,
      name:                  input.name,
      objective:             input.objective,
      status:                'PAUSED', // always start paused for safety
      special_ad_categories: [],
    };
    if (input.dailyBudget)    body.daily_budget    = input.dailyBudget;
    if (input.lifetimeBudget) body.lifetime_budget = input.lifetimeBudget;
    if (input.startTime)      body.start_time      = input.startTime;
    if (input.stopTime)       body.stop_time       = input.stopTime;

    const resp = await axios.post(`https://graph.facebook.com/v20.0/act_${accountId}/campaigns`, body);
    return resp.data;
  }

  if (toolName === 'facebook_pause_campaign') {
    const { accessToken } = toolConfigs.facebook_ads || {};
    if (!accessToken) throw new Error('Facebook Ads not configured.');

    const resp = await axios.post(`https://graph.facebook.com/v20.0/${input.campaignId}`, {
      access_token: accessToken,
      status:       input.status,
    });
    return resp.data;
  }

  // ── SendGrid ─────────────────────────────────────────────────────────────────
  if (toolName === 'sendgrid_send_email') {
    const sg = toolConfigs.sendgrid || {};
    const { apiKey } = sg;
    // Accept both 'fromEmail' (frontend field key) and 'defaultFromEmail' (legacy) for backwards compat
    const configFromEmail = sg.fromEmail || sg.defaultFromEmail;
    const configFromName  = sg.fromName  || sg.defaultFromName;
    if (!apiKey) throw new Error('SendGrid API key not configured for this location.');

    const payload = {
      personalizations: [{ to: input.to }],
      from: { email: input.fromEmail || configFromEmail, name: input.fromName || configFromName },
      subject: input.subject,
    };
    if (input.replyTo)    payload.reply_to = { email: input.replyTo };
    if (input.templateId) {
      payload.template_id = input.templateId;
      if (input.dynamicData) payload.personalizations[0].dynamic_template_data = input.dynamicData;
    } else {
      payload.content = [];
      if (input.plainText) payload.content.push({ type: 'text/plain', value: input.plainText });
      if (input.htmlBody)  payload.content.push({ type: 'text/html',  value: input.htmlBody });
      if (!payload.content.length) payload.content.push({ type: 'text/plain', value: input.subject });
    }

    let resp;
    try {
      resp = await axios.post('https://api.sendgrid.com/v3/mail/send', payload, {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      const sgErrors = err.response?.data?.errors;
      const msg = sgErrors?.length ? sgErrors.map(e => e.message).join('; ') : err.message;
      throw new Error(`SendGrid error: ${msg}`);
    }
    return { success: true, statusCode: resp.status, recipientCount: input.to.length };
  }

  if (toolName === 'sendgrid_get_stats') {
    const { apiKey } = toolConfigs.sendgrid || {};
    if (!apiKey) throw new Error('SendGrid API key not configured.');

    const resp = await axios.get('https://api.sendgrid.com/v3/stats', {
      params: { start_date: input.startDate, end_date: input.endDate, aggregated_by: 'day' },
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return resp.data;
  }

  // ── Slack ─────────────────────────────────────────────────────────────────────
  if (toolName === 'slack_send_message') {
    const { webhookUrl, defaultChannel } = toolConfigs.slack || {};
    if (!webhookUrl) throw new Error('Slack webhook URL not configured for this location.');

    const text = input.emoji ? `${input.emoji} ${input.message}` : input.message;
    const body = { text };
    if (input.channel || defaultChannel) body.channel = input.channel || defaultChannel;

    const resp = await axios.post(webhookUrl, body);
    return { success: true, status: resp.data };
  }

  // ── Apollo.io ─────────────────────────────────────────────────────────────────
  if (toolName === 'apollo_enrich_contact') {
    const { apiKey } = toolConfigs.apollo || {};
    if (!apiKey) throw new Error('Apollo API key not configured.');

    const resp = await axios.post('https://api.apollo.io/v1/people/match', {
      api_key:    apiKey,
      email:      input.email,
      first_name: input.firstName,
      last_name:  input.lastName,
      domain:     input.domain,
      reveal_personal_emails: true,
    });
    return resp.data.person || resp.data;
  }

  if (toolName === 'apollo_search_people') {
    const { apiKey } = toolConfigs.apollo || {};
    if (!apiKey) throw new Error('Apollo API key not configured.');

    const resp = await axios.post('https://api.apollo.io/v1/mixed_people/search', {
      api_key:              apiKey,
      person_titles:        input.jobTitles,
      organization_domains: input.companyDomains,
      organization_industry_tag_ids: input.industries,
      person_locations:     input.locations,
      organization_num_employees_ranges: input.employeeRanges,
      page:     1,
      per_page: Math.min(input.limit || 25, 100),
    });
    return { people: resp.data.people, totalEntries: resp.data.pagination?.total_entries };
  }

  // ── HeyGen ────────────────────────────────────────────────────────────────────
  if (toolName === 'heygen_create_video') {
    const { apiKey } = toolConfigs.heygen || {};
    if (!apiKey) throw new Error('HeyGen API key not configured.');

    const resp = await axios.post('https://api.heygen.com/v2/video/generate', {
      video_inputs: [{
        character: { type: 'avatar', avatar_id: input.avatarId, avatar_style: 'normal' },
        voice:     input.voiceId ? { type: 'text', input_text: input.script, voice_id: input.voiceId } : { type: 'text', input_text: input.script },
        background: { type: 'color', value: '#FAFAFA' },
      }],
      dimension: input.dimension || { width: 1280, height: 720 },
      title:     input.title || 'Generated Video',
    }, {
      headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
    });
    return resp.data;
  }

  if (toolName === 'heygen_list_avatars') {
    const { apiKey } = toolConfigs.heygen || {};
    if (!apiKey) throw new Error('HeyGen API key not configured.');

    const resp = await axios.get('https://api.heygen.com/v2/avatars', {
      headers: { 'X-Api-Key': apiKey },
    });
    return resp.data;
  }

  if (toolName === 'heygen_get_video_status') {
    const { apiKey } = toolConfigs.heygen || {};
    if (!apiKey) throw new Error('HeyGen API key not configured.');

    const resp = await axios.get(`https://api.heygen.com/v1/video_status.get?video_id=${input.videoId}`, {
      headers: { 'X-Api-Key': apiKey },
    });
    return resp.data;
  }

  throw new Error(`Unknown external tool: ${toolName}`);
}

// ─── Tool Metadata (for UI) ───────────────────────────────────────────────────

const TOOL_METADATA = {
  anthropic: {
    label:       'Claude AI (Anthropic)',
    icon:        '🤖',
    description: 'Required — powers the AI assistant for your account',
    configFields: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-ant-...' },
    ],
  },
  perplexity: {
    label:       'Perplexity AI',
    icon:        '🔍',
    description: 'Live web research, competitor analysis, market trends',
    configFields: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'pplx-...' },
    ],
  },
  openai: {
    label:       'OpenAI',
    icon:        '✨',
    description: 'GPT-4o content generation + DALL-E 3 image creation',
    configFields: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-...' },
    ],
  },
  facebook_ads: {
    label:       'Facebook Ads',
    icon:        '📣',
    description: 'Campaign management, ad insights, bulk ad creation',
    configFields: [
      { key: 'accessToken', label: 'User Access Token',  type: 'password', placeholder: 'EAAxxxxx...' },
      { key: 'adAccountId', label: 'Ad Account ID',     type: 'text',     placeholder: '123456789 (without act_ prefix)' },
    ],
  },
  sendgrid: {
    label:       'SendGrid',
    icon:        '📧',
    description: 'Transactional & marketing email campaigns',
    configFields: [
      { key: 'apiKey',     label: 'API Key',       type: 'password', placeholder: 'SG.xxxxx' },
      { key: 'fromEmail',  label: 'From Email',    type: 'text',     placeholder: 'you@yourdomain.com' },
      { key: 'fromName',   label: 'From Name',     type: 'text',     placeholder: 'Your Company' },
    ],
  },
  slack: {
    label:       'Slack',
    icon:        '💬',
    description: 'Send team notifications and task completion alerts',
    configFields: [
      { key: 'webhookUrl',     label: 'Incoming Webhook URL', type: 'password', placeholder: 'https://hooks.slack.com/services/...' },
      { key: 'defaultChannel', label: 'Default Channel',     type: 'text',     placeholder: '#marketing' },
    ],
  },
  apollo: {
    label:       'Apollo.io',
    icon:        '🚀',
    description: 'Contact enrichment and B2B lead generation',
    configFields: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'your-apollo-api-key' },
    ],
  },
  heygen: {
    label:       'HeyGen',
    icon:        '🎬',
    description: 'AI spokesperson video generation for ads and outreach',
    configFields: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'your-heygen-api-key' },
    ],
  },
};

module.exports = { EXTERNAL_TOOL_DEFINITIONS, TOOL_METADATA, executeExternalTool };
