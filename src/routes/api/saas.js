const express = require('express');
const router  = express.Router();

// GET all locations in SaaS mode — saas/location.read
router.get('/locations', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/locations', null, { companyId: req.companyId });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET location subscription details — saas/location.read
router.get('/location/:locationId/subscription', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/saas/location/${req.params.locationId}/subscription`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// PUT update SaaS subscription for a location — saas/location.write
router.put('/update-saas-subscription/:locationId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/update-saas-subscription/${req.params.locationId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST enable SaaS for a location — saas/location.write
router.post('/enable-saas/:locationId', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/enable-saas/${req.params.locationId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST bulk disable SaaS for company — saas/company.write
router.post('/bulk-disable-saas/:companyId', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/bulk-disable-saas/${req.params.companyId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
