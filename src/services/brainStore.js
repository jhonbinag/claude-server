/**
 * src/services/brainStore.js
 *
 * Redis-backed Brain knowledge base — works without Chroma/Jina.
 * Uses Upstash Redis (already required by the app) to store documents + chunks.
 * Falls back to in-memory when Redis is also unavailable.
 *
 * Key layout:
 *   hltools:brain:{locationId}:docs          → JSON array of doc metadata
 *   hltools:brain:{locationId}:chunks:{docId} → JSON array of text chunks
 *
 * Search: keyword/TF-IDF scoring (no vector embeddings needed).
 */

const crypto = require('crypto');

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL  || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const isRedisEnabled = !!(REDIS_URL && REDIS_TOKEN);

// ── In-memory fallback ────────────────────────────────────────────────────────

const _mem = {};

// ── Redis REST client ─────────────────────────────────────────────────────────

const https = require('https');

function redisReq(cmd) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(cmd);
    const url  = new URL(REDIS_URL);
    const req  = https.request({
      hostname: url.hostname,
      path:     url.pathname,
      method:   'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { const p = JSON.parse(d); if (p.error) reject(new Error(p.error)); else resolve(p.result); }
        catch(e) { reject(new Error(`Redis parse error: ${d}`)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function rGet(key) {
  if (!isRedisEnabled) return _mem[key] || null;
  const v = await redisReq(['GET', key]);
  if (!v) return null;
  return typeof v === 'string' ? JSON.parse(v) : v;
}

async function rSet(key, value) {
  const s = JSON.stringify(value);
  if (!isRedisEnabled) { _mem[key] = value; return; }
  await redisReq(['SET', key, s]);
}

async function rDel(key) {
  if (!isRedisEnabled) { delete _mem[key]; return; }
  await redisReq(['DEL', key]);
}

// ── Key helpers ───────────────────────────────────────────────────────────────

const docsKey   = (loc, agent) => `hltools:brain:${loc}:${agent}:docs`;
const chunksKey = (loc, agent, docId) => `hltools:brain:${loc}:${agent}:chunks:${docId}`;

// ── Text chunking ─────────────────────────────────────────────────────────────

const CHUNK_SIZE    = 1200;
const CHUNK_OVERLAP = 100;

function chunkText(text) {
  const paragraphs = text.split(/\n\n+/);
  const chunks = [];
  let current  = '';

  for (const para of paragraphs) {
    if ((current + '\n\n' + para).length > CHUNK_SIZE && current.length > 0) {
      chunks.push(current.trim());
      const words = current.split(' ');
      current = words.slice(-Math.floor(CHUNK_OVERLAP / 5)).join(' ') + '\n\n' + para;
    } else {
      current = current ? current + '\n\n' + para : para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(c => c.length > 50);
}

// ── Keyword search scoring ────────────────────────────────────────────────────

function scoreChunk(chunk, queryTerms) {
  const lower = chunk.toLowerCase();
  let score = 0;
  for (const term of queryTerms) {
    const re = new RegExp(term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const matches = (lower.match(re) || []).length;
    score += matches * (1 + term.length / 10); // longer terms weighted higher
  }
  return score;
}

// ── Public API ─────────────────────────────────────────────────────────────────

function isEnabled() {
  return true; // always enabled — falls back to memory if no Redis
}

/**
 * Add a document to the knowledge base.
 */
async function addDocument(locationId, agentId, { text, sourceLabel, url }) {
  if (!text || text.trim().length === 0) throw new Error('No text content to add.');

  const chunks  = chunkText(text);
  if (!chunks.length) throw new Error('Text too short to chunk.');

  const docId   = `doc_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const now     = new Date().toISOString();

  // Store chunks
  await rSet(chunksKey(locationId, agentId, docId), chunks.map((text, i) => ({ text, index: i })));

  // Update docs index
  const docs = (await rGet(docsKey(locationId, agentId))) || [];
  docs.push({ docId, sourceLabel: sourceLabel || url || 'manual', url: url || '', chunkCount: chunks.length, addedAt: now });
  await rSet(docsKey(locationId, agentId), docs);

  return { docId, chunks: chunks.length };
}

/**
 * Ingest a YouTube video transcript.
 */
async function addYoutubeVideo(locationId, agentId, videoUrl, titleHint) {
  const m = videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  const videoId = m ? m[1] : videoUrl.length === 11 ? videoUrl : null;
  if (!videoId) throw new Error('Invalid YouTube URL — could not extract video ID.');

  const { getSubtitles } = require('youtube-captions-scraper');
  let captions;
  try {
    captions = await getSubtitles({ videoID: videoId, lang: 'en' });
  } catch {
    captions = await getSubtitles({ videoID: videoId, lang: 'en', auto: true });
  }
  if (!captions || !captions.length) throw new Error('No captions/transcript available for this video.');

  const lines = captions.map(c => c.text.replace(/\n/g, ' ').trim()).filter(Boolean);
  const paragraphs = [];
  for (let i = 0; i < lines.length; i += 10) paragraphs.push(lines.slice(i, i + 10).join(' '));
  const transcript = paragraphs.join('\n\n');

  const label = titleHint || `YouTube: ${videoId}`;
  const result = await addDocument(locationId, agentId, {
    text: transcript,
    url:  `https://www.youtube.com/watch?v=${videoId}`,
    sourceLabel: label,
  });

  return { ...result, videoId, title: label };
}

/**
 * Keyword search across all chunks.
 */
async function queryKnowledge(locationId, agentId, queryText, k = 5) {
  const docs = (await rGet(docsKey(locationId, agentId))) || [];
  if (!docs.length) return [];

  const queryTerms = queryText.toLowerCase().split(/\s+/).filter(t => t.length > 2);

  const scored = [];
  for (const doc of docs) {
    const chunks = (await rGet(chunksKey(locationId, agentId, doc.docId))) || [];
    for (const chunk of chunks) {
      const score = scoreChunk(chunk.text, queryTerms);
      if (score > 0) {
        scored.push({ text: chunk.text, score, sourceLabel: doc.sourceLabel, url: doc.url, docId: doc.docId });
      }
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, k);
}

/**
 * List all documents.
 */
async function listDocuments(locationId, agentId) {
  return (await rGet(docsKey(locationId, agentId))) || [];
}

/**
 * Delete a document and its chunks.
 */
async function deleteDocument(locationId, agentId, docId) {
  await rDel(chunksKey(locationId, agentId, docId));
  const docs = (await rGet(docsKey(locationId, agentId))) || [];
  await rSet(docsKey(locationId, agentId), docs.filter(d => d.docId !== docId));
  return { deleted: docId };
}

/**
 * Get status.
 */
async function getStatus(locationId, agentId) {
  const docs   = (await rGet(docsKey(locationId, agentId))) || [];
  const chunks = docs.reduce((a, d) => a + (d.chunkCount || 0), 0);
  return {
    enabled:  true,
    backend:  isRedisEnabled ? 'redis' : 'memory',
    docs:     docs.length,
    chunks,
  };
}

module.exports = { isEnabled, addDocument, addYoutubeVideo, queryKnowledge, listDocuments, deleteDocument, getStatus };
