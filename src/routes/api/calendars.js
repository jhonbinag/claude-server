const express = require('express');
const router  = express.Router();

// ─── Calendars ────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/calendars/', null, { locationId: req.locationId });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.get('/:calendarId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/calendars/${req.params.calendarId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/calendars/', req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.put('/:calendarId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/calendars/${req.params.calendarId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.delete('/:calendarId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/calendars/${req.params.calendarId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Free Slots ───────────────────────────────────────────────────────────────
router.get('/:calendarId/free-slots', async (req, res) => {
  try {
    const { startDate, endDate, timezone } = req.query;
    const data = await req.ghl('GET', `/calendars/${req.params.calendarId}/free-slots`, null, { startDate, endDate, timezone });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Groups ───────────────────────────────────────────────────────────────────
router.get('/groups', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/calendars/groups', null, { locationId: req.locationId });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/groups', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/calendars/groups', req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/groups/validate-slug', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/calendars/groups/validate-slug', req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.put('/groups/:groupId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/calendars/groups/${req.params.groupId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.put('/groups/:groupId/status', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/calendars/groups/${req.params.groupId}/status`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.delete('/groups/:groupId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/calendars/groups/${req.params.groupId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Resources ────────────────────────────────────────────────────────────────
router.get('/resources/:resourceType', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/calendars/resources/${req.params.resourceType}`, null, { locationId: req.locationId });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.get('/resources/:resourceType/:id', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/calendars/resources/${req.params.resourceType}/${req.params.id}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/resources', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/calendars/resources', req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.put('/resources/:resourceType/:id', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/calendars/resources/${req.params.resourceType}/${req.params.id}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.delete('/resources/:resourceType/:id', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/calendars/resources/${req.params.resourceType}/${req.params.id}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Events & Appointments ────────────────────────────────────────────────────
router.get('/events', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/calendars/events', null, { locationId: req.locationId, ...req.query });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.get('/events/appointments/:eventId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/calendars/events/appointments/${req.params.eventId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/events/appointments', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/calendars/events/appointments', req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.put('/events/appointments/:eventId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/calendars/events/appointments/${req.params.eventId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.delete('/events/:eventId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/calendars/events/${req.params.eventId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Blocked Slots ────────────────────────────────────────────────────────────
router.get('/blocked-slots', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/calendars/blocked-slots', null, { locationId: req.locationId, ...req.query });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/events/block-slots', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/calendars/events/block-slots', req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.put('/events/block-slots/:eventId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/calendars/events/block-slots/${req.params.eventId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Appointment Notes ────────────────────────────────────────────────────────
router.get('/appointments/:appointmentId/notes', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/calendars/appointments/${req.params.appointmentId}/notes`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/appointments/:appointmentId/notes', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/calendars/appointments/${req.params.appointmentId}/notes`, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.put('/appointments/:appointmentId/notes/:noteId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/calendars/appointments/${req.params.appointmentId}/notes/${req.params.noteId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.delete('/appointments/:appointmentId/notes/:noteId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/calendars/appointments/${req.params.appointmentId}/notes/${req.params.noteId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Calendar Notifications ───────────────────────────────────────────────────
router.get('/:calendarId/notifications', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/calendars/${req.params.calendarId}/notifications`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/:calendarId/notifications', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/calendars/${req.params.calendarId}/notifications`, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.put('/:calendarId/notifications/:notificationId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/calendars/${req.params.calendarId}/notifications/${req.params.notificationId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.delete('/:calendarId/notifications/:notificationId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/calendars/${req.params.calendarId}/notifications/${req.params.notificationId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
