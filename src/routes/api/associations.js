/**
 * routes/api/associations.js
 *
 * GHL Associations API — link any two objects/records together.
 *
 * Scopes:
 *   associations.readonly         — read association schemas
 *   associations.write            — create/delete associations
 *   associations/relation.readonly — read relation records
 *   associations/relation.write   — create/delete relation records
 *
 * Webhooks triggered:
 *   AssociationCreate, AssociationUpdate, AssociationDelete
 *   RelationCreate, RelationDelete
 *
 * Mounted at: /api/v1/associations
 */

const express = require('express');
const router  = express.Router();

// ─── Association Schemas ──────────────────────────────────────────────────────

// GET list all association schemas (definitions of what objects can be linked)
router.get('/', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/associations/', null, { locationId: req.locationId });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET a specific association schema by key
router.get('/:associationKey', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/associations/${req.params.associationKey}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST create an association schema
// Body: { key, label, objectKey1, objectKey2, type }
router.post('/', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/associations/', {
      locationId: req.locationId,
      ...req.body,
    });
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// PUT update an association schema
router.put('/:associationKey', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/associations/${req.params.associationKey}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// DELETE an association schema
router.delete('/:associationKey', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/associations/${req.params.associationKey}`, null, {
      locationId: req.locationId,
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Relations (Instances of Associations) ────────────────────────────────────

// GET list relation records for an association
// Query: { objectId, objectKey, limit, skip }
router.get('/:associationKey/relations', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/associations/${req.params.associationKey}/relations`, null, {
      locationId: req.locationId,
      ...req.query,
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET a specific relation record
router.get('/:associationKey/relations/:relationId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/associations/${req.params.associationKey}/relations/${req.params.relationId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST create a relation (link two objects together)
// Body: { firstObjectId, firstObjectKey, secondObjectId, secondObjectKey }
router.post('/:associationKey/relations', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/associations/${req.params.associationKey}/relations`, {
      locationId: req.locationId,
      ...req.body,
    });
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// DELETE a relation record
router.delete('/:associationKey/relations/:relationId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/associations/${req.params.associationKey}/relations/${req.params.relationId}`, null, {
      locationId: req.locationId,
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
