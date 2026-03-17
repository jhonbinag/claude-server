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
async function saveTraining(locationId, promptId, trainHistory, meta) {
  await promptStore.saveTraining(locationId, promptId, trainHistory, meta);
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

// ── GET /prompts/folders/:fid/prompts/:pid ───────────────────────────────────

router.get('/folders/:fid/prompts/:pid', async (req, res) => {
  try {
    const folders = await load(req.locationId);
    const folder  = folders.find(f => f.id === req.params.fid);
    if (!folder) return res.status(404).json({ success: false, error: 'Folder not found' });
    const p = folder.prompts?.find(p => p.id === req.params.pid);
    if (!p) return res.status(404).json({ success: false, error: 'Prompt not found' });
    // Merge training history from dedicated promptTraining collection
    const trainHistory = await promptStore.getTraining(req.locationId, req.params.pid);
    res.json({ success: true, data: { ...p, trainHistory } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /prompts/folders/:fid/prompts ───────────────────────────────────────

router.post('/folders/:fid/prompts', async (req, res) => {
  try {
    const { title, content, trainHistory, isDraft } = req.body;
    if (!title?.trim() || !content?.trim())
      return res.status(400).json({ success: false, error: 'title and content required' });
    const folders = await load(req.locationId);
    const folder  = folders.find(f => f.id === req.params.fid);
    if (!folder) return res.status(404).json({ success: false, error: 'Folder not found' });
    const p = { id: uuid(), title: title.trim(), content: content.trim(), createdAt: Date.now() };
    if (isDraft) p.isDraft = true;
    if (Array.isArray(trainHistory) && trainHistory.length) {
      p.hasTraining = true; // flag in library doc (no full history stored here)
      await saveTraining(req.locationId, p.id, trainHistory, {
        folderId: req.params.fid, promptTitle: p.title, isDraft: !!isDraft,
      });
    }
    folder.prompts.push(p);
    await save(req.locationId, folders);
    res.json({ success: true, data: { ...p, trainHistory: trainHistory || [] } });
  } catch (err) {
    console.error('[Prompts] POST prompt error:', err.message);
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
    const { title, content, trainHistory, isDraft } = req.body;
    if (title)   folder.prompts[pidx].title   = title.trim();
    if (content) folder.prompts[pidx].content = content.trim();
    if (isDraft === false) {
      delete folder.prompts[pidx].isDraft;
      // Mark training as finalized in promptTraining collection
      if (folder.prompts[pidx].hasTraining) {
        const existing = await promptStore.getTraining(req.locationId, req.params.pid);
        if (existing.length) {
          await saveTraining(req.locationId, req.params.pid, existing, {
            folderId: req.params.fid,
            promptTitle: folder.prompts[pidx].title,
            isDraft: false,
          });
        }
      }
    } else if (isDraft) {
      folder.prompts[pidx].isDraft = true;
    }
    // Save training history to dedicated collection (never stored in library blob)
    if (Array.isArray(trainHistory)) {
      folder.prompts[pidx].hasTraining = trainHistory.length > 0;
      await saveTraining(req.locationId, req.params.pid, trainHistory, {
        folderId:    req.params.fid,
        promptTitle: folder.prompts[pidx].title,
        isDraft:     !!folder.prompts[pidx].isDraft,
      });
    }
    folder.prompts[pidx].updatedAt = Date.now();
    await save(req.locationId, folders);
    res.json({ success: true, data: { ...folder.prompts[pidx], trainHistory: trainHistory || [] } });
  } catch (err) {
    console.error('[Prompts] PUT prompt error:', err.message);
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
    // Clean up training data from dedicated collection
    await promptStore.deleteTraining(req.locationId, req.params.pid).catch(() => {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /prompts/train ───────────────────────────────────────────────────────
// Persona training chat. Body: { messages, action: 'chat' | 'finalize' }
// 'chat'     → coaching conversation (ask questions, gather info)
// 'finalize' → synthesize conversation into a clean system prompt

router.post('/train', async (req, res) => {
  try {
    const { messages = [], action = 'chat' } = req.body;

    const registry = require('../tools/toolRegistry');
    const configs  = await registry.loadToolConfigs(req.locationId);
    const aiService = require('../services/aiService');
    if (!aiService.getProvider()) return res.status(400).json({ success: false, error: 'No AI provider configured.' });

    const COACH_SYSTEM = `You are a friendly persona training coach helping a user define their ideal AI persona through natural conversation.

Ask focused questions one or two at a time to learn about:
- Their business, brand, or use case
- Preferred tone and communication style (formal, casual, witty, direct, empathetic)
- Expertise areas or topics to focus on
- Things the AI should NEVER say or do
- Specific phrases, terminology, or examples they like
- How responses should be structured (brief, detailed, bullet points, etc.)

Keep each response short and conversational — you're having a chat, not writing an essay.
After 4–6 exchanges when you feel you have a clear picture, say something like:
"I think I have everything I need! Click **Generate Persona** to create your custom system prompt."

Do NOT generate the final persona during the chat — that happens in the finalize step.`;

    const FINALIZE_SYSTEM = `You are an expert at writing AI system prompts. Based on the training conversation provided, generate a polished, ready-to-use system prompt for the user's persona.

Requirements:
- Start with "You are [persona description]..."
- Include: role/identity, tone and communication style, expertise areas, audience, and any specific behaviors or constraints discussed
- Be specific and actionable, not vague
- 150–300 words maximum
- Output ONLY the system prompt — no preamble, no explanation, no markdown headers`;

    // For multi-turn conversation: extract the last user message, pass prior turns as context in system
    const systemPrompt = action === 'finalize' ? FINALIZE_SYSTEM : COACH_SYSTEM;
    const lastUser     = [...messages].reverse().find(m => m.role === 'user');
    const history      = messages.slice(0, -1).map(m => `${m.role}: ${Array.isArray(m.content) ? m.content.map(c => c.text || '').join('') : m.content}`).join('\n');
    const userText     = Array.isArray(lastUser?.content) ? lastUser.content.map(c => c.text || '').join('') : (lastUser?.content || '');
    const fullSystem   = history ? `${systemPrompt}\n\n--- Conversation so far ---\n${history}` : systemPrompt;

    const reply = await aiService.generate(fullSystem, userText, { maxTokens: action === 'finalize' ? 600 : 300 });
    res.json({ success: true, reply });
  } catch (err) {
    console.error('[Prompts] train error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
