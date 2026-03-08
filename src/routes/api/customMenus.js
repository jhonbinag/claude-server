/**
 * routes/api/customMenus.js
 *
 * GHL Custom Menu Links API — inject custom navigation items into the GHL sidebar.
 *
 * Scopes:
 *   custom-menu-link.readonly — list/read custom menu links
 *   custom-menu-link.write    — create/update/delete custom menu links
 *
 * Custom menu links let Marketplace apps add their own items to the
 * left-hand sidebar navigation inside GHL, pointing to external URLs
 * or embedded iframes.
 *
 * Mounted at: /api/v1/custom-menus
 */

const express = require('express');
const router  = express.Router();

// GET list all custom menu links for the location
router.get('/', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/custom-menu-link/', null, {
      locationId: req.locationId,
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET a specific custom menu link
router.get('/:menuLinkId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/custom-menu-link/${req.params.menuLinkId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST create a custom menu link
// Body: {
//   title       : string  — label shown in the sidebar
//   url         : string  — destination URL or iframe src
//   icon        : string  — icon name or URL
//   openMode    : 'iframe' | 'new_tab' | 'same_tab'
//   position    : number  — order in the sidebar
//   showOnSubAccounts: boolean
// }
router.post('/', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/custom-menu-link/', {
      locationId: req.locationId,
      ...req.body,
    });
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// PUT update a custom menu link
router.put('/:menuLinkId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/custom-menu-link/${req.params.menuLinkId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// DELETE a custom menu link
router.delete('/:menuLinkId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/custom-menu-link/${req.params.menuLinkId}`, null, {
      locationId: req.locationId,
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
