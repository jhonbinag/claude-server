export const INTEGRATIONS = [
  {
    key:         'perplexity',
    label:       'Perplexity AI',
    icon:        '🔍',
    color:       'rgba(99,102,241,0.12)',
    description: 'AI-powered web research and real-time information retrieval.',
    docsUrl:     'https://docs.perplexity.ai',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'pplx-...' },
    ],
  },
  {
    key:         'openai',
    label:       'OpenAI',
    icon:        '✨',
    color:       'rgba(16,185,129,0.1)',
    description: 'GPT-4o content generation and DALL-E 3 image creation.',
    docsUrl:     'https://platform.openai.com/api-keys',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-...' },
    ],
  },
  {
    key:         'facebook_ads',
    label:       'Facebook Ads',
    icon:        '📘',
    color:       'rgba(24,119,242,0.1)',
    description: 'Manage campaigns, ad sets, creatives and read Ads Library.',
    docsUrl:     'https://developers.facebook.com/docs/marketing-api',
    fields: [
      { key: 'accessToken', label: 'User Access Token', type: 'password', placeholder: 'EAABs...' },
      { key: 'adAccountId', label: 'Ad Account ID',     type: 'text',     placeholder: 'XXXXXXXXXX (numbers only, without act_ prefix)' },
    ],
  },
  {
    key:         'sendgrid',
    label:       'SendGrid',
    icon:        '📧',
    color:       'rgba(0,168,168,0.1)',
    description: 'Transactional and marketing email delivery at scale.',
    docsUrl:     'https://app.sendgrid.com/settings/api_keys',
    fields: [
      { key: 'apiKey',    label: 'API Key',   type: 'password', placeholder: 'SG...' },
      { key: 'fromEmail', label: 'From Email', type: 'email',    placeholder: 'hello@yourdomain.com' },
      { key: 'fromName',  label: 'From Name',  type: 'text',     placeholder: 'Your Brand' },
    ],
  },
  {
    key:         'slack',
    label:       'Slack',
    icon:        '💬',
    color:       'rgba(74,21,75,0.15)',
    description: 'Send messages and notifications to Slack channels.',
    docsUrl:     'https://api.slack.com/apps',
    fields: [
      { key: 'webhookUrl',     label: 'Incoming Webhook URL', type: 'password', placeholder: 'https://hooks.slack.com/services/...' },
      { key: 'defaultChannel', label: 'Default Channel',      type: 'text',     placeholder: '#general' },
    ],
  },
  {
    key:         'apollo',
    label:       'Apollo.io',
    icon:        '🚀',
    color:       'rgba(249,115,22,0.1)',
    description: 'B2B contact enrichment, lead search and prospecting.',
    docsUrl:     'https://developer.apollo.io',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'Your Apollo API key' },
    ],
  },
  {
    key:         'heygen',
    label:       'HeyGen',
    icon:        '🎬',
    color:       'rgba(168,85,247,0.1)',
    description: 'AI avatar video generation for personalised outreach.',
    docsUrl:     'https://app.heygen.com/settings?nav=API',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'Your HeyGen API key' },
    ],
  },
];

export const INTEGRATION_MAP = Object.fromEntries(INTEGRATIONS.map(i => [i.key, i]));
