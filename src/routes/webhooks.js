/**
 * routes/webhooks.js
 *
 * Receives all GHL webhook events for installed locations.
 * Every request is verified via RSA-SHA256 (webhookAuth middleware).
 *
 * Mount: POST /webhooks/ghl
 */

const express          = require('express');
const router           = express.Router();
const webhookAuth      = require('../middleware/webhookAuth');
const tokenStore       = require('../services/tokenStore');
const firebaseStore    = require('../services/firebaseStore');
const toolTokenService = require('../services/toolTokenService');
const locationRegistry = require('../services/locationRegistry');
const activityLogger   = require('../services/activityLogger');
const toolRegistry     = require('../tools/toolRegistry');

router.use(webhookAuth);

// ─── Main Webhook Receiver ────────────────────────────────────────────────────

router.post('/ghl', async (req, res) => {
  res.status(200).json({ success: true, received: true });

  const { type, locationId, ...payload } = req.body;
  console.log(`[Webhook] Event: ${type} | Location: ${locationId}`);

  try {
    await dispatchEvent(type, locationId, payload);
  } catch (err) {
    console.error(`[Webhook] Handler error for ${type}:`, err.message);
  }
});

// ─── Event Dispatcher ─────────────────────────────────────────────────────────

async function dispatchEvent(type, locationId, payload) {
  switch (type) {
    case 'AppInstall':    return onAppInstall(locationId, payload);
    case 'AppUninstall':  return onAppUninstall(locationId, payload);

    case 'AppointmentCreate': return onAppointmentCreate(locationId, payload);
    case 'AppointmentUpdate': return onAppointmentUpdate(locationId, payload);
    case 'AppointmentDelete': return onAppointmentDelete(locationId, payload);

    case 'AssociationCreate': return onAssociationCreate(locationId, payload);
    case 'AssociationUpdate': return onAssociationUpdate(locationId, payload);
    case 'AssociationDelete': return onAssociationDelete(locationId, payload);

    case 'CampaignStatusUpdate': return onCampaignStatusUpdate(locationId, payload);

    case 'ContactCreate':    return onContactCreate(locationId, payload);
    case 'ContactUpdate':    return onContactUpdate(locationId, payload);
    case 'ContactDelete':    return onContactDelete(locationId, payload);
    case 'ContactDndUpdate': return onContactDndUpdate(locationId, payload);
    case 'ContactTagUpdate': return onContactTagUpdate(locationId, payload);

    case 'ConversationUnreadWebhook':           return onConversationUnread(locationId, payload);
    case 'InboundMessage':                      return onInboundMessage(locationId, payload);
    case 'OutboundMessage':                     return onOutboundMessage(locationId, payload);
    case 'ConversationProviderOutboundMessage': return onProviderOutboundMessage(locationId, payload);

    case 'InvoiceCreate':        return onInvoiceCreate(locationId, payload);
    case 'InvoiceUpdate':        return onInvoiceUpdate(locationId, payload);
    case 'InvoiceDelete':        return onInvoiceDelete(locationId, payload);
    case 'InvoiceSent':          return onInvoiceSent(locationId, payload);
    case 'InvoicePaid':          return onInvoicePaid(locationId, payload);
    case 'InvoicePartiallyPaid': return onInvoicePartiallyPaid(locationId, payload);
    case 'InvoiceVoid':          return onInvoiceVoid(locationId, payload);

    case 'LocationCreate': return onLocationCreate(locationId, payload);
    case 'LocationUpdate': return onLocationUpdate(locationId, payload);

    case 'NoteCreate': return onNoteCreate(locationId, payload);
    case 'NoteUpdate': return onNoteUpdate(locationId, payload);
    case 'NoteDelete': return onNoteDelete(locationId, payload);

    case 'OpportunityCreate':              return onOpportunityCreate(locationId, payload);
    case 'OpportunityUpdate':              return onOpportunityUpdate(locationId, payload);
    case 'OpportunityDelete':              return onOpportunityDelete(locationId, payload);
    case 'OpportunityStageUpdate':         return onOpportunityStageUpdate(locationId, payload);
    case 'OpportunityStatusUpdate':        return onOpportunityStatusUpdate(locationId, payload);
    case 'OpportunityMonetaryValueUpdate': return onOpportunityMonetaryValueUpdate(locationId, payload);
    case 'OpportunityAssignedToUpdate':    return onOpportunityAssignedToUpdate(locationId, payload);

    case 'OrderCreate':       return onOrderCreate(locationId, payload);
    case 'OrderStatusUpdate': return onOrderStatusUpdate(locationId, payload);
    case 'ProductCreate':     return onProductCreate(locationId, payload);
    case 'ProductUpdate':     return onProductUpdate(locationId, payload);
    case 'ProductDelete':     return onProductDelete(locationId, payload);
    case 'PriceCreate':       return onPriceCreate(locationId, payload);
    case 'PriceUpdate':       return onPriceUpdate(locationId, payload);
    case 'PriceDelete':       return onPriceDelete(locationId, payload);

    case 'ObjectSchemaCreate': return onObjectSchemaCreate(locationId, payload);
    case 'ObjectSchemaUpdate': return onObjectSchemaUpdate(locationId, payload);
    case 'RecordCreate':       return onRecordCreate(locationId, payload);
    case 'RecordUpdate':       return onRecordUpdate(locationId, payload);
    case 'RecordDelete':       return onRecordDelete(locationId, payload);
    case 'RelationCreate':     return onRelationCreate(locationId, payload);
    case 'RelationDelete':     return onRelationDelete(locationId, payload);

    case 'TaskCreate':   return onTaskCreate(locationId, payload);
    case 'TaskDelete':   return onTaskDelete(locationId, payload);
    case 'TaskComplete': return onTaskComplete(locationId, payload);

    case 'UserCreate': return onUserCreate(locationId, payload);
    case 'PlanChange': return onPlanChange(locationId, payload);

    case 'LCEmailStats': return onLCEmailStats(locationId, payload);

    default:
      console.warn(`[Webhook] Unhandled event type: ${type}`);
  }
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────

async function onAppInstall(locationId, payload) {
  console.log('[Event] App installed:', locationId);

  const companyId = payload.companyId || null;

  // Register in location registry (creates or updates to active)
  await locationRegistry.registerLocation(locationId, { companyId });

  // Log the install event
  activityLogger.log({ locationId, event: 'install', detail: { companyId }, success: true });
}

async function onAppUninstall(locationId, payload) {
  console.log('[Event] App uninstalled:', locationId);

  // 1. Mark as uninstalled in registry — DATA IS PRESERVED for potential restore
  await locationRegistry.uninstallLocation(locationId);

  // 2. Revoke tool session token from Redis
  await toolTokenService.revokeToolSessionToken(locationId);

  // 3. Bust tool config cache so next load re-reads from Firebase
  await toolTokenService.invalidateToolConfigCache(locationId);

  // 4. Log the event
  activityLogger.log({ locationId, event: 'uninstall', detail: { companyId: payload.companyId }, success: true });

  // NOTE: We intentionally do NOT delete:
  //   - Firebase tool configs (firebaseStore) — needed for restore
  //   - GHL OAuth tokens (tokenStore) — needed if they reinstall
  //   The data is kept; only the active token is revoked.

  console.log(`[Event] Uninstall cleanup complete for ${locationId} — data preserved for restore`);
}

// ─── Remaining Event Handlers ─────────────────────────────────────────────────

async function onAppointmentCreate(locationId, p) { console.log('[Event] Appointment created:', p.id); }
async function onAppointmentUpdate(locationId, p) { console.log('[Event] Appointment updated:', p.id); }
async function onAppointmentDelete(locationId, p) { console.log('[Event] Appointment deleted:', p.id); }

async function onAssociationCreate(locationId, p) { console.log('[Event] Association created'); }
async function onAssociationUpdate(locationId, p) { console.log('[Event] Association updated'); }
async function onAssociationDelete(locationId, p) { console.log('[Event] Association deleted'); }

async function onCampaignStatusUpdate(locationId, p) { console.log('[Event] Campaign status updated:', p.campaignId); }

async function onContactCreate(locationId, p)    { console.log('[Event] Contact created:', p.id); }
async function onContactUpdate(locationId, p)    { console.log('[Event] Contact updated:', p.id); }
async function onContactDelete(locationId, p)    { console.log('[Event] Contact deleted:', p.id); }
async function onContactDndUpdate(locationId, p) { console.log('[Event] Contact DND updated:', p.id); }
async function onContactTagUpdate(locationId, p) { console.log('[Event] Contact tags updated:', p.id); }

async function onConversationUnread(locationId, p)      { console.log('[Event] Conversation unread:', p.conversationId); }
async function onInboundMessage(locationId, p)          { console.log('[Event] Inbound message:', p.messageId); }
async function onOutboundMessage(locationId, p)         { console.log('[Event] Outbound message:', p.messageId); }
async function onProviderOutboundMessage(locationId, p) { console.log('[Event] Provider outbound message:', p.messageId); }

async function onInvoiceCreate(locationId, p)        { console.log('[Event] Invoice created:', p.id); }
async function onInvoiceUpdate(locationId, p)        { console.log('[Event] Invoice updated:', p.id); }
async function onInvoiceDelete(locationId, p)        { console.log('[Event] Invoice deleted:', p.id); }
async function onInvoiceSent(locationId, p)          { console.log('[Event] Invoice sent:', p.id); }
async function onInvoicePaid(locationId, p)          { console.log('[Event] Invoice paid:', p.id); }
async function onInvoicePartiallyPaid(locationId, p) { console.log('[Event] Invoice partially paid:', p.id); }
async function onInvoiceVoid(locationId, p)          { console.log('[Event] Invoice voided:', p.id); }

async function onLocationCreate(locationId, p) { console.log('[Event] Location created:', locationId); }
async function onLocationUpdate(locationId, p) { console.log('[Event] Location updated:', locationId); }

async function onNoteCreate(locationId, p) { console.log('[Event] Note created:', p.id); }
async function onNoteUpdate(locationId, p) { console.log('[Event] Note updated:', p.id); }
async function onNoteDelete(locationId, p) { console.log('[Event] Note deleted:', p.id); }

async function onOpportunityCreate(locationId, p)              { console.log('[Event] Opportunity created:', p.id); }
async function onOpportunityUpdate(locationId, p)              { console.log('[Event] Opportunity updated:', p.id); }
async function onOpportunityDelete(locationId, p)              { console.log('[Event] Opportunity deleted:', p.id); }
async function onOpportunityStageUpdate(locationId, p)         { console.log('[Event] Opportunity stage updated:', p.id); }
async function onOpportunityStatusUpdate(locationId, p)        { console.log('[Event] Opportunity status updated:', p.id); }
async function onOpportunityMonetaryValueUpdate(locationId, p) { console.log('[Event] Opportunity value updated:', p.id); }
async function onOpportunityAssignedToUpdate(locationId, p)    { console.log('[Event] Opportunity assignee updated:', p.id); }

async function onOrderCreate(locationId, p)       { console.log('[Event] Order created:', p.id); }
async function onOrderStatusUpdate(locationId, p) { console.log('[Event] Order status updated:', p.id); }
async function onProductCreate(locationId, p)     { console.log('[Event] Product created:', p.id); }
async function onProductUpdate(locationId, p)     { console.log('[Event] Product updated:', p.id); }
async function onProductDelete(locationId, p)     { console.log('[Event] Product deleted:', p.id); }
async function onPriceCreate(locationId, p)       { console.log('[Event] Price created:', p.id); }
async function onPriceUpdate(locationId, p)       { console.log('[Event] Price updated:', p.id); }
async function onPriceDelete(locationId, p)       { console.log('[Event] Price deleted:', p.id); }

async function onObjectSchemaCreate(locationId, p) { console.log('[Event] Object schema created'); }
async function onObjectSchemaUpdate(locationId, p) { console.log('[Event] Object schema updated'); }
async function onRecordCreate(locationId, p)       { console.log('[Event] Record created:', p.id); }
async function onRecordUpdate(locationId, p)       { console.log('[Event] Record updated:', p.id); }
async function onRecordDelete(locationId, p)       { console.log('[Event] Record deleted:', p.id); }
async function onRelationCreate(locationId, p)     { console.log('[Event] Relation created'); }
async function onRelationDelete(locationId, p)     { console.log('[Event] Relation deleted'); }

async function onTaskCreate(locationId, p)   { console.log('[Event] Task created:', p.id); }
async function onTaskDelete(locationId, p)   { console.log('[Event] Task deleted:', p.id); }
async function onTaskComplete(locationId, p) { console.log('[Event] Task completed:', p.id); }

async function onUserCreate(locationId, p) { console.log('[Event] User created:', p.id); }
async function onPlanChange(locationId, p) { console.log('[Event] Plan changed:', p.planId); }

async function onLCEmailStats(locationId, p) { console.log('[Event] LC Email stats received'); }

module.exports = router;
