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
 *   hubspot           — CRM contacts and deals via HubSpot
 *   keap              — CRM contacts, tags and automations via Keap
 *   manychat          — Messenger/SMS automation via ManyChat
 *   google_my_business — Business Profile listings and reviews
 *   shopify           — Orders, products, customers and discounts
 *   woocommerce       — WooCommerce orders, products and coupons
 *   google_calendar   — Calendar events via Google Calendar API
 *   linkedin          — Ads analytics and organic posts via LinkedIn
 *   google_contacts   — Contacts via Google People API
 *   google_forms      — Form responses via Google Forms API
 *   airtable          — Records via Airtable API
 *   monday            — Boards and items via Monday.com
 *   typeform          — Forms and responses via Typeform
 *   asana             — Tasks and projects via Asana
 *   canva             — Designs via Canva Connect API
 *   tiktok_ads        — Campaigns and analytics via TikTok Ads
 *   google_ads        — Campaigns and lead forms via Google Ads
 *   openrouter        — Multi-model AI chat via OpenRouter
 *   gravity_forms     — Form entries via Gravity Forms REST API
 *   http_client       — Generic HTTP request / webhook tester
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

  // ── ManyChat ─────────────────────────────────────────────────────────────────
  manychat: [
    {
      name: 'manychat_find_subscriber',
      description: 'Find a ManyChat subscriber by email or phone number.',
      input_schema: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Subscriber email (optional)' },
          phone: { type: 'string', description: 'Subscriber phone in E.164 format (optional)' },
        },
        required: [],
      },
    },
    {
      name: 'manychat_send_flow',
      description: 'Trigger a ManyChat automation flow for a subscriber.',
      input_schema: {
        type: 'object',
        properties: {
          subscriberId: { type: 'string', description: 'ManyChat subscriber ID' },
          flowNs:       { type: 'string', description: 'Flow namespace (content_xxxxxxxx from flow URL)' },
        },
        required: ['subscriberId', 'flowNs'],
      },
    },
    {
      name: 'manychat_add_tag',
      description: 'Add a tag to a ManyChat subscriber to segment them or trigger automations.',
      input_schema: {
        type: 'object',
        properties: {
          subscriberId: { type: 'string', description: 'ManyChat subscriber ID' },
          tagId:        { type: 'number', description: 'ManyChat tag ID to apply' },
        },
        required: ['subscriberId', 'tagId'],
      },
    },
    {
      name: 'manychat_list_tags',
      description: 'List all tags in the ManyChat account.',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
  ],

  // ── Google Business Profile ───────────────────────────────────────────────────
  google_my_business: [
    {
      name: 'gmb_list_accounts',
      description: 'List Google Business Profile accounts the authenticated user manages.',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'gmb_list_locations',
      description: 'List business locations under a Google Business Profile account.',
      input_schema: {
        type: 'object',
        properties: {
          accountId: { type: 'string', description: 'Account resource name e.g. accounts/123456789' },
        },
        required: ['accountId'],
      },
    },
    {
      name: 'gmb_list_reviews',
      description: 'Get customer reviews for a Google Business Profile location.',
      input_schema: {
        type: 'object',
        properties: {
          locationName: { type: 'string', description: 'Location resource name e.g. accounts/123/locations/456' },
          pageSize:     { type: 'number', description: 'Max reviews (default 20)' },
        },
        required: ['locationName'],
      },
    },
    {
      name: 'gmb_reply_to_review',
      description: 'Post or update a reply to a Google Business Profile review.',
      input_schema: {
        type: 'object',
        properties: {
          reviewName: { type: 'string', description: 'Full review resource name e.g. accounts/123/locations/456/reviews/abc' },
          replyText:  { type: 'string', description: 'Reply text to post' },
        },
        required: ['reviewName', 'replyText'],
      },
    },
  ],

  // ── Shopify ───────────────────────────────────────────────────────────────────
  shopify: [
    {
      name: 'shopify_list_orders',
      description: 'List recent Shopify orders with customer, items and fulfillment status.',
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['open', 'closed', 'cancelled', 'any'], description: 'Order status (default: any)' },
          limit:  { type: 'number', description: 'Max orders (default 20, max 250)' },
        },
        required: [],
      },
    },
    {
      name: 'shopify_list_products',
      description: 'List Shopify products with title, variants, price and inventory.',
      input_schema: {
        type: 'object',
        properties: {
          limit:  { type: 'number', description: 'Max products (default 20, max 250)' },
          status: { type: 'string', enum: ['active', 'archived', 'draft', 'any'], description: 'Product status (default: active)' },
        },
        required: [],
      },
    },
    {
      name: 'shopify_list_customers',
      description: 'List or search Shopify customers.',
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
      name: 'shopify_create_discount',
      description: 'Create a Shopify discount code with percentage or fixed amount off.',
      input_schema: {
        type: 'object',
        properties: {
          code:         { type: 'string', description: 'Discount code (e.g. SAVE20)' },
          discountType: { type: 'string', enum: ['percentage', 'fixed_amount', 'free_shipping'], description: 'Type of discount' },
          value:        { type: 'number', description: 'Discount value (e.g. 20 for 20% or $20)' },
          usageLimit:   { type: 'number', description: 'Max uses (optional)' },
          endsAt:       { type: 'string', description: 'Expiry date ISO 8601 (optional)' },
        },
        required: ['code', 'discountType', 'value'],
      },
    },
  ],

  // ── WooCommerce ───────────────────────────────────────────────────────────────
  woocommerce: [
    {
      name: 'woo_list_orders',
      description: 'List WooCommerce orders with customer, total and status.',
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Order status: pending, processing, completed, cancelled, any (default: any)' },
          limit:  { type: 'number', description: 'Max orders (default 20)' },
        },
        required: [],
      },
    },
    {
      name: 'woo_list_products',
      description: 'List WooCommerce products with price, stock and status.',
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'publish, draft, any (default: publish)' },
          limit:  { type: 'number', description: 'Max products (default 20)' },
          search: { type: 'string', description: 'Search by name (optional)' },
        },
        required: [],
      },
    },
    {
      name: 'woo_list_customers',
      description: 'List or search WooCommerce customers.',
      input_schema: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Filter by email (optional)' },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
        required: [],
      },
    },
    {
      name: 'woo_create_coupon',
      description: 'Create a WooCommerce coupon code.',
      input_schema: {
        type: 'object',
        properties: {
          code:         { type: 'string', description: 'Coupon code' },
          discountType: { type: 'string', enum: ['percent', 'fixed_cart', 'fixed_product'], description: 'Discount type' },
          amount:       { type: 'string', description: 'Discount value as string (e.g. "20")' },
          usageLimit:   { type: 'number', description: 'Max uses (optional)' },
          expiryDate:   { type: 'string', description: 'Expiry YYYY-MM-DD (optional)' },
        },
        required: ['code', 'discountType', 'amount'],
      },
    },
  ],

  // ── Google Calendar ───────────────────────────────────────────────────────────
  google_calendar: [
    {
      name: 'gcal_list_events',
      description: 'List upcoming Google Calendar events in a date range.',
      input_schema: {
        type: 'object',
        properties: {
          timeMin:    { type: 'string', description: 'Start time ISO 8601 (default: now)' },
          timeMax:    { type: 'string', description: 'End time ISO 8601 (optional)' },
          maxResults: { type: 'number', description: 'Max events (default 20)' },
          query:      { type: 'string', description: 'Search text in event title/body (optional)' },
        },
        required: [],
      },
    },
    {
      name: 'gcal_create_event',
      description: 'Create a new Google Calendar event with optional attendees.',
      input_schema: {
        type: 'object',
        properties: {
          summary:       { type: 'string', description: 'Event title' },
          startDateTime: { type: 'string', description: 'Start ISO 8601 (e.g. 2024-06-15T10:00:00-05:00)' },
          endDateTime:   { type: 'string', description: 'End ISO 8601' },
          description:   { type: 'string', description: 'Event description (optional)' },
          location:      { type: 'string', description: 'Location (optional)' },
          attendees:     { type: 'array', items: { type: 'string' }, description: 'Attendee email addresses (optional)' },
        },
        required: ['summary', 'startDateTime', 'endDateTime'],
      },
    },
    {
      name: 'gcal_delete_event',
      description: 'Delete a Google Calendar event by its ID.',
      input_schema: {
        type: 'object',
        properties: {
          eventId: { type: 'string', description: 'Google Calendar event ID' },
        },
        required: ['eventId'],
      },
    },
  ],

  // ── LinkedIn ──────────────────────────────────────────────────────────────────
  linkedin: [
    {
      name: 'linkedin_get_ad_campaigns',
      description: 'List LinkedIn Ads campaign groups with status, budget and dates.',
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ACTIVE', 'PAUSED', 'ARCHIVED', 'ALL'], description: 'Status filter (default: ALL)' },
          limit:  { type: 'number', description: 'Max campaigns (default 20)' },
        },
        required: [],
      },
    },
    {
      name: 'linkedin_get_ad_analytics',
      description: 'Get LinkedIn Ads performance metrics: impressions, clicks, spend.',
      input_schema: {
        type: 'object',
        properties: {
          dateRangeStart: { type: 'string', description: 'Start date YYYY-MM-DD' },
          dateRangeEnd:   { type: 'string', description: 'End date YYYY-MM-DD' },
          pivot:          { type: 'string', enum: ['CAMPAIGN', 'CAMPAIGN_GROUP', 'CREATIVE'], description: 'Breakdown pivot (default: CAMPAIGN)' },
        },
        required: ['dateRangeStart', 'dateRangeEnd'],
      },
    },
    {
      name: 'linkedin_create_post',
      description: 'Publish an organic LinkedIn post on behalf of the authenticated user.',
      input_schema: {
        type: 'object',
        properties: {
          text:       { type: 'string', description: 'Post text content' },
          visibility: { type: 'string', enum: ['PUBLIC', 'CONNECTIONS'], description: 'Post visibility (default: PUBLIC)' },
        },
        required: ['text'],
      },
    },
  ],

  // ── Google Contacts ───────────────────────────────────────────────────────────
  google_contacts: [
    {
      name: 'gcontacts_list_contacts',
      description: 'List Google Contacts for the authenticated user.',
      input_schema: {
        type: 'object',
        properties: {
          pageSize: { type: 'number', description: 'Max contacts (default 50, max 1000)' },
          query:    { type: 'string', description: 'Search query to filter contacts (optional)' },
        },
        required: [],
      },
    },
    {
      name: 'gcontacts_create_contact',
      description: 'Create a new Google Contact.',
      input_schema: {
        type: 'object',
        properties: {
          firstName: { type: 'string', description: 'First name' },
          lastName:  { type: 'string', description: 'Last name (optional)' },
          email:     { type: 'string', description: 'Email address (optional)' },
          phone:     { type: 'string', description: 'Phone number (optional)' },
          company:   { type: 'string', description: 'Company/organization (optional)' },
        },
        required: ['firstName'],
      },
    },
  ],

  // ── Google Forms ──────────────────────────────────────────────────────────────
  google_forms: [
    {
      name: 'gforms_list_forms',
      description: "List Google Forms in the user's Drive.",
      input_schema: {
        type: 'object',
        properties: {
          pageSize: { type: 'number', description: 'Max forms (default 20)' },
        },
        required: [],
      },
    },
    {
      name: 'gforms_get_responses',
      description: 'Get responses submitted to a Google Form.',
      input_schema: {
        type: 'object',
        properties: {
          formId:   { type: 'string', description: 'Google Form ID (from form URL)' },
          pageSize: { type: 'number', description: 'Max responses (default 50)' },
        },
        required: ['formId'],
      },
    },
  ],

  // ── Airtable ──────────────────────────────────────────────────────────────────
  airtable: [
    {
      name: 'airtable_list_records',
      description: 'List records from an Airtable table with optional filter formula.',
      input_schema: {
        type: 'object',
        properties: {
          tableId:       { type: 'string', description: 'Table ID or name' },
          filterFormula: { type: 'string', description: 'Airtable filter formula (optional, e.g. {Status}="Active")' },
          maxRecords:    { type: 'number', description: 'Max records (default 50)' },
          fields:        { type: 'array', items: { type: 'string' }, description: 'Specific field names to return (optional)' },
        },
        required: ['tableId'],
      },
    },
    {
      name: 'airtable_create_record',
      description: 'Create a new record in an Airtable table.',
      input_schema: {
        type: 'object',
        properties: {
          tableId: { type: 'string', description: 'Table ID or name' },
          fields:  { type: 'object', description: 'Field values as key/value pairs matching column names' },
        },
        required: ['tableId', 'fields'],
      },
    },
    {
      name: 'airtable_update_record',
      description: 'Update an existing Airtable record by its record ID.',
      input_schema: {
        type: 'object',
        properties: {
          tableId:  { type: 'string', description: 'Table ID or name' },
          recordId: { type: 'string', description: 'Airtable record ID (recXXXXXXXXXXXXXX)' },
          fields:   { type: 'object', description: 'Fields to update as key/value pairs' },
        },
        required: ['tableId', 'recordId', 'fields'],
      },
    },
    {
      name: 'airtable_search_records',
      description: 'Search Airtable records using a filter formula.',
      input_schema: {
        type: 'object',
        properties: {
          tableId:       { type: 'string', description: 'Table ID or name' },
          filterFormula: { type: 'string', description: 'Airtable formula (e.g. SEARCH("john",{Email}))' },
          maxRecords:    { type: 'number', description: 'Max results (default 25)' },
        },
        required: ['tableId', 'filterFormula'],
      },
    },
  ],

  // ── Monday.com ────────────────────────────────────────────────────────────────
  monday: [
    {
      name: 'monday_list_boards',
      description: 'List Monday.com boards with their name and column structure.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max boards (default 10)' },
        },
        required: [],
      },
    },
    {
      name: 'monday_list_items',
      description: 'List items (rows) in a Monday.com board.',
      input_schema: {
        type: 'object',
        properties: {
          boardId: { type: 'string', description: 'Monday.com board ID' },
          limit:   { type: 'number', description: 'Max items (default 25)' },
        },
        required: ['boardId'],
      },
    },
    {
      name: 'monday_create_item',
      description: 'Create a new item (row) in a Monday.com board.',
      input_schema: {
        type: 'object',
        properties: {
          boardId:      { type: 'string', description: 'Monday.com board ID' },
          itemName:     { type: 'string', description: 'Name of the new item' },
          columnValues: { type: 'object', description: 'Column values as {columnId: value} pairs (optional)' },
          groupId:      { type: 'string', description: 'Group ID (optional — uses default group)' },
        },
        required: ['boardId', 'itemName'],
      },
    },
    {
      name: 'monday_update_item_column',
      description: 'Update a column value on a Monday.com item.',
      input_schema: {
        type: 'object',
        properties: {
          boardId:  { type: 'string', description: 'Monday.com board ID' },
          itemId:   { type: 'string', description: 'Item ID to update' },
          columnId: { type: 'string', description: 'Column ID to update (e.g. "status")' },
          value:    { type: 'object', description: 'New value as JSON (e.g. {"label":"Done"} for status)' },
        },
        required: ['boardId', 'itemId', 'columnId', 'value'],
      },
    },
  ],

  // ── Typeform ──────────────────────────────────────────────────────────────────
  typeform: [
    {
      name: 'typeform_list_forms',
      description: 'List Typeform forms with title and response count.',
      input_schema: {
        type: 'object',
        properties: {
          pageSize: { type: 'number', description: 'Max forms (default 20)' },
        },
        required: [],
      },
    },
    {
      name: 'typeform_get_responses',
      description: 'Retrieve responses submitted to a Typeform form.',
      input_schema: {
        type: 'object',
        properties: {
          formId:   { type: 'string', description: 'Typeform form ID' },
          pageSize: { type: 'number', description: 'Max responses (default 25)' },
          since:    { type: 'string', description: 'Only responses after this ISO date (optional)' },
        },
        required: ['formId'],
      },
    },
    {
      name: 'typeform_get_form',
      description: 'Get the structure and questions of a Typeform form.',
      input_schema: {
        type: 'object',
        properties: {
          formId: { type: 'string', description: 'Typeform form ID' },
        },
        required: ['formId'],
      },
    },
  ],

  // ── Asana ─────────────────────────────────────────────────────────────────────
  asana: [
    {
      name: 'asana_list_projects',
      description: 'List Asana projects in a workspace.',
      input_schema: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string', description: 'Workspace GID (optional — uses first workspace)' },
          limit:       { type: 'number', description: 'Max projects (default 20)' },
        },
        required: [],
      },
    },
    {
      name: 'asana_list_tasks',
      description: 'List tasks in an Asana project.',
      input_schema: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Asana project GID' },
          completed: { type: 'boolean', description: 'Include completed tasks? (default false)' },
          limit:     { type: 'number', description: 'Max tasks (default 25)' },
        },
        required: ['projectId'],
      },
    },
    {
      name: 'asana_create_task',
      description: 'Create a new task in an Asana project.',
      input_schema: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Asana project GID' },
          name:      { type: 'string', description: 'Task name' },
          notes:     { type: 'string', description: 'Task description (optional)' },
          dueOn:     { type: 'string', description: 'Due date YYYY-MM-DD (optional)' },
          assignee:  { type: 'string', description: 'Assignee email or GID (optional)' },
        },
        required: ['projectId', 'name'],
      },
    },
    {
      name: 'asana_complete_task',
      description: 'Mark an Asana task as complete or incomplete.',
      input_schema: {
        type: 'object',
        properties: {
          taskId:    { type: 'string', description: 'Asana task GID' },
          completed: { type: 'boolean', description: 'true to complete, false to reopen (default true)' },
        },
        required: ['taskId'],
      },
    },
  ],

  // ── Canva ─────────────────────────────────────────────────────────────────────
  canva: [
    {
      name: 'canva_list_designs',
      description: 'List Canva designs in the connected account.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max designs (default 20)' },
          query: { type: 'string', description: 'Search by title (optional)' },
        },
        required: [],
      },
    },
    {
      name: 'canva_get_design',
      description: 'Get details and export URLs for a specific Canva design.',
      input_schema: {
        type: 'object',
        properties: {
          designId: { type: 'string', description: 'Canva design ID' },
        },
        required: ['designId'],
      },
    },
  ],

  // ── TikTok Ads ────────────────────────────────────────────────────────────────
  tiktok_ads: [
    {
      name: 'tiktok_list_campaigns',
      description: 'List TikTok Ads campaigns for the configured advertiser.',
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'CAMPAIGN_STATUS_ENABLE, CAMPAIGN_STATUS_DISABLE, or CAMPAIGN_STATUS_ALL (default)' },
          limit:  { type: 'number', description: 'Max campaigns (default 20)' },
        },
        required: [],
      },
    },
    {
      name: 'tiktok_get_ad_insights',
      description: 'Get TikTok Ads performance metrics: spend, impressions, clicks, CTR, conversions.',
      input_schema: {
        type: 'object',
        properties: {
          startDate:  { type: 'string', description: 'Start date YYYY-MM-DD' },
          endDate:    { type: 'string', description: 'End date YYYY-MM-DD' },
          dimensions: { type: 'array', items: { type: 'string' }, description: 'Breakdown dimensions e.g. ["campaign_id"] or ["adgroup_id"]' },
          metrics:    { type: 'array', items: { type: 'string' }, description: 'Metrics to retrieve (optional — defaults to key metrics)' },
        },
        required: ['startDate', 'endDate'],
      },
    },
    {
      name: 'tiktok_list_ad_groups',
      description: 'List TikTok Ads ad groups (ad sets) with optional campaign filter.',
      input_schema: {
        type: 'object',
        properties: {
          campaignId: { type: 'string', description: 'Campaign ID to filter (optional)' },
          limit:      { type: 'number', description: 'Max ad groups (default 20)' },
        },
        required: [],
      },
    },
  ],

  // ── Google Ads ────────────────────────────────────────────────────────────────
  google_ads: [
    {
      name: 'google_ads_list_campaigns',
      description: 'List Google Ads campaigns with status, budget and type.',
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ENABLED', 'PAUSED', 'REMOVED', 'ALL'], description: 'Status filter (default: ENABLED)' },
          limit:  { type: 'number', description: 'Max campaigns (default 20)' },
        },
        required: [],
      },
    },
    {
      name: 'google_ads_get_lead_submissions',
      description: 'Retrieve lead form submissions from Google Ads lead form extensions.',
      input_schema: {
        type: 'object',
        properties: {
          campaignResourceName: { type: 'string', description: 'Campaign resource name (optional — all campaigns if omitted)' },
          limit:                { type: 'number', description: 'Max submissions (default 50)' },
        },
        required: [],
      },
    },
  ],

  // ── OpenRouter ────────────────────────────────────────────────────────────────
  openrouter: [
    {
      name: 'openrouter_chat',
      description: 'Send a message to any AI model via OpenRouter — GPT-4o, Gemini, Llama, Mistral, and 100+ others. Use when you need a different AI model for a task.',
      input_schema: {
        type: 'object',
        properties: {
          model:       { type: 'string', description: 'Model ID e.g. "openai/gpt-4o", "google/gemini-pro-1.5", "meta-llama/llama-3.1-405b-instruct"' },
          messages:    { type: 'array', items: { type: 'object' }, description: 'Messages array: [{role:"user",content:"..."}]' },
          maxTokens:   { type: 'number', description: 'Max tokens in response (optional)' },
          temperature: { type: 'number', description: 'Temperature 0-2 (optional)' },
        },
        required: ['model', 'messages'],
      },
    },
    {
      name: 'openrouter_list_models',
      description: 'List available AI models on OpenRouter with pricing and context length.',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
  ],

  // ── Gravity Forms ─────────────────────────────────────────────────────────────
  gravity_forms: [
    {
      name: 'gf_list_forms',
      description: 'List all Gravity Forms on the WordPress site.',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'gf_get_entries',
      description: 'Get form entries (submissions) from a Gravity Forms form.',
      input_schema: {
        type: 'object',
        properties: {
          formId: { type: 'string', description: 'Gravity Forms form ID' },
          limit:  { type: 'number', description: 'Max entries (default 20)' },
          search: { type: 'string', description: 'Search term (optional)' },
          status: { type: 'string', enum: ['active', 'spam', 'trash'], description: 'Entry status (default: active)' },
        },
        required: ['formId'],
      },
    },
    {
      name: 'gf_get_entry',
      description: 'Get a single Gravity Forms entry by entry ID.',
      input_schema: {
        type: 'object',
        properties: {
          entryId: { type: 'string', description: 'Gravity Forms entry ID' },
        },
        required: ['entryId'],
      },
    },
  ],

  // ── HTTP Client ───────────────────────────────────────────────────────────────
  http_client: [
    {
      name: 'http_send_request',
      description: 'Send an HTTP request to any URL. Use for testing webhooks, calling custom APIs, or any HTTP endpoint not covered by other integrations.',
      input_schema: {
        type: 'object',
        properties: {
          method:  { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], description: 'HTTP method' },
          url:     { type: 'string', description: 'Full URL or path appended to the configured base URL' },
          headers: { type: 'object', description: 'Additional request headers (optional)' },
          body:    { type: 'object', description: 'Request body for POST/PUT/PATCH (optional)' },
          params:  { type: 'object', description: 'URL query parameters (optional)' },
          timeout: { type: 'number', description: 'Timeout in ms (default 10000)' },
        },
        required: ['method', 'url'],
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

  // ── ManyChat ─────────────────────────────────────────────────────────────────

  if (toolName === 'manychat_find_subscriber') {
    const { apiKey } = toolConfigs.manychat || {};
    if (!apiKey) throw new Error('ManyChat API key not configured.');
    const params = {};
    if (input.email) params.email = input.email;
    if (input.phone) params.phone = input.phone;
    if (!input.email && !input.phone) throw new Error('Provide email or phone to find subscriber.');
    const endpoint = input.phone
      ? `https://api.manychat.com/fb/subscriber/findByPhone?phone=${encodeURIComponent(input.phone)}`
      : `https://api.manychat.com/fb/subscriber/findByEmail?email=${encodeURIComponent(input.email)}`;
    const resp = await axios.get(endpoint, { headers: { Authorization: `Bearer ${apiKey}` } });
    return resp.data;
  }

  if (toolName === 'manychat_send_flow') {
    const { apiKey } = toolConfigs.manychat || {};
    if (!apiKey) throw new Error('ManyChat API key not configured.');
    const resp = await axios.post('https://api.manychat.com/fb/sending/sendFlow', {
      subscriber_id: input.subscriberId,
      flow_ns:       input.flowNs,
    }, { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });
    return resp.data;
  }

  if (toolName === 'manychat_add_tag') {
    const { apiKey } = toolConfigs.manychat || {};
    if (!apiKey) throw new Error('ManyChat API key not configured.');
    const resp = await axios.post('https://api.manychat.com/fb/subscriber/addTag', {
      subscriber_id: input.subscriberId,
      tag_id:        input.tagId,
    }, { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });
    return resp.data;
  }

  if (toolName === 'manychat_list_tags') {
    const { apiKey } = toolConfigs.manychat || {};
    if (!apiKey) throw new Error('ManyChat API key not configured.');
    const resp = await axios.get('https://api.manychat.com/fb/page/getTags', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return resp.data;
  }

  // ── Google Business Profile ───────────────────────────────────────────────────

  if (toolName === 'gmb_list_accounts') {
    const { accessToken } = toolConfigs.google_my_business || {};
    if (!accessToken) throw new Error('Google Business Profile access token not configured.');
    const resp = await axios.get('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return resp.data;
  }

  if (toolName === 'gmb_list_locations') {
    const { accessToken } = toolConfigs.google_my_business || {};
    if (!accessToken) throw new Error('Google Business Profile access token not configured.');
    const resp = await axios.get(`https://mybusinessbusinessinformation.googleapis.com/v1/${input.accountId}/locations`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { readMask: 'name,title,phoneNumbers,websiteUri,storefrontAddress' },
    });
    return resp.data;
  }

  if (toolName === 'gmb_list_reviews') {
    const { accessToken } = toolConfigs.google_my_business || {};
    if (!accessToken) throw new Error('Google Business Profile access token not configured.');
    const resp = await axios.get(`https://mybusiness.googleapis.com/v4/${input.locationName}/reviews`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { pageSize: input.pageSize || 20 },
    });
    return resp.data;
  }

  if (toolName === 'gmb_reply_to_review') {
    const { accessToken } = toolConfigs.google_my_business || {};
    if (!accessToken) throw new Error('Google Business Profile access token not configured.');
    const resp = await axios.put(`https://mybusiness.googleapis.com/v4/${input.reviewName}/reply`, {
      comment: input.replyText,
    }, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
    return resp.data;
  }

  // ── Shopify ───────────────────────────────────────────────────────────────────

  if (toolName === 'shopify_list_orders') {
    const { shopDomain, accessToken } = toolConfigs.shopify || {};
    if (!shopDomain || !accessToken) throw new Error('Shopify shop domain and access token not configured.');
    const resp = await axios.get(`https://${shopDomain}/admin/api/2024-01/orders.json`, {
      headers: { 'X-Shopify-Access-Token': accessToken },
      params: { status: input.status || 'any', limit: Math.min(input.limit || 20, 250) },
    });
    return resp.data;
  }

  if (toolName === 'shopify_list_products') {
    const { shopDomain, accessToken } = toolConfigs.shopify || {};
    if (!shopDomain || !accessToken) throw new Error('Shopify shop domain and access token not configured.');
    const params = { limit: Math.min(input.limit || 20, 250) };
    if (input.status && input.status !== 'any') params.status = input.status;
    const resp = await axios.get(`https://${shopDomain}/admin/api/2024-01/products.json`, {
      headers: { 'X-Shopify-Access-Token': accessToken }, params,
    });
    return resp.data;
  }

  if (toolName === 'shopify_list_customers') {
    const { shopDomain, accessToken } = toolConfigs.shopify || {};
    if (!shopDomain || !accessToken) throw new Error('Shopify shop domain and access token not configured.');
    const params = { limit: Math.min(input.limit || 20, 250) };
    if (input.query) params.query = input.query;
    const resp = await axios.get(`https://${shopDomain}/admin/api/2024-01/customers/search.json`, {
      headers: { 'X-Shopify-Access-Token': accessToken }, params,
    });
    return resp.data;
  }

  if (toolName === 'shopify_create_discount') {
    const { shopDomain, accessToken } = toolConfigs.shopify || {};
    if (!shopDomain || !accessToken) throw new Error('Shopify shop domain and access token not configured.');
    const priceRule = {
      title:          input.code,
      target_type:    'line_item',
      target_selection: 'all',
      allocation_method: 'across',
      value_type: input.discountType === 'percentage' ? 'percentage'
        : input.discountType === 'free_shipping'       ? 'fixed_amount'
        : 'fixed_amount',
      value: input.discountType === 'percentage' ? `-${input.value}` : `-${input.value}`,
      customer_selection: 'all',
      starts_at: new Date().toISOString(),
    };
    if (input.endsAt)     priceRule.ends_at      = input.endsAt;
    if (input.usageLimit) priceRule.usage_limit  = input.usageLimit;
    if (input.discountType === 'free_shipping') {
      priceRule.target_type      = 'shipping_line';
      priceRule.value            = '-100.0';
      priceRule.value_type       = 'percentage';
    }
    const prRule = await axios.post(`https://${shopDomain}/admin/api/2024-01/price_rules.json`,
      { price_rule: priceRule },
      { headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' } }
    );
    const ruleId = prRule.data.price_rule.id;
    const code = await axios.post(`https://${shopDomain}/admin/api/2024-01/price_rules/${ruleId}/discount_codes.json`,
      { discount_code: { code: input.code } },
      { headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' } }
    );
    return { priceRule: prRule.data.price_rule, discountCode: code.data.discount_code };
  }

  // ── WooCommerce ───────────────────────────────────────────────────────────────

  if (toolName === 'woo_list_orders') {
    const { siteUrl, consumerKey, consumerSecret } = toolConfigs.woocommerce || {};
    if (!siteUrl || !consumerKey || !consumerSecret) throw new Error('WooCommerce site URL, consumer key and secret not configured.');
    const params = { per_page: Math.min(input.limit || 20, 100) };
    if (input.status && input.status !== 'any') params.status = input.status;
    const resp = await axios.get(`${siteUrl}/wp-json/wc/v3/orders`, {
      auth: { username: consumerKey, password: consumerSecret }, params,
    });
    return resp.data;
  }

  if (toolName === 'woo_list_products') {
    const { siteUrl, consumerKey, consumerSecret } = toolConfigs.woocommerce || {};
    if (!siteUrl || !consumerKey || !consumerSecret) throw new Error('WooCommerce not configured.');
    const params = { per_page: Math.min(input.limit || 20, 100) };
    if (input.status && input.status !== 'any') params.status = input.status;
    if (input.search) params.search = input.search;
    const resp = await axios.get(`${siteUrl}/wp-json/wc/v3/products`, {
      auth: { username: consumerKey, password: consumerSecret }, params,
    });
    return resp.data;
  }

  if (toolName === 'woo_list_customers') {
    const { siteUrl, consumerKey, consumerSecret } = toolConfigs.woocommerce || {};
    if (!siteUrl || !consumerKey || !consumerSecret) throw new Error('WooCommerce not configured.');
    const params = { per_page: Math.min(input.limit || 20, 100) };
    if (input.email) params.email = input.email;
    const resp = await axios.get(`${siteUrl}/wp-json/wc/v3/customers`, {
      auth: { username: consumerKey, password: consumerSecret }, params,
    });
    return resp.data;
  }

  if (toolName === 'woo_create_coupon') {
    const { siteUrl, consumerKey, consumerSecret } = toolConfigs.woocommerce || {};
    if (!siteUrl || !consumerKey || !consumerSecret) throw new Error('WooCommerce not configured.');
    const body = { code: input.code, discount_type: input.discountType, amount: input.amount };
    if (input.usageLimit) body.usage_limit = input.usageLimit;
    if (input.expiryDate) body.date_expires = input.expiryDate;
    const resp = await axios.post(`${siteUrl}/wp-json/wc/v3/coupons`, body, {
      auth: { username: consumerKey, password: consumerSecret },
    });
    return resp.data;
  }

  // ── Google Calendar ───────────────────────────────────────────────────────────

  if (toolName === 'gcal_list_events') {
    const { accessToken, calendarId } = toolConfigs.google_calendar || {};
    if (!accessToken) throw new Error('Google Calendar access token not configured.');
    const calId = calendarId || 'primary';
    const params = {
      maxResults:  input.maxResults || 20,
      singleEvents: true,
      orderBy:     'startTime',
      timeMin:     input.timeMin || new Date().toISOString(),
    };
    if (input.timeMax) params.timeMax = input.timeMax;
    if (input.query)   params.q       = input.query;
    const resp = await axios.get(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`, {
      headers: { Authorization: `Bearer ${accessToken}` }, params,
    });
    return resp.data;
  }

  if (toolName === 'gcal_create_event') {
    const { accessToken, calendarId } = toolConfigs.google_calendar || {};
    if (!accessToken) throw new Error('Google Calendar access token not configured.');
    const calId = calendarId || 'primary';
    const body = {
      summary:     input.summary,
      start:       { dateTime: input.startDateTime },
      end:         { dateTime: input.endDateTime },
    };
    if (input.description) body.description = input.description;
    if (input.location)    body.location    = input.location;
    if (Array.isArray(input.attendees) && input.attendees.length) {
      body.attendees = input.attendees.map(email => ({ email }));
    }
    const resp = await axios.post(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`,
      body,
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );
    return resp.data;
  }

  if (toolName === 'gcal_delete_event') {
    const { accessToken, calendarId } = toolConfigs.google_calendar || {};
    if (!accessToken) throw new Error('Google Calendar access token not configured.');
    const calId = calendarId || 'primary';
    await axios.delete(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${input.eventId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return { success: true, deletedEventId: input.eventId };
  }

  // ── LinkedIn ──────────────────────────────────────────────────────────────────

  if (toolName === 'linkedin_get_ad_campaigns') {
    const { accessToken, adAccountId } = toolConfigs.linkedin || {};
    if (!accessToken) throw new Error('LinkedIn access token not configured.');
    if (!adAccountId) throw new Error('LinkedIn Ad Account ID not configured.');
    const params = {
      q:                              'search',
      'search.account.values[0]':     `urn:li:sponsoredAccount:${adAccountId}`,
      count:                          input.limit || 20,
    };
    if (input.status && input.status !== 'ALL') {
      params['search.status.values[0]'] = input.status;
    }
    const resp = await axios.get('https://api.linkedin.com/v2/adCampaignGroupsV2', {
      headers: { Authorization: `Bearer ${accessToken}`, 'LinkedIn-Version': '202401' },
      params,
    });
    return resp.data;
  }

  if (toolName === 'linkedin_get_ad_analytics') {
    const { accessToken, adAccountId } = toolConfigs.linkedin || {};
    if (!accessToken) throw new Error('LinkedIn access token not configured.');
    if (!adAccountId) throw new Error('LinkedIn Ad Account ID not configured.');
    const [startYear, startMonth, startDay] = input.dateRangeStart.split('-');
    const [endYear, endMonth, endDay]       = input.dateRangeEnd.split('-');
    const params = {
      q:             'analytics',
      pivot:         input.pivot || 'CAMPAIGN',
      dateRange:     `(start:(year:${startYear},month:${startMonth},day:${startDay}),end:(year:${endYear},month:${endMonth},day:${endDay}))`,
      'accounts[0]': `urn:li:sponsoredAccount:${adAccountId}`,
      fields:        'impressions,clicks,costInLocalCurrency,conversions',
    };
    const resp = await axios.get('https://api.linkedin.com/v2/adAnalyticsV2', {
      headers: { Authorization: `Bearer ${accessToken}`, 'LinkedIn-Version': '202401' },
      params,
    });
    return resp.data;
  }

  if (toolName === 'linkedin_create_post') {
    const { accessToken } = toolConfigs.linkedin || {};
    if (!accessToken) throw new Error('LinkedIn access token not configured.');
    // Get own profile ID first
    const me = await axios.get('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const authorUrn = `urn:li:person:${me.data.sub}`;
    const resp = await axios.post('https://api.linkedin.com/v2/ugcPosts', {
      author:           authorUrn,
      lifecycleState:   'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: input.text },
          shareMediaCategory: 'NONE',
        },
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': input.visibility || 'PUBLIC',
      },
    }, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'LinkedIn-Version': '202401' },
    });
    return resp.data;
  }

  // ── Google Contacts ───────────────────────────────────────────────────────────

  if (toolName === 'gcontacts_list_contacts') {
    const { accessToken } = toolConfigs.google_contacts || {};
    if (!accessToken) throw new Error('Google Contacts access token not configured.');
    const params = {
      personFields:  'names,emailAddresses,phoneNumbers,organizations',
      pageSize:      Math.min(input.pageSize || 50, 1000),
    };
    const url = input.query
      ? `https://people.googleapis.com/v1/people:searchContacts?query=${encodeURIComponent(input.query)}&readMask=names,emailAddresses,phoneNumbers`
      : 'https://people.googleapis.com/v1/people/me/connections';
    const resp = await axios.get(url, { headers: { Authorization: `Bearer ${accessToken}` }, params: input.query ? {} : params });
    return resp.data;
  }

  if (toolName === 'gcontacts_create_contact') {
    const { accessToken } = toolConfigs.google_contacts || {};
    if (!accessToken) throw new Error('Google Contacts access token not configured.');
    const body = { names: [{ givenName: input.firstName, familyName: input.lastName || '' }] };
    if (input.email)   body.emailAddresses  = [{ value: input.email }];
    if (input.phone)   body.phoneNumbers    = [{ value: input.phone }];
    if (input.company) body.organizations   = [{ name: input.company }];
    const resp = await axios.post('https://people.googleapis.com/v1/people:createContact', body, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    });
    return resp.data;
  }

  // ── Google Forms ──────────────────────────────────────────────────────────────

  if (toolName === 'gforms_list_forms') {
    const { accessToken } = toolConfigs.google_forms || {};
    if (!accessToken) throw new Error('Google Forms access token not configured.');
    const resp = await axios.get('https://www.googleapis.com/drive/v3/files', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: {
        q:        "mimeType='application/vnd.google-apps.form'",
        pageSize: input.pageSize || 20,
        fields:   'files(id,name,createdTime,modifiedTime)',
      },
    });
    return resp.data;
  }

  if (toolName === 'gforms_get_responses') {
    const { accessToken } = toolConfigs.google_forms || {};
    if (!accessToken) throw new Error('Google Forms access token not configured.');
    const resp = await axios.get(`https://forms.googleapis.com/v1/forms/${input.formId}/responses`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { pageSize: input.pageSize || 50 },
    });
    return resp.data;
  }

  // ── Airtable ──────────────────────────────────────────────────────────────────

  if (toolName === 'airtable_list_records') {
    const { apiKey, baseId } = toolConfigs.airtable || {};
    if (!apiKey || !baseId) throw new Error('Airtable API key and Base ID not configured.');
    const params = { pageSize: Math.min(input.maxRecords || 50, 100) };
    if (input.filterFormula) params.filterByFormula = input.filterFormula;
    if (Array.isArray(input.fields) && input.fields.length) {
      input.fields.forEach((f, i) => { params[`fields[${i}]`] = f; });
    }
    const resp = await axios.get(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(input.tableId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` }, params,
    });
    return resp.data;
  }

  if (toolName === 'airtable_create_record') {
    const { apiKey, baseId } = toolConfigs.airtable || {};
    if (!apiKey || !baseId) throw new Error('Airtable API key and Base ID not configured.');
    const resp = await axios.post(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(input.tableId)}`,
      { fields: input.fields },
      { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } }
    );
    return resp.data;
  }

  if (toolName === 'airtable_update_record') {
    const { apiKey, baseId } = toolConfigs.airtable || {};
    if (!apiKey || !baseId) throw new Error('Airtable API key and Base ID not configured.');
    const resp = await axios.patch(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(input.tableId)}/${input.recordId}`,
      { fields: input.fields },
      { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } }
    );
    return resp.data;
  }

  if (toolName === 'airtable_search_records') {
    const { apiKey, baseId } = toolConfigs.airtable || {};
    if (!apiKey || !baseId) throw new Error('Airtable API key and Base ID not configured.');
    const resp = await axios.get(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(input.tableId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      params: { filterByFormula: input.filterFormula, pageSize: Math.min(input.maxRecords || 25, 100) },
    });
    return resp.data;
  }

  // ── Monday.com ────────────────────────────────────────────────────────────────

  if (toolName === 'monday_list_boards') {
    const { apiToken } = toolConfigs.monday || {};
    if (!apiToken) throw new Error('Monday.com API token not configured.');
    const resp = await axios.post('https://api.monday.com/v2', {
      query: `{ boards(limit: ${input.limit || 10}) { id name description columns { id title type } } }`,
    }, { headers: { Authorization: apiToken, 'Content-Type': 'application/json' } });
    return resp.data?.data;
  }

  if (toolName === 'monday_list_items') {
    const { apiToken } = toolConfigs.monday || {};
    if (!apiToken) throw new Error('Monday.com API token not configured.');
    const resp = await axios.post('https://api.monday.com/v2', {
      query: `{ boards(ids: [${input.boardId}]) { items_page(limit: ${input.limit || 25}) { items { id name column_values { id text value } } } } }`,
    }, { headers: { Authorization: apiToken, 'Content-Type': 'application/json' } });
    return resp.data?.data;
  }

  if (toolName === 'monday_create_item') {
    const { apiToken } = toolConfigs.monday || {};
    if (!apiToken) throw new Error('Monday.com API token not configured.');
    const colVals = input.columnValues ? JSON.stringify(JSON.stringify(input.columnValues)) : '"{}"';
    const groupPart = input.groupId ? `, group_id: "${input.groupId}"` : '';
    const resp = await axios.post('https://api.monday.com/v2', {
      query: `mutation { create_item(board_id: ${input.boardId}, item_name: "${input.itemName}"${groupPart}, column_values: ${colVals}) { id name } }`,
    }, { headers: { Authorization: apiToken, 'Content-Type': 'application/json' } });
    return resp.data?.data;
  }

  if (toolName === 'monday_update_item_column') {
    const { apiToken } = toolConfigs.monday || {};
    if (!apiToken) throw new Error('Monday.com API token not configured.');
    const resp = await axios.post('https://api.monday.com/v2', {
      query: `mutation { change_column_value(board_id: ${input.boardId}, item_id: ${input.itemId}, column_id: "${input.columnId}", value: ${JSON.stringify(JSON.stringify(input.value))}) { id } }`,
    }, { headers: { Authorization: apiToken, 'Content-Type': 'application/json' } });
    return resp.data?.data;
  }

  // ── Typeform ──────────────────────────────────────────────────────────────────

  if (toolName === 'typeform_list_forms') {
    const { accessToken } = toolConfigs.typeform || {};
    if (!accessToken) throw new Error('Typeform access token not configured.');
    const resp = await axios.get('https://api.typeform.com/forms', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { page_size: input.pageSize || 20 },
    });
    return resp.data;
  }

  if (toolName === 'typeform_get_responses') {
    const { accessToken } = toolConfigs.typeform || {};
    if (!accessToken) throw new Error('Typeform access token not configured.');
    const params = { page_size: input.pageSize || 25 };
    if (input.since) params.since = input.since;
    const resp = await axios.get(`https://api.typeform.com/forms/${input.formId}/responses`, {
      headers: { Authorization: `Bearer ${accessToken}` }, params,
    });
    return resp.data;
  }

  if (toolName === 'typeform_get_form') {
    const { accessToken } = toolConfigs.typeform || {};
    if (!accessToken) throw new Error('Typeform access token not configured.');
    const resp = await axios.get(`https://api.typeform.com/forms/${input.formId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return resp.data;
  }

  // ── Asana ─────────────────────────────────────────────────────────────────────

  if (toolName === 'asana_list_projects') {
    const { accessToken } = toolConfigs.asana || {};
    if (!accessToken) throw new Error('Asana access token not configured.');
    let workspaceId = input.workspaceId;
    if (!workspaceId) {
      const ws = await axios.get('https://app.asana.com/api/1.0/workspaces', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      workspaceId = ws.data?.data?.[0]?.gid;
    }
    const resp = await axios.get('https://app.asana.com/api/1.0/projects', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { workspace: workspaceId, limit: input.limit || 20, opt_fields: 'name,notes,due_on,status' },
    });
    return resp.data;
  }

  if (toolName === 'asana_list_tasks') {
    const { accessToken } = toolConfigs.asana || {};
    if (!accessToken) throw new Error('Asana access token not configured.');
    const params = {
      project:    input.projectId,
      limit:      input.limit || 25,
      opt_fields: 'name,notes,due_on,completed,assignee',
    };
    if (!input.completed) params.completed = false;
    const resp = await axios.get('https://app.asana.com/api/1.0/tasks', {
      headers: { Authorization: `Bearer ${accessToken}` }, params,
    });
    return resp.data;
  }

  if (toolName === 'asana_create_task') {
    const { accessToken } = toolConfigs.asana || {};
    if (!accessToken) throw new Error('Asana access token not configured.');
    const body = { data: { name: input.name, projects: [input.projectId] } };
    if (input.notes)    body.data.notes    = input.notes;
    if (input.dueOn)    body.data.due_on   = input.dueOn;
    if (input.assignee) body.data.assignee = input.assignee;
    const resp = await axios.post('https://app.asana.com/api/1.0/tasks', body, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    });
    return resp.data;
  }

  if (toolName === 'asana_complete_task') {
    const { accessToken } = toolConfigs.asana || {};
    if (!accessToken) throw new Error('Asana access token not configured.');
    const resp = await axios.put(`https://app.asana.com/api/1.0/tasks/${input.taskId}`,
      { data: { completed: input.completed !== false } },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );
    return resp.data;
  }

  // ── Canva ─────────────────────────────────────────────────────────────────────

  if (toolName === 'canva_list_designs') {
    const { accessToken } = toolConfigs.canva || {};
    if (!accessToken) throw new Error('Canva access token not configured.');
    const params = { limit: input.limit || 20 };
    if (input.query) params.query = input.query;
    const resp = await axios.get('https://api.canva.com/rest/v1/designs', {
      headers: { Authorization: `Bearer ${accessToken}` }, params,
    });
    return resp.data;
  }

  if (toolName === 'canva_get_design') {
    const { accessToken } = toolConfigs.canva || {};
    if (!accessToken) throw new Error('Canva access token not configured.');
    const resp = await axios.get(`https://api.canva.com/rest/v1/designs/${input.designId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return resp.data;
  }

  // ── TikTok Ads ────────────────────────────────────────────────────────────────

  if (toolName === 'tiktok_list_campaigns') {
    const { accessToken, advertiserId } = toolConfigs.tiktok_ads || {};
    if (!accessToken || !advertiserId) throw new Error('TikTok access token and advertiser ID not configured.');
    const params = {
      advertiser_id: advertiserId,
      page_size:     Math.min(input.limit || 20, 100),
    };
    if (input.status && input.status !== 'CAMPAIGN_STATUS_ALL') {
      params.primary_status = input.status;
    }
    const resp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/campaign/get/', {
      headers: { 'Access-Token': accessToken }, params,
    });
    return resp.data;
  }

  if (toolName === 'tiktok_get_ad_insights') {
    const { accessToken, advertiserId } = toolConfigs.tiktok_ads || {};
    if (!accessToken || !advertiserId) throw new Error('TikTok access token and advertiser ID not configured.');
    const defaultMetrics = ['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'conversions'];
    const resp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/', {
      headers: { 'Access-Token': accessToken },
      params: {
        advertiser_id: advertiserId,
        report_type:   'BASIC',
        data_level:    'AUCTION_CAMPAIGN',
        dimensions:    JSON.stringify(input.dimensions || ['campaign_id']),
        metrics:       JSON.stringify(input.metrics || defaultMetrics),
        start_date:    input.startDate,
        end_date:      input.endDate,
        page_size:     50,
      },
    });
    return resp.data;
  }

  if (toolName === 'tiktok_list_ad_groups') {
    const { accessToken, advertiserId } = toolConfigs.tiktok_ads || {};
    if (!accessToken || !advertiserId) throw new Error('TikTok access token and advertiser ID not configured.');
    const params = { advertiser_id: advertiserId, page_size: Math.min(input.limit || 20, 100) };
    if (input.campaignId) params.campaign_ids = JSON.stringify([input.campaignId]);
    const resp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/adgroup/get/', {
      headers: { 'Access-Token': accessToken }, params,
    });
    return resp.data;
  }

  // ── Google Ads ────────────────────────────────────────────────────────────────

  if (toolName === 'google_ads_list_campaigns') {
    const { accessToken, customerId, developerToken } = toolConfigs.google_ads || {};
    if (!accessToken || !customerId || !developerToken) throw new Error('Google Ads access token, customer ID and developer token not configured.');
    const statusFilter = (!input.status || input.status === 'ALL')
      ? '' : `AND campaign.status = '${input.status}'`;
    const resp = await axios.post(
      `https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:search`,
      { query: `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros FROM campaign WHERE campaign.status != 'REMOVED' ${statusFilter} LIMIT ${input.limit || 20}` },
      { headers: { Authorization: `Bearer ${accessToken}`, 'developer-token': developerToken, 'Content-Type': 'application/json' } }
    );
    return resp.data;
  }

  if (toolName === 'google_ads_get_lead_submissions') {
    const { accessToken, customerId, developerToken } = toolConfigs.google_ads || {};
    if (!accessToken || !customerId || !developerToken) throw new Error('Google Ads not configured.');
    const whereClause = input.campaignResourceName
      ? `WHERE lead_form_submission_data.campaign = '${input.campaignResourceName}'`
      : '';
    const resp = await axios.post(
      `https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:search`,
      { query: `SELECT lead_form_submission_data.id, lead_form_submission_data.form_id, lead_form_submission_data.submission_date_time, lead_form_submission_data.lead_form_submission_fields FROM lead_form_submission_data ${whereClause} LIMIT ${input.limit || 50}` },
      { headers: { Authorization: `Bearer ${accessToken}`, 'developer-token': developerToken, 'Content-Type': 'application/json' } }
    );
    return resp.data;
  }

  // ── OpenRouter ────────────────────────────────────────────────────────────────

  if (toolName === 'openrouter_chat') {
    const { apiKey } = toolConfigs.openrouter || {};
    if (!apiKey) throw new Error('OpenRouter API key not configured.');
    const body = { model: input.model, messages: input.messages };
    if (input.maxTokens)   body.max_tokens  = input.maxTokens;
    if (input.temperature !== undefined) body.temperature = input.temperature;
    const resp = await axios.post('https://openrouter.ai/api/v1/chat/completions', body, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });
    return { content: resp.data.choices[0].message.content, model: resp.data.model, usage: resp.data.usage };
  }

  if (toolName === 'openrouter_list_models') {
    const { apiKey } = toolConfigs.openrouter || {};
    if (!apiKey) throw new Error('OpenRouter API key not configured.');
    const resp = await axios.get('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return resp.data;
  }

  // ── Gravity Forms ─────────────────────────────────────────────────────────────

  if (toolName === 'gf_list_forms') {
    const { siteUrl, consumerKey, consumerSecret } = toolConfigs.gravity_forms || {};
    if (!siteUrl || !consumerKey || !consumerSecret) throw new Error('Gravity Forms site URL, consumer key and secret not configured.');
    const resp = await axios.get(`${siteUrl}/wp-json/gf/v2/forms`, {
      auth: { username: consumerKey, password: consumerSecret },
    });
    return resp.data;
  }

  if (toolName === 'gf_get_entries') {
    const { siteUrl, consumerKey, consumerSecret } = toolConfigs.gravity_forms || {};
    if (!siteUrl || !consumerKey || !consumerSecret) throw new Error('Gravity Forms not configured.');
    const params = {
      'paging[page_size]': Math.min(input.limit || 20, 200),
      'form_ids[0]':       input.formId,
      status:              input.status || 'active',
    };
    if (input.search) params['search[field_filters][0][value]'] = input.search;
    const resp = await axios.get(`${siteUrl}/wp-json/gf/v2/entries`, {
      auth: { username: consumerKey, password: consumerSecret }, params,
    });
    return resp.data;
  }

  if (toolName === 'gf_get_entry') {
    const { siteUrl, consumerKey, consumerSecret } = toolConfigs.gravity_forms || {};
    if (!siteUrl || !consumerKey || !consumerSecret) throw new Error('Gravity Forms not configured.');
    const resp = await axios.get(`${siteUrl}/wp-json/gf/v2/entries/${input.entryId}`, {
      auth: { username: consumerKey, password: consumerSecret },
    });
    return resp.data;
  }

  // ── HTTP Client ───────────────────────────────────────────────────────────────

  if (toolName === 'http_send_request') {
    const { baseUrl, defaultHeaders } = toolConfigs.http_client || {};
    let parsedDefaultHeaders = {};
    try { if (defaultHeaders) parsedDefaultHeaders = JSON.parse(defaultHeaders); } catch { /* ignore */ }

    const url = (input.url.startsWith('http://') || input.url.startsWith('https://'))
      ? input.url
      : `${(baseUrl || '').replace(/\/$/, '')}/${input.url.replace(/^\//, '')}`;

    const config = {
      method:  input.method,
      url,
      headers: { ...parsedDefaultHeaders, ...(input.headers || {}) },
      timeout: input.timeout || 10000,
    };
    if (input.params) config.params = input.params;
    if (input.body && ['POST', 'PUT', 'PATCH'].includes(input.method)) config.data = input.body;

    const resp = await axios(config);
    return { status: resp.status, statusText: resp.statusText, headers: resp.headers, data: resp.data };
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
  manychat: {
    label:       'ManyChat',
    icon:        '💙',
    description: 'Messenger/SMS subscriber automation and flow triggering',
    configFields: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'Your ManyChat API key' },
    ],
  },
  google_my_business: {
    label:       'Google Business Profile',
    icon:        '📍',
    description: 'Manage business listings, reviews and replies',
    configFields: [
      { key: 'accessToken', label: 'OAuth Access Token', type: 'password', placeholder: 'ya29...' },
    ],
  },
  shopify: {
    label:       'Shopify',
    icon:        '🛍️',
    description: 'Orders, products, customers and discount codes',
    configFields: [
      { key: 'shopDomain',  label: 'Shop Domain',        type: 'text',     placeholder: 'mystore.myshopify.com' },
      { key: 'accessToken', label: 'Admin Access Token', type: 'password', placeholder: 'shpat_...' },
    ],
  },
  woocommerce: {
    label:       'WooCommerce',
    icon:        '🛒',
    description: 'Orders, products, customers and coupons via WooCommerce',
    configFields: [
      { key: 'siteUrl',        label: 'Site URL',        type: 'text',     placeholder: 'https://mysite.com' },
      { key: 'consumerKey',    label: 'Consumer Key',    type: 'text',     placeholder: 'ck_...' },
      { key: 'consumerSecret', label: 'Consumer Secret', type: 'password', placeholder: 'cs_...' },
    ],
  },
  google_calendar: {
    label:       'Google Calendar',
    icon:        '📅',
    description: 'List, create and delete Google Calendar events',
    configFields: [
      { key: 'accessToken', label: 'OAuth Access Token', type: 'password', placeholder: 'ya29...' },
      { key: 'calendarId',  label: 'Calendar ID',        type: 'text',     placeholder: 'primary' },
    ],
  },
  linkedin: {
    label:       'LinkedIn',
    icon:        '💼',
    description: 'Ads analytics and organic post publishing via LinkedIn',
    configFields: [
      { key: 'accessToken', label: 'OAuth Access Token', type: 'password', placeholder: 'AQV...' },
      { key: 'adAccountId', label: 'Ad Account ID',      type: 'text',     placeholder: '123456789' },
    ],
  },
  google_contacts: {
    label:       'Google Contacts',
    icon:        '👥',
    description: 'List, search and create Google Contacts via People API',
    configFields: [
      { key: 'accessToken', label: 'OAuth Access Token', type: 'password', placeholder: 'ya29...' },
    ],
  },
  google_forms: {
    label:       'Google Forms',
    icon:        '📋',
    description: 'Retrieve Google Forms structure and responses',
    configFields: [
      { key: 'accessToken', label: 'OAuth Access Token', type: 'password', placeholder: 'ya29...' },
    ],
  },
  airtable: {
    label:       'Airtable',
    icon:        '🗂️',
    description: 'Read, create and update records across Airtable bases',
    configFields: [
      { key: 'apiKey', label: 'Personal Access Token', type: 'password', placeholder: 'patXXXX...' },
      { key: 'baseId', label: 'Base ID',               type: 'text',     placeholder: 'appXXXXXXXXXXXXXX' },
    ],
  },
  monday: {
    label:       'Monday.com',
    icon:        '📌',
    description: 'Manage Monday.com boards, items and status columns',
    configFields: [
      { key: 'apiToken', label: 'API Token', type: 'password', placeholder: 'eyJhbGci...' },
    ],
  },
  typeform: {
    label:       'Typeform',
    icon:        '📝',
    description: 'Fetch forms and collect survey responses via Typeform',
    configFields: [
      { key: 'accessToken', label: 'Personal Access Token', type: 'password', placeholder: 'tfp_...' },
    ],
  },
  asana: {
    label:       'Asana',
    icon:        '✅',
    description: 'List, create and complete Asana tasks and projects',
    configFields: [
      { key: 'accessToken', label: 'Personal Access Token', type: 'password', placeholder: '1/1234...' },
    ],
  },
  canva: {
    label:       'Canva',
    icon:        '🎨',
    description: 'Browse and export Canva designs via Connect API',
    configFields: [
      { key: 'accessToken', label: 'OAuth Access Token', type: 'password', placeholder: 'Your Canva access token' },
    ],
  },
  tiktok_ads: {
    label:       'TikTok Ads',
    icon:        '🎵',
    description: 'TikTok Ads campaigns and performance analytics',
    configFields: [
      { key: 'accessToken',  label: 'Access Token',  type: 'password', placeholder: 'Your TikTok Marketing API token' },
      { key: 'advertiserId', label: 'Advertiser ID', type: 'text',     placeholder: '7123456789012345678' },
    ],
  },
  google_ads: {
    label:       'Google Ads',
    icon:        '📢',
    description: 'Google Ads campaigns and lead form submission data',
    configFields: [
      { key: 'accessToken',    label: 'OAuth Access Token', type: 'password', placeholder: 'ya29...' },
      { key: 'customerId',     label: 'Customer ID',        type: 'text',     placeholder: '1234567890 (no dashes)' },
      { key: 'developerToken', label: 'Developer Token',    type: 'password', placeholder: 'Your Google Ads developer token' },
    ],
  },
  openrouter: {
    label:       'OpenRouter',
    icon:        '🔀',
    description: 'Access 100+ AI models — GPT-4o, Gemini, Llama via one API',
    configFields: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-or-v1-...' },
    ],
  },
  gravity_forms: {
    label:       'Gravity Forms',
    icon:        '⚡',
    description: 'Pull Gravity Forms entries from WordPress sites',
    configFields: [
      { key: 'siteUrl',        label: 'WordPress Site URL', type: 'text',     placeholder: 'https://mysite.com' },
      { key: 'consumerKey',    label: 'Consumer Key',       type: 'text',     placeholder: 'ck_...' },
      { key: 'consumerSecret', label: 'Consumer Secret',    type: 'password', placeholder: 'cs_...' },
    ],
  },
  http_client: {
    label:       'HTTP Client / Webhook Tester',
    icon:        '🌐',
    description: 'Send HTTP requests to any URL — webhooks, custom APIs, testing',
    configFields: [
      { key: 'baseUrl',        label: 'Base URL',        type: 'text', placeholder: 'https://api.example.com' },
      { key: 'defaultHeaders', label: 'Default Headers', type: 'text', placeholder: '{"Authorization":"Bearer token"}' },
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
