/**
 * src/tools/ghlTools.js
 *
 * GHL operations exposed as Claude tool definitions.
 * Each tool has a JSON-schema definition (for Claude) and an executor function
 * that calls GHL via the ghlClient service.
 *
 * Usage:
 *   const { getToolDefinitions, executeGhlTool } = require('./ghlTools');
 *   tools = getToolDefinitions();
 *   result = await executeGhlTool(toolName, toolInput, locationId);
 */

const ghlClient = require('../services/ghlClient');

// ─── Tool Definitions (Claude JSON-schema format) ─────────────────────────────

const TOOL_DEFINITIONS = [

  // ─── Contacts ──────────────────────────────────────────────────────────────

  {
    name: 'search_contacts',
    description: 'Search for contacts in GHL by name, email, or phone. Returns a list of matching contacts with their IDs, tags, and custom fields.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query: name, email address, or phone number',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default 20, max 100)',
        },
      },
      required: ['query'],
    },
  },

  {
    name: 'get_contact',
    description: 'Get full details of a single contact by their GHL contact ID, including all custom fields, tags, and source.',
    input_schema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'GHL contact ID' },
      },
      required: ['contactId'],
    },
  },

  {
    name: 'create_contact',
    description: 'Create a new contact in GHL with name, email, phone, and optional custom fields and tags.',
    input_schema: {
      type: 'object',
      properties: {
        firstName:   { type: 'string', description: "Contact's first name" },
        lastName:    { type: 'string', description: "Contact's last name" },
        email:       { type: 'string', description: "Contact's email address" },
        phone:       { type: 'string', description: "Contact's phone number in E.164 format" },
        tags:        { type: 'array',  items: { type: 'string' }, description: 'Tags to apply' },
        source:      { type: 'string', description: 'Lead source (e.g. "Website", "Referral")' },
        address1:    { type: 'string' },
        city:        { type: 'string' },
        state:       { type: 'string' },
        postalCode:  { type: 'string' },
        country:     { type: 'string', description: 'ISO 2-letter country code' },
        companyName: { type: 'string' },
        customFields: {
          type: 'array',
          description: 'Custom field values',
          items: {
            type: 'object',
            properties: {
              id:    { type: 'string', description: 'Custom field ID' },
              value: { description: 'Field value' },
            },
            required: ['id', 'value'],
          },
        },
      },
      required: [],
    },
  },

  {
    name: 'update_contact',
    description: 'Update an existing contact in GHL. Only provide the fields you want to change.',
    input_schema: {
      type: 'object',
      properties: {
        contactId:   { type: 'string', description: 'GHL contact ID to update' },
        firstName:   { type: 'string' },
        lastName:    { type: 'string' },
        email:       { type: 'string' },
        phone:       { type: 'string' },
        tags:        { type: 'array', items: { type: 'string' } },
        source:      { type: 'string' },
        companyName: { type: 'string' },
        customFields: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id:    { type: 'string' },
              value: {},
            },
            required: ['id', 'value'],
          },
        },
      },
      required: ['contactId'],
    },
  },

  {
    name: 'add_contact_tags',
    description: 'Add one or more tags to a contact in GHL. Tags are used for segmentation and automation triggers.',
    input_schema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'GHL contact ID' },
        tags:      { type: 'array', items: { type: 'string' }, description: 'Tags to add' },
      },
      required: ['contactId', 'tags'],
    },
  },

  {
    name: 'remove_contact_tags',
    description: 'Remove one or more tags from a contact in GHL.',
    input_schema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'GHL contact ID' },
        tags:      { type: 'array', items: { type: 'string' }, description: 'Tags to remove' },
      },
      required: ['contactId', 'tags'],
    },
  },

  {
    name: 'add_contact_note',
    description: 'Add an internal note to a contact record in GHL.',
    input_schema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'GHL contact ID' },
        body:      { type: 'string', description: 'Note content' },
      },
      required: ['contactId', 'body'],
    },
  },

  // ─── Conversations & Messaging ─────────────────────────────────────────────

  {
    name: 'list_conversations',
    description: 'List recent conversations (SMS, email, Facebook, etc.) for the location or filtered by contact.',
    input_schema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'Filter by contact ID (optional)' },
        limit:     { type: 'number', description: 'Max results (default 20)' },
      },
      required: [],
    },
  },

  {
    name: 'send_sms',
    description: 'Send an SMS text message to a contact via GHL.',
    input_schema: {
      type: 'object',
      properties: {
        contactId:      { type: 'string', description: 'GHL contact ID of the recipient' },
        message:        { type: 'string', description: 'SMS message text (max 160 chars for single segment)' },
        conversationId: { type: 'string', description: 'Existing conversation ID (optional — creates new if omitted)' },
      },
      required: ['contactId', 'message'],
    },
  },

  {
    name: 'send_email',
    description: 'Send an email to a contact via GHL conversations. Use for transactional or follow-up emails.',
    input_schema: {
      type: 'object',
      properties: {
        contactId:      { type: 'string', description: 'GHL contact ID of the recipient' },
        subject:        { type: 'string', description: 'Email subject line' },
        body:           { type: 'string', description: 'Email body HTML or plain text' },
        fromName:       { type: 'string', description: 'Sender display name' },
        fromEmail:      { type: 'string', description: 'Sender email address (must be verified in GHL)' },
        conversationId: { type: 'string', description: 'Existing conversation ID (optional)' },
      },
      required: ['contactId', 'subject', 'body'],
    },
  },

  // ─── Opportunities / CRM ───────────────────────────────────────────────────

  {
    name: 'search_opportunities',
    description: 'Search opportunities (deals) in the GHL pipeline by contact, stage, or status.',
    input_schema: {
      type: 'object',
      properties: {
        query:      { type: 'string',  description: 'Search text' },
        pipelineId: { type: 'string',  description: 'Filter by pipeline ID (optional)' },
        stageId:    { type: 'string',  description: 'Filter by stage ID (optional)' },
        status:     { type: 'string',  enum: ['open', 'won', 'lost', 'abandoned'], description: 'Filter by status' },
        limit:      { type: 'number',  description: 'Max results (default 20)' },
      },
      required: [],
    },
  },

  {
    name: 'create_opportunity',
    description: 'Create a new opportunity/deal in the GHL pipeline for a contact.',
    input_schema: {
      type: 'object',
      properties: {
        pipelineId:    { type: 'string', description: 'Pipeline ID to add the opportunity to' },
        pipelineStageId: { type: 'string', description: 'Stage ID within the pipeline' },
        contactId:     { type: 'string', description: 'GHL contact ID associated with this deal' },
        name:          { type: 'string', description: 'Opportunity name/title' },
        monetaryValue: { type: 'number', description: 'Deal value in dollars' },
        status:        { type: 'string', enum: ['open', 'won', 'lost', 'abandoned'], description: 'Deal status' },
        assignedTo:    { type: 'string', description: 'User ID to assign the opportunity to' },
      },
      required: ['pipelineId', 'pipelineStageId', 'contactId', 'name'],
    },
  },

  {
    name: 'update_opportunity',
    description: 'Update an existing opportunity in GHL (change stage, value, status, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        opportunityId:   { type: 'string', description: 'Opportunity ID to update' },
        pipelineStageId: { type: 'string', description: 'Move to this stage' },
        monetaryValue:   { type: 'number', description: 'Updated deal value' },
        status:          { type: 'string', enum: ['open', 'won', 'lost', 'abandoned'] },
        name:            { type: 'string' },
      },
      required: ['opportunityId'],
    },
  },

  // ─── Calendars & Appointments ──────────────────────────────────────────────

  {
    name: 'list_calendars',
    description: 'List all calendars available in the GHL location.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },

  {
    name: 'list_appointments',
    description: 'List upcoming appointments for a calendar or contact within a date range.',
    input_schema: {
      type: 'object',
      properties: {
        calendarId: { type: 'string', description: 'Calendar ID (optional — returns all if omitted)' },
        contactId:  { type: 'string', description: 'Filter by contact ID (optional)' },
        startTime:  { type: 'string', description: 'ISO 8601 start date (e.g. 2024-01-01T00:00:00Z)' },
        endTime:    { type: 'string', description: 'ISO 8601 end date (e.g. 2024-01-31T23:59:59Z)' },
      },
      required: [],
    },
  },

  // ─── Campaigns ─────────────────────────────────────────────────────────────

  {
    name: 'list_campaigns',
    description: 'List all campaigns in the GHL location with their status and type.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'inactive', 'draft'], description: 'Filter by status (optional)' },
      },
      required: [],
    },
  },

  // ─── Workflows ─────────────────────────────────────────────────────────────

  {
    name: 'list_workflows',
    description: 'List all automation workflows in the GHL location.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },

  {
    name: 'add_contact_to_workflow',
    description: 'Enroll a contact into a GHL automation workflow. This triggers the workflow for the contact.',
    input_schema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID to enroll the contact in' },
        contactId:  { type: 'string', description: 'GHL contact ID to enroll' },
        eventStartTime: { type: 'string', description: 'ISO 8601 start time (optional)' },
      },
      required: ['workflowId', 'contactId'],
    },
  },

  // ─── Social Planner ────────────────────────────────────────────────────────

  {
    name: 'create_social_post',
    description: 'Schedule a social media post on connected social accounts via GHL Social Planner.',
    input_schema: {
      type: 'object',
      properties: {
        summary:       { type: 'string', description: 'Caption / post text' },
        status:        { type: 'string', enum: ['DRAFT', 'SCHEDULED', 'NOW'], description: 'Post status — use NOW to post immediately, SCHEDULED to set a time' },
        scheduledDate: { type: 'string', description: 'ISO 8601 date/time to post (required if status is SCHEDULED)' },
        accountIds:    { type: 'array', items: { type: 'string' }, description: 'Social account IDs to post to (get from list_social_accounts)' },
      },
      required: ['summary', 'status'],
    },
  },

  {
    name: 'list_social_accounts',
    description: 'List all connected social media accounts in the GHL location (Facebook, Instagram, Google, etc.).',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },

  // ─── Blogs ─────────────────────────────────────────────────────────────────

  {
    name: 'list_blogs',
    description: 'List blog sites configured in the GHL location.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },

  {
    name: 'create_blog_post',
    description: `Create a new blog post / website page in GHL using native page-builder element format (NOT raw HTML). Build the post body as an array of sections using the same element types as create_funnel_page: headline, subheadline, text, image, button, bullets, testimonial, columns, divider, spacer. For a blog article structure the sections as:
1. Intro section (bgColor white): subheadline (article intro paragraph as 'text' element)
2. Featured image section: image element with the uploaded GHL media URL
3. Body sections: alternate text + image + bullets as needed for the article content
4. CTA section: headline "Ready to get started?" + button pointing to opt-in page or contact
Example text element: { type:"text", text:"Your paragraph here...", color:"#374151" }`,
    input_schema: {
      type: 'object',
      properties: {
        title:       { type: 'string', description: 'Blog post / page title' },
        sections: {
          type: 'array',
          description: 'Post body as GHL native element sections (same format as create_funnel_page sections)',
          items: {
            type: 'object',
            properties: {
              bgColor:  { type: 'string' },
              padding:  { type: 'string' },
              id:       { type: 'string' },
              elements: { type: 'array' },
            },
          },
        },
        status:      { type: 'string', enum: ['DRAFT', 'PUBLISHED'], description: 'Publication status' },
        imageUrl:    { type: 'string', description: 'Featured image URL shown at top of post (use GHL media URL from upload_media)' },
        description: { type: 'string', description: 'SEO meta description' },
        author:      { type: 'string', description: 'Author name' },
        categories:  { type: 'array', items: { type: 'string' }, description: 'Category IDs' },
        tags:        { type: 'array', items: { type: 'string' }, description: 'Blog tags' },
      },
      required: ['title', 'sections', 'status'],
    },
  },

  // ─── Location ──────────────────────────────────────────────────────────────

  {
    name: 'get_location',
    description: 'Get details of the current GHL sub-account/location (name, address, timezone, phone, etc.).',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },

  {
    name: 'list_users',
    description: 'List all users (team members) in the GHL location.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },

  // ─── Custom Objects ────────────────────────────────────────────────────────

  {
    name: 'list_custom_objects',
    description: 'List all custom object schemas defined in the GHL location (beyond standard contact/opportunity fields).',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },

  // ─── Forms & Surveys ───────────────────────────────────────────────────────

  {
    name: 'list_forms',
    description: 'List all forms created in the GHL location.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },

  {
    name: 'list_surveys',
    description: 'List all surveys in the GHL location.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },

  // ─── Products & Payments ───────────────────────────────────────────────────

  {
    name: 'list_products',
    description: 'List products available in the GHL location store.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
      required: [],
    },
  },

  {
    name: 'list_invoices',
    description: 'List invoices in the GHL location, optionally filtered by contact.',
    input_schema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'Filter invoices by contact ID (optional)' },
        status:    { type: 'string', description: 'Filter by status: draft, sent, paid, void, partially_paid' },
      },
      required: [],
    },
  },

  // ─── Knowledge Base ────────────────────────────────────────────────────────

  {
    name: 'list_knowledge_bases',
    description: 'List all knowledge bases (AI chatbot training data sources) in the GHL location.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },

  // ─── Media Library ─────────────────────────────────────────────────────────

  {
    name: 'upload_media',
    description: 'Upload an image or file to the GHL media library from a public URL. Use this after generating images with openai_generate_image to store them in GHL for use in funnels, emails, blog posts, and social posts. Returns the hosted GHL media URL.',
    input_schema: {
      type: 'object',
      properties: {
        url:      { type: 'string', description: 'Public URL of the image or file to upload (e.g. DALL-E image URL)' },
        name:     { type: 'string', description: 'File name to save it as in GHL (e.g. "hero-banner.png")' },
        folderId: { type: 'string', description: 'Optional folder ID in the GHL media library' },
      },
      required: ['url', 'name'],
    },
  },

  // ─── Funnels & Pages ───────────────────────────────────────────────────────

  {
    name: 'list_funnels',
    description: 'List all funnels in the GHL location. Returns funnel IDs, names, and domain info. Use funnelId when creating new pages inside a funnel.',
    input_schema: {
      type: 'object',
      properties: {
        limit:  { type: 'number', description: 'Max results (default 20)' },
        offset: { type: 'number', description: 'Pagination offset' },
      },
      required: [],
    },
  },

  {
    name: 'list_funnel_pages',
    description: 'List all pages inside a specific funnel. Returns page IDs, names, URLs, and step order. Use this to understand the existing funnel structure before adding pages.',
    input_schema: {
      type: 'object',
      properties: {
        funnelId: { type: 'string', description: 'GHL funnel ID (get from list_funnels)' },
      },
      required: ['funnelId'],
    },
  },

  {
    name: 'create_funnel_page',
    description: `Create a new page inside an existing GHL funnel using GHL's native page-builder element format (NOT raw HTML). ALWAYS call list_funnels first to get the funnelId. Build the page as an array of "sections", each containing an array of "elements" using the types: headline, subheadline, text, image, button, form, video, divider, spacer, bullets, testimonial, columns. Example element types:
- headline: { type:"headline", text:"...", level:"h1"|"h2", color:"#fff", align:"center"|"left" }
- subheadline: { type:"subheadline", text:"...", color:"#ccc", align:"center" }
- text: { type:"text", text:"...", color:"#333" }
- image: { type:"image", url:"https://...", alt:"...", width:"100%", align:"center" }
- button: { type:"button", text:"Get Started", href:"#form", bgColor:"#ff6b35", color:"#fff", size:"large", align:"center" }
- form: { type:"form", fields:["firstName","lastName","email","phone"], submitText:"Submit", submitBgColor:"#4f46e5" }
- divider: { type:"divider", color:"#e5e7eb" }
- spacer: { type:"spacer", height:"40px" }
- bullets: { type:"bullets", items:["Benefit 1","Benefit 2","Benefit 3"], color:"#333", checkColor:"#4f46e5" }
- testimonial: { type:"testimonial", quote:"...", author:"Jane D.", role:"CEO", avatar:"https://..." }
- columns: { type:"columns", count:2|3, elements:[...] } — wraps child elements in equal-width columns
Section wrapper: { bgColor:"#1a1a2e", padding:"80px 40px", elements:[...] }`,
    input_schema: {
      type: 'object',
      properties: {
        funnelId:    { type: 'string',  description: 'GHL funnel ID to add the page to (from list_funnels)' },
        name:        { type: 'string',  description: 'Page name, e.g. "Opt-in Page", "Sales Page", "Thank You"' },
        url:         { type: 'string',  description: 'URL slug, e.g. "opt-in", "sales", "thank-you" (no slashes)' },
        title:       { type: 'string',  description: 'Browser tab title and SEO title' },
        description: { type: 'string',  description: 'Meta description for SEO' },
        keywords:    { type: 'string',  description: 'Meta keywords for SEO' },
        sections: {
          type: 'array',
          description: 'Array of page sections using GHL native element format. Each section has bgColor, padding, and elements array.',
          items: {
            type: 'object',
            properties: {
              bgColor:  { type: 'string',  description: 'Section background color (hex or rgba), e.g. "#ffffff"' },
              padding:  { type: 'string',  description: 'Section padding, e.g. "80px 40px"' },
              id:       { type: 'string',  description: 'Optional anchor id, e.g. "form" for #form links' },
              elements: { type: 'array',   description: 'Array of element objects (headline, text, image, button, form, etc.)' },
            },
          },
        },
        stepOrder:   { type: 'number',  description: 'Step number in the funnel (1 = first/entry page)' },
        published:   { type: 'boolean', description: 'Publish immediately (default true)' },
      },
      required: ['funnelId', 'name', 'url', 'sections'],
    },
  },

  {
    name: 'update_funnel_page',
    description: 'Update an existing GHL funnel page — replace sections/elements, change title, or publish status. Get pageId from list_funnel_pages. Use the same sections+elements format as create_funnel_page.',
    input_schema: {
      type: 'object',
      properties: {
        pageId:      { type: 'string',  description: 'GHL funnel page ID (from list_funnel_pages)' },
        name:        { type: 'string',  description: 'Updated page name' },
        title:       { type: 'string',  description: 'Updated SEO title' },
        description: { type: 'string',  description: 'Updated meta description' },
        sections:    { type: 'array',   description: 'Updated sections array (same format as create_funnel_page)' },
        published:   { type: 'boolean', description: 'Publish or unpublish the page' },
      },
      required: ['pageId'],
    },
  },

];

