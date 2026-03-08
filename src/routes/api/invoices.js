const express = require('express');
const router  = express.Router();

// ─── Invoices ─────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/invoices/', null, { locationId: req.locationId, ...req.query });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.get('/generate-invoice-number', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/invoices/generate-invoice-number', null, { locationId: req.locationId });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.get('/:invoiceId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/invoices/${req.params.invoiceId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/invoices', { ...req.body, locationId: req.locationId });
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.put('/:invoiceId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/invoices/${req.params.invoiceId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.delete('/:invoiceId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/invoices/${req.params.invoiceId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/:invoiceId/send', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/invoices/${req.params.invoiceId}/send`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/:invoiceId/void', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/invoices/${req.params.invoiceId}/void`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/:invoiceId/record-payment', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/invoices/${req.params.invoiceId}/record-payment`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/text2pay', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/invoices/text2pay', req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Schedules ────────────────────────────────────────────────────────────────
router.get('/schedule/', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/invoices/schedule/', null, { locationId: req.locationId });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.get('/schedule/:scheduleId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/invoices/schedule/${req.params.scheduleId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/schedule', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/invoices/schedule', req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.put('/schedule/:scheduleId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/invoices/schedule/${req.params.scheduleId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.delete('/schedule/:scheduleId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/invoices/schedule/${req.params.scheduleId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/schedule/:scheduleId/schedule', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/invoices/schedule/${req.params.scheduleId}/schedule`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/schedule/:scheduleId/auto-payment', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/invoices/schedule/${req.params.scheduleId}/auto-payment`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/schedule/:scheduleId/cancel', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/invoices/schedule/${req.params.scheduleId}/cancel`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Templates ────────────────────────────────────────────────────────────────
router.get('/template/', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/invoices/template/', null, { locationId: req.locationId });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.get('/template/:templateId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/invoices/template/${req.params.templateId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/template/', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/invoices/template/', req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.put('/template/:templateId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/invoices/template/${req.params.templateId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.delete('/template/:templateId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/invoices/template/${req.params.templateId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
