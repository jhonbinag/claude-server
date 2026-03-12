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
 *   hubspot      — CRM contacts and deals via HubSpot
 *   keap         — CRM contacts, tags and automations via Keap
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

  // ── Stripe ───────────────────────────────────────────────────────────────────
  stripe: [
    {
      name: 'stripe_list_customers',
      description: 'List Stripe customers with optional email, name, or limit filter.',
      input_schema: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Filter by exact email address (optional)' },
          limit: { type: 'number', description: 'Max results to return (default 20, max 100)' },
        },
        required: [],
      },
    },
    {
      name: 'stripe_list_payments',
      description: 'List recent Stripe payment intents / charges. Returns amount, status, customer, description.',
      input_schema: {
        type: 'object',
        properties: {
          limit:           { type: 'number', description: 'Max results (default 20)' },
          status:          { type: 'string', enum: ['succeeded', 'requires_payment_method', 'canceled', 'processing'], description: 'Filter by status (optional)' },
          createdAfterDays: { type: 'number', description: 'Only show payments created within the last N days (optional)' },
        },
        required: [],
      },
    },
    {
      name: 'stripe_list_subscriptions',
      description: 'List Stripe subscriptions with status filter. Returns customer, plan, amount, renewal date.',
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['active', 'past_due', 'canceled', 'trialing', 'all'], description: 'Filter by subscription status (default: active)' },
          limit:  { type: 'number', description: 'Max results (default 20)' },
        },
        required: [],
      },
    },
    {
      name: 'stripe_create_payment_link',
      description: 'Create a Stripe Payment Link that customers can use to pay. Returns a shareable URL.',
      input_schema: {
        type: 'object',
        properties: {
          priceId:  { type: 'string', description: 'Stripe Price ID (price_xxx) for the product' },
          quantity: { type: 'number', description: 'Quantity (default 1)' },
          currency: { type: 'string', description: 'Currency code (e.g. usd, eur) — only needed if creating an ad-hoc price' },
          amount:   { type: 'number', description: 'Amount in cents (e.g. 4900 = $49) — used only if priceId is omitted' },
          productName: { type: 'string', description: 'Product name — used only if priceId is omitted' },
        },
        required: [],
      },
    },
    {
      name: 'stripe_get_revenue',
      description: 'Get Stripe revenue summary: total charged, refunded, net, and count for a date range.',
      input_schema: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Look back N days from today (default 30)' },
        },
        required: [],
      },
    },
  ],

  // ── PayPal ───────────────────────────────────────────────────────────────────
  paypal: [
    {
      name: 'paypal_list_orders',
      description: 'List recent PayPal orders with their status and amounts.',
      input_schema: {
        type: 'object',
        properties: {
          startDate: { type: 'string', description: 'Start date ISO 8601 (e.g. 2024-01-01T00:00:00Z)' },
          endDate:   { type: 'string', description: 'End date ISO 8601 (optional, defaults to now)' },
        },
        required: ['startDate'],
      },
    },
    {
      name: 'paypal_get_order',
      description: 'Get details of a specific PayPal order by order ID.',
      input_schema: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'PayPal order ID' },
        },
        required: ['orderId'],
      },
    },
    {
      name: 'paypal_list_transactions',
      description: 'List PayPal transactions for a date range. Returns payer, amount, status, and transaction IDs.',
      input_schema: {
        type: 'object',
        properties: {
          startDate: { type: 'string', description: 'Start date YYYY-MM-DDT00:00:00Z' },
          endDate:   { type: 'string', description: 'End date YYYY-MM-DDT23:59:59Z' },
          pageSize:  { type: 'number', description: 'Results per page (default 20, max 500)' },
        },
        required: ['startDate', 'endDate'],
      },
    },
    {
      name: 'paypal_list_subscriptions',
      description: 'List PayPal subscriptions by plan ID.',
      input_schema: {
        type: 'object',
        properties: {
          planId: { type: 'string', description: 'PayPal billing plan ID (P-xxxx)' },
          status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'CANCELLED', 'SUSPENDED', 'EXPIRED'], description: 'Filter by status (optional)' },
        },
        required: ['planId'],
      },
    },
  ],

  // ── Square ───────────────────────────────────────────────────────────────────
  square: [
    {
      name: 'square_list_payments',
      description: 'List Square payments with optional date range and status filter.',
      input_schema: {
        type: 'object',
        properties: {
          beginTime: { type: 'string', description: 'Start time in RFC 3339 (e.g. 2024-01-01T00:00:00Z)' },
          endTime:   { type: 'string', description: 'End time RFC 3339 (optional)' },
          sortOrder: { type: 'string', enum: ['ASC', 'DESC'], description: 'Sort order (default DESC)' },
          limit:     { type: 'number', description: 'Max results (default 20, max 100)' },
        },
        required: [],
      },
    },
    {
      name: 'square_list_customers',
      description: 'List Square customers with optional text filter.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search by name or email (optional)' },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
        required: [],
      },
    },
    {
      name: 'square_list_invoices',
      description: 'List Square invoices with optional status filter.',
      input_schema: {
        type: 'object',
        properties: {
          locationId: { type: 'string', description: 'Square location ID (uses configured default if omitted)' },
          limit:      { type: 'number', description: 'Max results (default 20)' },
        },
        required: [],
      },
    },
    {
      name: 'square_create_invoice',
      description: 'Create a Square invoice for a customer.',
      input_schema: {
        type: 'object',
        properties: {
          customerId:  { type: 'string', description: 'Square customer ID' },
          amountCents: { type: 'number', description: 'Invoice amount in cents (e.g. 5000 = $50)' },
          currency:    { type: 'string', description: 'Currency code (default USD)' },
          title:       { type: 'string', description: 'Invoice title' },
          description: { type: 'string', description: 'Invoice line item description' },
          dueDate:     { type: 'string', description: 'Due date YYYY-MM-DD' },
        },
        required: ['customerId', 'amountCents', 'title'],
      },
    },
  ],

  // ── HubSpot ──────────────────────────────────────────────────────────────────
  hubspot: [
    {
      name: 'hubspot_search_contacts',
      description: 'Search HubSpot CRM contacts by email, name, or phone number. Returns contact details including company, job title, and lifecycle stage.',
      input_schema: {
        type: 'object',
        properties: {
          query:  { type: 'string', description: 'Search term: email, name, phone, or company' },
          limit:  { type: 'number', description: 'Max contacts to return (default 20, max 100)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'hubspot_create_contact',
      description: 'Create a new contact in HubSpot CRM with their details.',
      input_schema: {
        type: 'object',
        properties: {
          email:       { type: 'string', description: 'Contact email address' },
          firstName:   { type: 'string', description: 'First name' },
          lastName:    { type: 'string', description: 'Last name' },
          phone:       { type: 'string', description: 'Phone number (optional)' },
          company:     { type: 'string', description: 'Company name (optional)' },
          jobTitle:    { type: 'string', description: 'Job title (optional)' },
          lifecycleStage: { type: 'string', enum: ['lead', 'marketingqualifiedlead', 'salesqualifiedlead', 'opportunity', 'customer'], description: 'CRM lifecycle stage (optional)' },
        },
        required: ['email'],
      },
    },
    {
      name: 'hubspot_get_deals',
      description: 'List HubSpot deals from a pipeline with their stage, amount, and close date.',
      input_schema: {
        type: 'object',
        properties: {
          pipelineId: { type: 'string', description: 'Pipeline ID to filter (optional — omit for all pipelines)' },
          limit:      { type: 'number', description: 'Max deals to return (default 20, max 100)' },
        },
        required: [],
      },
    },
    {
      name: 'hubspot_create_deal',
      description: 'Create a new deal in HubSpot CRM pipeline.',
      input_schema: {
        type: 'object',
        properties: {
          dealName:   { type: 'string', description: 'Name of the deal' },
          amount:     { type: 'number', description: 'Deal value in dollars (optional)' },
          closeDate:  { type: 'string', description: 'Expected close date YYYY-MM-DD (optional)' },
          dealStage:  { type: 'string', description: 'Pipeline stage ID (optional — uses default stage if omitted)' },
          pipelineId: { type: 'string', description: 'Pipeline ID (optional — uses default pipeline if omitted)' },
          contactId:  { type: 'string', description: 'HubSpot contact ID to associate with this deal (optional)' },
        },
        required: ['dealName'],
      },
    },
  ],

  // ── Keap (Infusionsoft) ───────────────────────────────────────────────────────
  keap: [
    {
      name: 'keap_search_contacts',
      description: 'Search Keap CRM contacts by email, name, or phone. Returns contact details and tags.',
      input_schema: {
        type: 'object',
        properties: {
          email:  { type: 'string', description: 'Filter by email address (optional)' },
          name:   { type: 'string', description: 'Filter by name (optional)' },
          limit:  { type: 'number', description: 'Max results (default 20, max 200)' },
        },
        required: [],
      },
    },
    {
      name: 'keap_create_contact',
      description: 'Create a new contact in Keap CRM.',
      input_schema: {
        type: 'object',
        properties: {
          email:     { type: 'string', description: 'Email address' },
          firstName: { type: 'string', description: 'First name' },
          lastName:  { type: 'string', description: 'Last name (optional)' },
          phone:     { type: 'string', description: 'Phone number (optional)' },
          company:   { type: 'string', description: 'Company name (optional)' },
        },
        required: ['email'],
      },
    },
    {
      name: 'keap_add_tag',
      description: 'Apply a tag to a Keap contact to trigger automations or segment your list.',
      input_schema: {
        type: 'object',
        properties: {
          contactId: { type: 'string', description: 'Keap contact ID' },
          tagId:     { type: 'number', description: 'Tag ID to apply' },
        },
        required: ['contactId', 'tagId'],
      },
    },
    {
      name: 'keap_list_tags',
      description: 'List all available tags in your Keap account. Use to find tag IDs for keap_add_tag.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max tags to return (default 100)' },
        },
        required: [],
      },
    },
  ],

  // ── Authorize.net ────────────────────────────────────────────────────────────
  authorizenet: [
    {
      name: 'authorizenet_list_transactions',
      description: 'List recent Authorize.net transactions with their status and amounts.',
      input_schema: {
        type: 'object',
        properties: {
          batchId: { type: 'string', description: 'Settled batch ID to list transactions for (optional — omit for pending)' },
          limit:   { type: 'number', description: 'Max results (default 25)' },
        },
        required: [],
      },
    },
    {
      name: 'authorizenet_get_transaction',
      description: 'Get full details of an Authorize.net transaction by its transaction ID.',
      input_schema: {
        type: 'object',
        properties: {
          transId: { type: 'string', description: 'Authorize.net transaction ID' },
        },
        required: ['transId'],
      },
    },
    {
      name: 'authorizenet_get_settled_batches',
      description: 'List recently settled batches from Authorize.net with date ranges and payment totals.',
      input_schema: {
        type: 'object',
        properties: {
          firstSettlementDate: { type: 'string', description: 'Start date YYYY-MM-DD (optional, defaults to 30 days ago)' },
          lastSettlementDate:  { type: 'string', description: 'End date YYYY-MM-DD (optional, defaults to today)' },
        },
        required: [],
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

  // ── Stripe ───────────────────────────────────────────────────────────────────
  if (toolName === 'stripe_list_customers') {
    const { secretKey } = toolConfigs.stripe || {};
    if (!secretKey) throw new Error('Stripe secret key not configured.');
    const params = { limit: Math.min(input.limit || 20, 100) };
    if (input.email) params.email = input.email;
    const resp = await axios.get('https://api.stripe.com/v1/customers', {
      auth: { username: secretKey, password: '' }, params,
    });
    return resp.data;
  }

  if (toolName === 'stripe_list_payments') {
    const { secretKey } = toolConfigs.stripe || {};
    if (!secretKey) throw new Error('Stripe secret key not configured.');
    const params = { limit: Math.min(input.limit || 20, 100) };
    if (input.status) params.status = input.status;
    if (input.createdAfterDays) {
      params['created[gte]'] = Math.floor((Date.now() - input.createdAfterDays * 86400000) / 1000);
    }
    const resp = await axios.get('https://api.stripe.com/v1/payment_intents', {
      auth: { username: secretKey, password: '' }, params,
    });
    return resp.data;
  }

  if (toolName === 'stripe_list_subscriptions') {
    const { secretKey } = toolConfigs.stripe || {};
    if (!secretKey) throw new Error('Stripe secret key not configured.');
    const params = { limit: Math.min(input.limit || 20, 100), status: input.status || 'active' };
    if (params.status === 'all') delete params.status;
    const resp = await axios.get('https://api.stripe.com/v1/subscriptions', {
      auth: { username: secretKey, password: '' }, params,
    });
    return resp.data;
  }

  if (toolName === 'stripe_create_payment_link') {
    const { secretKey } = toolConfigs.stripe || {};
    if (!secretKey) throw new Error('Stripe secret key not configured.');

    let priceId = input.priceId;

    // If no priceId, create an ad-hoc price
    if (!priceId && input.amount) {
      const priceResp = await axios.post('https://api.stripe.com/v1/prices',
        new URLSearchParams({
          unit_amount: String(input.amount),
          currency:    input.currency || 'usd',
          'product_data[name]': input.productName || 'Product',
        }).toString(),
        { auth: { username: secretKey, password: '' }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      priceId = priceResp.data.id;
    }
    if (!priceId) throw new Error('Provide either priceId or amount + productName to create a payment link.');

    const resp = await axios.post('https://api.stripe.com/v1/payment_links',
      new URLSearchParams({ 'line_items[0][price]': priceId, 'line_items[0][quantity]': String(input.quantity || 1) }).toString(),
      { auth: { username: secretKey, password: '' }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    return { id: resp.data.id, url: resp.data.url, active: resp.data.active };
  }

  if (toolName === 'stripe_get_revenue') {
    const { secretKey } = toolConfigs.stripe || {};
    if (!secretKey) throw new Error('Stripe secret key not configured.');
    const days = input.days || 30;
    const since = Math.floor((Date.now() - days * 86400000) / 1000);
    const resp = await axios.get('https://api.stripe.com/v1/charges', {
      auth: { username: secretKey, password: '' },
      params: { limit: 100, 'created[gte]': since },
    });
    const charges = resp.data.data || [];
    const succeeded = charges.filter(c => c.status === 'succeeded');
    const totalCharged = succeeded.reduce((s, c) => s + c.amount, 0);
    const totalRefunded = succeeded.reduce((s, c) => s + (c.amount_refunded || 0), 0);
    return {
      period:        `Last ${days} days`,
      totalCharged:  `$${(totalCharged / 100).toFixed(2)}`,
      totalRefunded: `$${(totalRefunded / 100).toFixed(2)}`,
      net:           `$${((totalCharged - totalRefunded) / 100).toFixed(2)}`,
      successfulPayments: succeeded.length,
      totalTransactions:  charges.length,
    };
  }

  // ── PayPal ───────────────────────────────────────────────────────────────────

  async function getPayPalToken(clientId, clientSecret, mode) {
    const base = mode === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
    const resp = await axios.post(`${base}/v1/oauth2/token`,
      'grant_type=client_credentials',
      {
        auth: { username: clientId, password: clientSecret },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );
    return { token: resp.data.access_token, base };
  }

  if (toolName === 'paypal_list_orders') {
    const { clientId, clientSecret, mode } = toolConfigs.paypal || {};
    if (!clientId || !clientSecret) throw new Error('PayPal Client ID and Secret not configured.');
    const { token, base } = await getPayPalToken(clientId, clientSecret, mode);
    const params = { start_time: input.startDate };
    if (input.endDate) params.end_time = input.endDate;
    const resp = await axios.get(`${base}/v2/checkout/orders`, {
      headers: { Authorization: `Bearer ${token}` }, params,
    });
    return resp.data;
  }

  if (toolName === 'paypal_get_order') {
    const { clientId, clientSecret, mode } = toolConfigs.paypal || {};
    if (!clientId || !clientSecret) throw new Error('PayPal Client ID and Secret not configured.');
    const { token, base } = await getPayPalToken(clientId, clientSecret, mode);
    const resp = await axios.get(`${base}/v2/checkout/orders/${input.orderId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return resp.data;
  }

  if (toolName === 'paypal_list_transactions') {
    const { clientId, clientSecret, mode } = toolConfigs.paypal || {};
    if (!clientId || !clientSecret) throw new Error('PayPal Client ID and Secret not configured.');
    const { token, base } = await getPayPalToken(clientId, clientSecret, mode);
    const resp = await axios.get(`${base}/v1/reporting/transactions`, {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        start_date:  input.startDate,
        end_date:    input.endDate,
        page_size:   Math.min(input.pageSize || 20, 500),
        fields:      'all',
      },
    });
    return resp.data;
  }

  if (toolName === 'paypal_list_subscriptions') {
    const { clientId, clientSecret, mode } = toolConfigs.paypal || {};
    if (!clientId || !clientSecret) throw new Error('PayPal Client ID and Secret not configured.');
    const { token, base } = await getPayPalToken(clientId, clientSecret, mode);
    const params = { plan_id: input.planId };
    if (input.status) params.status = input.status;
    const resp = await axios.get(`${base}/v1/billing/subscriptions`, {
      headers: { Authorization: `Bearer ${token}` }, params,
    });
    return resp.data;
  }

  // ── Square ───────────────────────────────────────────────────────────────────

  if (toolName === 'square_list_payments') {
    const { accessToken, environment } = toolConfigs.square || {};
    if (!accessToken) throw new Error('Square access token not configured.');
    const base = environment === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
    const params = {
      sort_order: input.sortOrder || 'DESC',
      limit:      Math.min(input.limit || 20, 100),
    };
    if (input.beginTime) params.begin_time = input.beginTime;
    if (input.endTime)   params.end_time   = input.endTime;
    const resp = await axios.get(`${base}/v2/payments`, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Square-Version': '2024-01-18' }, params,
    });
    return resp.data;
  }

  if (toolName === 'square_list_customers') {
    const { accessToken, environment } = toolConfigs.square || {};
    if (!accessToken) throw new Error('Square access token not configured.');
    const base = environment === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
    const body = { limit: Math.min(input.limit || 20, 100) };
    if (input.query) body.query = { filter: { text_filter: { phone_number: input.query } } };
    const resp = await axios.post(`${base}/v2/customers/search`, body, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Square-Version': '2024-01-18', 'Content-Type': 'application/json' },
    });
    return resp.data;
  }

  if (toolName === 'square_list_invoices') {
    const { accessToken, environment, locationId: cfgLocId } = toolConfigs.square || {};
    if (!accessToken) throw new Error('Square access token not configured.');
    const base = environment === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
    const locId = input.locationId || cfgLocId;
    if (!locId) throw new Error('Square location ID not configured. Add it to your Square settings or pass locationId in the call.');
    const params = { location_id: locId, limit: Math.min(input.limit || 20, 200) };
    const resp = await axios.get(`${base}/v2/invoices`, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Square-Version': '2024-01-18' }, params,
    });
    return resp.data;
  }

  if (toolName === 'square_create_invoice') {
    const { accessToken, environment, locationId: cfgLocId } = toolConfigs.square || {};
    if (!accessToken) throw new Error('Square access token not configured.');
    const base = environment === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
    const locId = cfgLocId;
    if (!locId) throw new Error('Square location ID is required. Add it to your Square settings.');

    const body = {
      idempotency_key: `inv-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      invoice: {
        location_id: locId,
        primary_recipient: { customer_id: input.customerId },
        payment_requests: [
          {
            request_type: 'BALANCE',
            due_date: input.dueDate || new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
            tipping_enabled: false,
          },
        ],
        line_items: [
          {
            quantity: '1',
            label: input.description || input.title,
            base_price_money: { amount: input.amountCents, currency: input.currency || 'USD' },
          },
        ],
        title: input.title,
        delivery_method: 'EMAIL',
        invoice_number: `INV-${Date.now().toString().slice(-6)}`,
      },
    };
    const resp = await axios.post(`${base}/v2/invoices`, body, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Square-Version': '2024-01-18', 'Content-Type': 'application/json' },
    });
    return resp.data;
  }

  // ── Authorize.net ─────────────────────────────────────────────────────────────

  if (toolName === 'authorizenet_list_transactions') {
    const { apiLoginId, transactionKey, mode } = toolConfigs.authorizenet || {};
    if (!apiLoginId || !transactionKey) throw new Error('Authorize.net API Login ID and Transaction Key not configured.');
    const host = mode === 'live' ? 'https://api.authorize.net' : 'https://apitest.authorize.net';

    if (input.batchId) {
      const resp = await axios.post(`${host}/xml/v1/request.api`, {
        getTransactionListRequest: {
          merchantAuthentication: { name: apiLoginId, transactionKey },
          batchId: input.batchId,
          paging: { limit: Math.min(input.limit || 25, 1000), offset: 1 },
        },
      });
      return resp.data;
    } else {
      // Get unsettled transactions
      const resp = await axios.post(`${host}/xml/v1/request.api`, {
        getUnsettledTransactionListRequest: {
          merchantAuthentication: { name: apiLoginId, transactionKey },
          paging: { limit: Math.min(input.limit || 25, 1000), offset: 1 },
        },
      });
      return resp.data;
    }
  }

  if (toolName === 'authorizenet_get_transaction') {
    const { apiLoginId, transactionKey, mode } = toolConfigs.authorizenet || {};
    if (!apiLoginId || !transactionKey) throw new Error('Authorize.net API Login ID and Transaction Key not configured.');
    const host = mode === 'live' ? 'https://api.authorize.net' : 'https://apitest.authorize.net';
    const resp = await axios.post(`${host}/xml/v1/request.api`, {
      getTransactionDetailsRequest: {
        merchantAuthentication: { name: apiLoginId, transactionKey },
        transId: input.transId,
      },
    });
    return resp.data;
  }

  if (toolName === 'authorizenet_get_settled_batches') {
    const { apiLoginId, transactionKey, mode } = toolConfigs.authorizenet || {};
    if (!apiLoginId || !transactionKey) throw new Error('Authorize.net API Login ID and Transaction Key not configured.');
    const host = mode === 'live' ? 'https://api.authorize.net' : 'https://apitest.authorize.net';

    const now    = new Date();
    const past30 = new Date(now.getTime() - 30 * 86400000);
    const fmt    = (d) => d.toISOString().split('T')[0] + 'T00:00:00';

    const resp = await axios.post(`${host}/xml/v1/request.api`, {
      getSettledBatchListRequest: {
        merchantAuthentication: { name: apiLoginId, transactionKey },
        firstSettlementDate: input.firstSettlementDate ? `${input.firstSettlementDate}T00:00:00` : fmt(past30),
        lastSettlementDate:  input.lastSettlementDate  ? `${input.lastSettlementDate}T23:59:59`  : fmt(now),
      },
    });
    return resp.data;
  }

  // ── HubSpot ───────────────────────────────────────────────────────────────────

  if (toolName === 'hubspot_search_contacts') {
    const { accessToken } = toolConfigs.hubspot || {};
    if (!accessToken) throw new Error('HubSpot access token not configured.');

    const resp = await axios.post('https://api.hubapi.com/crm/v3/objects/contacts/search', {
      query:      input.query,
      limit:      Math.min(input.limit || 20, 100),
      properties: ['email', 'firstname', 'lastname', 'phone', 'company', 'jobtitle', 'lifecyclestage'],
    }, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    });
    return { contacts: resp.data.results, total: resp.data.total };
  }

  if (toolName === 'hubspot_create_contact') {
    const { accessToken } = toolConfigs.hubspot || {};
    if (!accessToken) throw new Error('HubSpot access token not configured.');

    const properties = { email: input.email };
    if (input.firstName)      properties.firstname       = input.firstName;
    if (input.lastName)       properties.lastname        = input.lastName;
    if (input.phone)          properties.phone           = input.phone;
    if (input.company)        properties.company         = input.company;
    if (input.jobTitle)       properties.jobtitle        = input.jobTitle;
    if (input.lifecycleStage) properties.lifecyclestage  = input.lifecycleStage;

    const resp = await axios.post('https://api.hubapi.com/crm/v3/objects/contacts', { properties }, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    });
    return resp.data;
  }

  if (toolName === 'hubspot_get_deals') {
    const { accessToken } = toolConfigs.hubspot || {};
    if (!accessToken) throw new Error('HubSpot access token not configured.');

    const params = {
      limit: Math.min(input.limit || 20, 100),
      properties: 'dealname,amount,closedate,dealstage,pipeline',
    };
    if (input.pipelineId) params.filterGroups = JSON.stringify([{ filters: [{ propertyName: 'pipeline', operator: 'EQ', value: input.pipelineId }] }]);

    const resp = await axios.get('https://api.hubapi.com/crm/v3/objects/deals', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params,
    });
    return { deals: resp.data.results, total: resp.data.total };
  }

  if (toolName === 'hubspot_create_deal') {
    const { accessToken } = toolConfigs.hubspot || {};
    if (!accessToken) throw new Error('HubSpot access token not configured.');

    const properties = { dealname: input.dealName };
    if (input.amount)     properties.amount    = String(input.amount);
    if (input.closeDate)  properties.closedate = new Date(input.closeDate).getTime();
    if (input.dealStage)  properties.dealstage = input.dealStage;
    if (input.pipelineId) properties.pipeline  = input.pipelineId;

    const body = { properties };
    if (input.contactId) {
      body.associations = [{
        to: { id: input.contactId },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }],
      }];
    }

    const resp = await axios.post('https://api.hubapi.com/crm/v3/objects/deals', body, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    });
    return resp.data;
  }

  // ── Keap ─────────────────────────────────────────────────────────────────────

  if (toolName === 'keap_search_contacts') {
    const { apiKey } = toolConfigs.keap || {};
    if (!apiKey) throw new Error('Keap API key not configured.');

    const params = { limit: Math.min(input.limit || 20, 200) };
    if (input.email) params.email = input.email;
    if (input.name)  params.given_name = input.name;

    const resp = await axios.get('https://api.infusionsoft.com/crm/rest/v1/contacts', {
      headers: { 'X-Keap-API-Key': apiKey },
      params,
    });
    return { contacts: resp.data.contacts, count: resp.data.count };
  }

  if (toolName === 'keap_create_contact') {
    const { apiKey } = toolConfigs.keap || {};
    if (!apiKey) throw new Error('Keap API key not configured.');

    const body = {
      email_addresses: [{ email: input.email, field: 'EMAIL1' }],
    };
    if (input.firstName) body.given_name  = input.firstName;
    if (input.lastName)  body.family_name = input.lastName;
    if (input.phone)     body.phone_numbers = [{ number: input.phone, field: 'PHONE1' }];
    if (input.company)   body.company = { company_name: input.company };

    const resp = await axios.post('https://api.infusionsoft.com/crm/rest/v1/contacts', body, {
      headers: { 'X-Keap-API-Key': apiKey, 'Content-Type': 'application/json' },
    });
    return resp.data;
  }

  if (toolName === 'keap_add_tag') {
    const { apiKey } = toolConfigs.keap || {};
    if (!apiKey) throw new Error('Keap API key not configured.');

    const resp = await axios.post(
      `https://api.infusionsoft.com/crm/rest/v1/contacts/${input.contactId}/tags`,
      { tagIds: [input.tagId] },
      { headers: { 'X-Keap-API-Key': apiKey, 'Content-Type': 'application/json' } }
    );
    return { success: true, status: resp.status };
  }

  if (toolName === 'keap_list_tags') {
    const { apiKey } = toolConfigs.keap || {};
    if (!apiKey) throw new Error('Keap API key not configured.');

    const resp = await axios.get('https://api.infusionsoft.com/crm/rest/v1/tags', {
      headers: { 'X-Keap-API-Key': apiKey },
      params: { limit: Math.min(input.limit || 100, 1000) },
    });
    return { tags: resp.data.tags, count: resp.data.count };
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
  stripe: {
    label:       'Stripe',
    icon:        '💳',
    description: 'Payment processing, subscriptions, invoices and revenue reporting',
    configFields: [
      { key: 'secretKey', label: 'Secret Key', type: 'password', placeholder: 'sk_live_...' },
    ],
  },
  paypal: {
    label:       'PayPal',
    icon:        '🅿️',
    description: 'Orders, subscriptions and transaction reporting via PayPal',
    configFields: [
      { key: 'clientId',     label: 'Client ID',     type: 'text',     placeholder: 'AaBbCc...' },
      { key: 'clientSecret', label: 'Client Secret', type: 'password', placeholder: 'EcFf...' },
      { key: 'mode',         label: 'Mode',          type: 'text',     placeholder: 'live or sandbox' },
    ],
  },
  square: {
    label:       'Square',
    icon:        '⬛',
    description: 'Payments, customers and invoicing via Square',
    configFields: [
      { key: 'accessToken',  label: 'Access Token',  type: 'password', placeholder: 'EAAAl...' },
      { key: 'locationId',   label: 'Location ID',   type: 'text',     placeholder: 'Your Square location ID' },
      { key: 'environment',  label: 'Environment',   type: 'text',     placeholder: 'production or sandbox' },
    ],
  },
  authorizenet: {
    label:       'Authorize.net',
    icon:        '🔐',
    description: 'Transaction listing and reporting via Authorize.net',
    configFields: [
      { key: 'apiLoginId',     label: 'API Login ID',     type: 'text',     placeholder: 'Your API Login ID' },
      { key: 'transactionKey', label: 'Transaction Key',  type: 'password', placeholder: 'Your Transaction Key' },
      { key: 'mode',           label: 'Mode',             type: 'text',     placeholder: 'live or sandbox' },
    ],
  },
  hubspot: {
    label:       'HubSpot',
    icon:        '🟠',
    description: 'CRM contacts, deals and pipeline management via HubSpot',
    configFields: [
      { key: 'accessToken', label: 'Private App Token', type: 'password', placeholder: 'pat-na1-...' },
    ],
  },
  keap: {
    label:       'Keap (Infusionsoft)',
    icon:        '🌀',
    description: 'CRM contacts, tags and automations via Keap',
    configFields: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'Your Keap service account key' },
    ],
  },
};

module.exports = { EXTERNAL_TOOL_DEFINITIONS, TOOL_METADATA, executeExternalTool };