// ─── GHL Page Builder: elements → HTML ───────────────────────────────────────

function renderElement(el) {
  if (!el || !el.type) return '';
  const align = el.align || 'center';
  const color = el.color || '#333333';

  switch (el.type) {
    case 'headline': {
      const tag = el.level || 'h1';
      const fs  = tag === 'h1' ? '2.5rem' : tag === 'h2' ? '2rem' : '1.5rem';
      return `<${tag} style="color:${color};text-align:${align};font-size:${fs};font-weight:700;line-height:1.2;margin:0 0 16px">${el.text || ''}</${tag}>`;
    }
    case 'subheadline':
      return `<p style="color:${color};text-align:${align};font-size:1.25rem;margin:0 0 20px;opacity:0.85">${el.text || ''}</p>`;
    case 'text':
      return `<p style="color:${color};text-align:${el.align || 'left'};font-size:1rem;line-height:1.7;margin:0 0 16px">${el.text || ''}</p>`;
    case 'image': {
      const w = el.width || '100%';
      const imgAlign = el.align === 'center' ? 'margin:0 auto;display:block' : el.align === 'right' ? 'margin-left:auto;display:block' : '';
      return `<img src="${el.url || ''}" alt="${el.alt || ''}" style="max-width:${w};height:auto;border-radius:8px;${imgAlign}" />`;
    }
    case 'button': {
      const bg   = el.bgColor || '#4f46e5';
      const tc   = el.color   || '#ffffff';
      const fs   = el.size === 'large' ? '1.1rem' : el.size === 'small' ? '0.875rem' : '1rem';
      const pad  = el.size === 'large' ? '18px 40px' : el.size === 'small' ? '10px 20px' : '14px 32px';
      const wrap = el.align === 'center' ? 'text-align:center' : el.align === 'right' ? 'text-align:right' : '';
      return `<div style="${wrap};margin:20px 0"><a href="${el.href || '#'}" style="display:inline-block;background:${bg};color:${tc};font-size:${fs};font-weight:700;padding:${pad};border-radius:8px;text-decoration:none;letter-spacing:0.3px">${el.text || 'Click Here'}</a></div>`;
    }
    case 'form': {
      const fields = (el.fields || ['firstName', 'lastName', 'email', 'phone']);
      const fieldMap = { firstName: 'First Name', lastName: 'Last Name', email: 'Email Address', phone: 'Phone Number', company: 'Company', message: 'Message' };
      const inputs = fields.map(f =>
        `<div style="margin-bottom:12px"><label style="display:block;font-size:0.875rem;font-weight:600;margin-bottom:4px;color:#374151">${fieldMap[f] || f}</label><input type="${f === 'email' ? 'email' : 'text'}" name="${f}" placeholder="${fieldMap[f] || f}" style="width:100%;padding:12px 16px;border:1px solid #d1d5db;border-radius:6px;font-size:1rem;box-sizing:border-box" /></div>`
      ).join('');
      const btnBg = el.submitBgColor || '#4f46e5';
      return `<form style="max-width:480px;margin:0 auto;background:#f9fafb;padding:32px;border-radius:12px">${inputs}<button type="submit" style="width:100%;background:${btnBg};color:#fff;font-size:1.05rem;font-weight:700;padding:14px;border:none;border-radius:8px;cursor:pointer">${el.submitText || 'Submit'}</button></form>`;
    }
    case 'video': {
      const src = el.url || '';
      const embed = src.includes('youtube') || src.includes('youtu.be')
        ? `<iframe width="100%" height="480" src="${src.replace('watch?v=', 'embed/')}" frameborder="0" allowfullscreen style="border-radius:8px"></iframe>`
        : `<video controls style="width:100%;border-radius:8px"><source src="${src}" /></video>`;
      return `<div style="max-width:800px;margin:0 auto">${embed}</div>`;
    }
    case 'divider':
      return `<hr style="border:none;border-top:2px solid ${el.color || '#e5e7eb'};margin:32px 0" />`;
    case 'spacer':
      return `<div style="height:${el.height || '40px'}"></div>`;
    case 'bullets': {
      const items = (el.items || []).map(item =>
        `<li style="padding:6px 0;color:${color};font-size:1rem;display:flex;align-items:flex-start;gap:10px"><span style="color:${el.checkColor || '#4f46e5'};font-weight:700;flex-shrink:0">✓</span><span>${item}</span></li>`
      ).join('');
      return `<ul style="list-style:none;padding:0;margin:0 0 24px">${items}</ul>`;
    }
    case 'testimonial': {
      const avatar = el.avatar ? `<img src="${el.avatar}" alt="${el.author || ''}" style="width:56px;height:56px;border-radius:50%;object-fit:cover;margin-right:12px" />` : '';
      return `<div style="background:#f9fafb;border-left:4px solid #4f46e5;border-radius:8px;padding:28px;max-width:600px;margin:0 auto 24px">
  <p style="font-size:1.1rem;font-style:italic;color:#1f2937;margin:0 0 16px">"${el.quote || ''}"</p>
  <div style="display:flex;align-items:center">${avatar}<div><strong style="color:#1f2937">${el.author || ''}</strong>${el.role ? `<div style="font-size:0.875rem;color:#6b7280">${el.role}</div>` : ''}</div></div>
</div>`;
    }
    case 'columns': {
      const cols    = el.count || 2;
      const colW    = `${Math.floor(100 / cols)}%`;
      const children = (el.elements || []).map(c => `<div style="flex:0 0 ${colW};max-width:${colW};padding:0 16px;box-sizing:border-box">${renderElement(c)}</div>`).join('');
      return `<div style="display:flex;flex-wrap:wrap;margin:0 -16px">${children}</div>`;
    }
    default:
      return '';
  }
}

