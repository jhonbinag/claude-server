/**
 * src/routes/prompts.js
 *
 * Prompt Library CRUD — mounts at /prompts.
 *
 *   GET    /prompts                                  → all folders + prompts
 *   POST   /prompts/folders                          → create folder
 *   PUT    /prompts/folders/:fid                     → rename/re-icon folder
 *   DELETE /prompts/folders/:fid                     → delete folder
 *   POST   /prompts/folders/:fid/prompts             → add prompt
 *   PUT    /prompts/folders/:fid/prompts/:pid        → update prompt
 *   DELETE /prompts/folders/:fid/prompts/:pid        → delete prompt
 */

const express     = require('express');
const router      = express.Router();
const authenticate = require('../middleware/authenticate');
const promptStore  = require('../services/promptStore');

function uuid() { return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`; }

router.use(authenticate);

// ── helpers ──────────────────────────────────────────────────────────────────

async function load(locationId) {
  const { folders } = await promptStore.getLibrary(locationId);
  return folders;
}
async function save(locationId, folders) {
  await promptStore.saveLibrary(locationId, folders);
}

// ── GET /prompts ──────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const folders = await load(req.locationId);
    res.json({ success: true, data: folders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /prompts/folders ────────────────────────────────────────────────────

router.post('/folders', async (req, res) => {
  try {
    const { name, icon = '📁', color = '#6366f1' } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'name required' });
    const folders = await load(req.locationId);
    const folder  = { id: uuid(), name: name.trim(), icon, color, prompts: [], createdAt: Date.now() };
    folders.push(folder);
    await save(req.locationId, folders);
    res.json({ success: true, data: folder });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PUT /prompts/folders/:fid ────────────────────────────────────────────────

router.put('/folders/:fid', async (req, res) => {
  try {
    const folders = await load(req.locationId);
    const idx = folders.findIndex(f => f.id === req.params.fid);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Folder not found' });
    const { name, icon, color } = req.body;
    if (name)  folders[idx].name  = name.trim();
    if (icon)  folders[idx].icon  = icon;
    if (color) folders[idx].color = color;
    await save(req.locationId, folders);
    res.json({ success: true, data: folders[idx] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /prompts/folders/:fid ─────────────────────────────────────────────

router.delete('/folders/:fid', async (req, res) => {
  try {
    const folders = await load(req.locationId);
    const next = folders.filter(f => f.id !== req.params.fid);
    await save(req.locationId, next);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /prompts/folders/:fid/prompts ───────────────────────────────────────

router.post('/folders/:fid/prompts', async (req, res) => {
  try {
    const { title, content } = req.body;
    if (!title?.trim() || !content?.trim())
      return res.status(400).json({ success: false, error: 'title and content required' });
    const folders = await load(req.locationId);
    const folder  = folders.find(f => f.id === req.params.fid);
    if (!folder) return res.status(404).json({ success: false, error: 'Folder not found' });
    const p = { id: uuid(), title: title.trim(), content: content.trim(), createdAt: Date.now() };
    folder.prompts.push(p);
    await save(req.locationId, folders);
    res.json({ success: true, data: p });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PUT /prompts/folders/:fid/prompts/:pid ───────────────────────────────────

router.put('/folders/:fid/prompts/:pid', async (req, res) => {
  try {
    const folders = await load(req.locationId);
    const folder  = folders.find(f => f.id === req.params.fid);
    if (!folder) return res.status(404).json({ success: false, error: 'Folder not found' });
    const pidx = folder.prompts.findIndex(p => p.id === req.params.pid);
    if (pidx === -1) return res.status(404).json({ success: false, error: 'Prompt not found' });
    const { title, content } = req.body;
    if (title)   folder.prompts[pidx].title   = title.trim();
    if (content) folder.prompts[pidx].content = content.trim();
    folder.prompts[pidx].updatedAt = Date.now();
    await save(req.locationId, folders);
    res.json({ success: true, data: folder.prompts[pidx] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /prompts/folders/:fid/prompts/:pid ────────────────────────────────

router.delete('/folders/:fid/prompts/:pid', async (req, res) => {
  try {
    const folders = await load(req.locationId);
    const folder  = folders.find(f => f.id === req.params.fid);
    if (!folder) return res.status(404).json({ success: false, error: 'Folder not found' });
    folder.prompts = folder.prompts.filter(p => p.id !== req.params.pid);
    await save(req.locationId, folders);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