function buildPageHtml(sections) {
  if (!Array.isArray(sections) || sections.length === 0) return '';
  return sections.map(sec => {
    const bg      = sec.bgColor  || '#ffffff';
    const padding = sec.padding  || '60px 40px';
    const id      = sec.id       ? ` id="${sec.id}"` : '';
    const inner   = (sec.elements || []).map(renderElement).join('\n');
    return `<section${id} style="background:${bg};padding:${padding}">
  <div style="max-width:960px;margin:0 auto">
${inner}
  </div>
</section>`;
  }).join('\n');
}

// ─── Tool Executors ───────────────────────────────────────────────────────────

/**
 * Execute a GHL tool call by name, using the GHL client for a specific location.
 * @param {string} toolName
 * @param {object} input  - Claude-provided tool input
 * @param {string} locationId
 * @param {string} companyId
 * @returns {Promise<object>} GHL API response
 */
async function executeGhlTool(toolName, input, locationId, companyId) {
  const call = (method, path, body = null, params = {}) =>
    ghlClient.request(locationId, method, path, body, params);

  switch (toolName) {

    // ── Contacts ──────────────────────────────────────────────────────────────

    case 'search_contacts':
      return call('GET', '/contacts/', null, {
        locationId,
        query: input.query,
        limit: input.limit || 20,
      });

    case 'get_contact':
      return call('GET', `/contacts/${input.contactId}`);

    case 'create_contact':
      return call('POST', '/contacts/', { locationId, ...input });

    case 'update_contact': {
      const { contactId, ...fields } = input;
      return call('PUT', `/contacts/${contactId}`, fields);
    }

    case 'add_contact_tags':
      return call('POST', `/contacts/${input.contactId}/tags`, { tags: input.tags });

    case 'remove_contact_tags':
      return call('DELETE', `/contacts/${input.contactId}/tags`, { tags: input.tags });

    case 'add_contact_note':
      return call('POST', `/contacts/${input.contactId}/notes`, {
        body:   input.body,
        userId: '',
      });

    // ── Conversations ─────────────────────────────────────────────────────────

    case 'list_conversations':
      return call('GET', '/conversations/', null, {
        locationId,
        contactId: input.contactId,
        limit:     input.limit || 20,
      });

    case 'send_sms': {
      // Get or create a conversation first, then send message
      const convParams = { locationId, contactId: input.contactId, limit: 1 };
      let conversationId = input.conversationId;
      if (!conversationId) {
        const convRes = await call('GET', '/conversations/', null, convParams);
        const convs   = convRes?.conversations || convRes?.data || [];
        if (convs.length > 0) {
          conversationId = convs[0].id;
        } else {
          const newConv  = await call('POST', '/conversations/', { locationId, contactId: input.contactId });
          conversationId = newConv?.conversation?.id || newConv?.id;
        }
      }
      return call('POST', `/conversations/${conversationId}/messages`, {
        type:    'SMS',
        message: input.message,
      });
    }

    case 'send_email': {
      let conversationId = input.conversationId;
      if (!conversationId) {
        const convRes = await call('GET', '/conversations/', null, {
          locationId, contactId: input.contactId, limit: 1,
        });
        const convs = convRes?.conversations || convRes?.data || [];
        if (convs.length > 0) {
          conversationId = convs[0].id;
        } else {
          const newConv  = await call('POST', '/conversations/', { locationId, contactId: input.contactId });
          conversationId = newConv?.conversation?.id || newConv?.id;
        }
      }
      return call('POST', `/conversations/${conversationId}/messages`, {
        type:      'Email',
        subject:   input.subject,
        html:      input.body,
        fromName:  input.fromName,
        from:      input.fromEmail,
      });
    }

    // ── Opportunities ─────────────────────────────────────────────────────────

    case 'search_opportunities':
      return call('GET', '/opportunities/search', null, {
        location_id: locationId,
        query:       input.query,
        pipeline_id: input.pipelineId,
        stage_id:    input.stageId,
        status:      input.status,
        limit:       input.limit || 20,
      });

    case 'create_opportunity':
      return call('POST', '/opportunities/', {
        locationId,
        pipelineId:      input.pipelineId,
        pipelineStageId: input.pipelineStageId,
        contactId:       input.contactId,
        name:            input.name,
        monetaryValue:   input.monetaryValue,
        status:          input.status || 'open',
        assignedTo:      input.assignedTo,
      });

    case 'update_opportunity': {
      const { opportunityId, ...oppFields } = input;
      return call('PUT', `/opportunities/${opportunityId}`, oppFields);
    }

    // ── Calendars ─────────────────────────────────────────────────────────────

    case 'list_calendars':
      return call('GET', '/calendars/', null, { locationId });

    case 'list_appointments':
      return call('GET', '/calendars/events', null, {
        locationId,
        calendarId: input.calendarId,
        contactId:  input.contactId,
        startTime:  input.startTime,
        endTime:    input.endTime,
      });

    // ── Campaigns ─────────────────────────────────────────────────────────────

    case 'list_campaigns':
      return call('GET', '/campaigns/', null, {
        locationId,
        status: input.status,
      });

    // ── Workflows ─────────────────────────────────────────────────────────────

    case 'list_workflows':
      return call('GET', '/workflows/', null, { locationId });

    case 'add_contact_to_workflow':
      return call('POST', `/workflows/${input.workflowId}/subscribe`, {
        contactId:      input.contactId,
        eventStartTime: input.eventStartTime,
      });

    // ── Social Planner ────────────────────────────────────────────────────────

    case 'list_social_accounts':
      return call('GET', '/social-media-posting/oauth/facebook/accounts', null, { locationId });

    case 'create_social_post':
      return call('POST', '/social-media-posting/post', {
        locationId,
        summary:       input.summary,
        status:        input.status,
        scheduledDate: input.scheduledDate,
        accountIds:    input.accountIds || [],
      });

    // ── Blogs ─────────────────────────────────────────────────────────────────

    case 'list_blogs':
      return call('GET', '/blogs/site', null, { locationId });

    case 'create_blog_post':
      return call('POST', '/blogs/post', {
        locationId,
        title:       input.title,
        rawHTML:     buildPageHtml(input.sections || []),
        status:      input.status,
        imageUrl:    input.imageUrl    || null,
        description: input.description || '',
        author:      input.author      || '',
        categories:  input.categories  || [],
        tags:        input.tags        || [],
      });

    // ── Location ──────────────────────────────────────────────────────────────

    case 'get_location':
      return call('GET', `/locations/${locationId}`);

    case 'list_users':
      return call('GET', '/users/', null, { locationId });

    // ── Custom Objects ────────────────────────────────────────────────────────

    case 'list_custom_objects':
      return call('GET', '/objects/', null, { locationId });

    // ── Forms & Surveys ───────────────────────────────────────────────────────

    case 'list_forms':
      return call('GET', '/forms/', null, { locationId });

    case 'list_surveys':
      return call('GET', '/surveys/', null, { locationId });

    // ── Products & Payments ───────────────────────────────────────────────────

    case 'list_products':
      return call('GET', '/products/', null, {
        locationId,
        limit: input.limit || 20,
      });

    case 'list_invoices':
      return call('GET', '/invoices/', null, {
        locationId,
        contactId: input.contactId,
        status:    input.status,
      });

    // ── Knowledge Base ────────────────────────────────────────────────────────

    case 'list_knowledge_bases':
      return call('GET', '/knowledge-base/', null, { locationId });

    // ── Media Library ─────────────────────────────────────────────────────────

    case 'upload_media':
      return call('POST', '/medias/upload-file', {
        locationId,
        url:      input.url,
        name:     input.name,
        folderId: input.folderId || undefined,
      });

    // ── Funnels & Pages ───────────────────────────────────────────────────────

    case 'list_funnels':
      return call('GET', '/funnels/funnel/list', null, {
        locationId,
        limit:  input.limit  || 20,
        offset: input.offset || 0,
      });

    case 'list_funnel_pages':
      return call('GET', '/funnels/page', null, {
        locationId,
        funnelId: input.funnelId,
      });

    case 'create_funnel_page': {
      const { funnelId, name, url, title, description, keywords, sections, stepOrder, published } = input;
      return call('POST', '/funnels/page', {
        locationId,
        funnelId,
        name,
        url,
        title:       title       || name,
        description: description || '',
        keywords:    keywords    || '',
        content:     buildPageHtml(sections || []),
        stepOrder:   stepOrder   || 1,
        published:   published   !== false,
      });
    }

    case 'update_funnel_page': {
      const { pageId, sections: updSections, ...rest } = input;
      const updates = { ...rest };
      if (updSections) updates.content = buildPageHtml(updSections);
      return call('PUT', `/funnels/page/${pageId}`, updates);
    }

    default:
      throw new Error(`Unknown GHL tool: ${toolName}`);
  }
}

module.exports = { getToolDefinitions: () => TOOL_DEFINITIONS, executeGhlTool };