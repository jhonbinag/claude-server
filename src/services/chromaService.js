/**
 * src/services/chromaService.js
 *
 * Chroma Cloud vector DB + Jina AI embeddings for agent knowledge bases.
 *
 * Requires env vars: CHROMA_API_KEY, CHROMA_TENANT, CHROMA_DATABASE, JINA_API_KEY
 */

const https   = require('https');
const config  = require('../config');

// ── Lazy Chroma client ────────────────────────────────────────────────────────

let _client = null;

function getClient() {
  if (_client) return _client;
  if (!config.isChromaEnabled) {
    throw new Error('Chroma is not configured. Set CHROMA_API_KEY, CHROMA_TENANT, CHROMA_DATABASE, JINA_API_KEY.');
  }
  const { ChromaClient } = require('chromadb');
  _client = new ChromaClient({
    path:   'https://api.trychroma.com:8000',
    auth: {
      provider:    'token',
      credentials: config.chroma.apiKey,
      tokenHeaderType: 'X_CHROMA_TOKEN',
    },
    tenant:   config.chroma.tenant,
    database: config.chroma.database,
  });
  return _client;
}

// ── Collection naming ─────────────────────────────────────────────────────────
// Chroma collection names: max 63 chars, lowercase alphanumeric + underscores

function collectionName(locationId, agentId) {
  const raw = `hltools_${locationId}_${agentId}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  return raw.slice(0, 63);
}

// ── Text chunking ─────────────────────────────────────────────────────────────

const CHUNK_SIZE    = 1500;
const CHUNK_OVERLAP = 100;

function chunkText(text) {
  const paragraphs = text.split(/\n\n+/);
  const chunks     = [];
  let   current    = '';

  for (const para of paragraphs) {
    if ((current + '\n\n' + para).length > CHUNK_SIZE && current.length > 0) {
      chunks.push(current.trim());
      // Keep overlap from the end of the previous chunk
      current = current.slice(-CHUNK_OVERLAP) + '\n\n' + para;
    } else {
      current = current ? current + '\n\n' + para : para;
    }
  }
  if (current.trim().length > 0) chunks.push(current.trim());

  // Fallback: split any oversized chunks by character
  const final = [];
  for (const chunk of chunks) {
    if (chunk.length <= CHUNK_SIZE) {
      final.push(chunk);
    } else {
      for (let i = 0; i < chunk.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
        final.push(chunk.slice(i, i + CHUNK_SIZE));
      }
    }
  }
  return final.filter(c => c.length > 20);
}

// ── Jina AI Embeddings ────────────────────────────────────────────────────────

function getEmbeddings(texts) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:  'jina-embeddings-v3',
      input:  texts,
      task:   'retrieval.passage',
    });

    const req = https.request(
      {
        hostname: 'api.jina.ai',
        path:     '/v1/embeddings',
        method:   'POST',
        headers: {
          'Authorization': `Bearer ${config.jinaApiKey}`,
          'Content-Type':  'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (resp) => {
        let d = '';
        resp.on('data', c => d += c);
        resp.on('end', () => {
          try {
            const parsed = JSON.parse(d);
            if (parsed.data && Array.isArray(parsed.data)) {
              resolve(parsed.data.map(item => item.embedding));
            } else {
              reject(new Error(`Jina embeddings error: ${d.slice(0, 200)}`));
            }
          } catch (e) {
            reject(new Error(`Jina parse error: ${e.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Query embedding uses retrieval.query task for better results
function getQueryEmbedding(text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'jina-embeddings-v3',
      input: [text],
      task:  'retrieval.query',
    });

    const req = https.request(
      {
        hostname: 'api.jina.ai',
        path:     '/v1/embeddings',
        method:   'POST',
        headers: {
          'Authorization': `Bearer ${config.jinaApiKey}`,
          'Content-Type':  'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (resp) => {
        let d = '';
        resp.on('data', c => d += c);
        resp.on('end', () => {
          try {
            const parsed = JSON.parse(d);
            if (parsed.data && parsed.data[0]) {
              resolve(parsed.data[0].embedding);
            } else {
              reject(new Error(`Jina query embedding error: ${d.slice(0, 200)}`));
            }
          } catch (e) {
            reject(new Error(`Jina parse error: ${e.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Jina Reader — URL → clean text ───────────────────────────────────────────

function fetchUrlText(url) {
  return new Promise((resolve, reject) => {
    const readerUrl = `https://r.jina.ai/${url}`;
    const req = https.request(
      {
        hostname: 'r.jina.ai',
        path:     `/${url}`,
        method:   'GET',
        headers: {
          'Authorization': `Bearer ${config.jinaApiKey}`,
          'Accept':        'text/plain',
          'X-Return-Format': 'markdown',
        },
      },
      (resp) => {
        let d = '';
        resp.on('data', c => d += c);
        resp.on('end', () => {
          if (resp.statusCode >= 400) {
            reject(new Error(`Jina Reader returned ${resp.statusCode} for URL: ${url}`));
          } else {
            resolve(d);
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

// ── Get or create collection ──────────────────────────────────────────────────

async function getOrCreateCollection(locationId, agentId) {
  const client = getClient();
  const name   = collectionName(locationId, agentId);
  return client.getOrCreateCollection({
    name,
    metadata: { locationId, agentId, createdAt: new Date().toISOString() },
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Add a document (text or URL) to the agent's knowledge base.
 * Returns { docId, chunks } on success.
 */
async function addDocument(locationId, agentId, { text, url, sourceLabel }) {
  let rawText = text;

  if (url && !text) {
    rawText = await fetchUrlText(url);
  }
  if (!rawText || rawText.trim().length === 0) {
    throw new Error('No text content to add.');
  }

  const chunks = chunkText(rawText);
  if (chunks.length === 0) throw new Error('Text too short to chunk.');

  const embeddings = await getEmbeddings(chunks);

  const collection = await getOrCreateCollection(locationId, agentId);
  const docId      = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now        = new Date().toISOString();

  const ids       = chunks.map((_, i) => `${docId}_chunk_${i}`);
  const metadatas = chunks.map((_, i) => ({
    docId,
    chunkIndex:  i,
    totalChunks: chunks.length,
    sourceLabel: sourceLabel || url || 'manual',
    url:         url || '',
    addedAt:     now,
  }));

  await collection.add({ ids, embeddings, documents: chunks, metadatas });

  return { docId, chunks: chunks.length };
}

/**
 * Semantic search: returns top-k relevant chunks for query text.
 * Returns array of { text, score, sourceLabel, url, docId }.
 */
async function queryKnowledge(locationId, agentId, queryText, k = 5) {
  const collection = await getOrCreateCollection(locationId, agentId);
  const count      = await collection.count();
  if (count === 0) return [];

  const queryEmbedding = await getQueryEmbedding(queryText);
  const results        = await collection.query({
    queryEmbeddings: [queryEmbedding],
    nResults:        Math.min(k, count),
    include:         ['documents', 'metadatas', 'distances'],
  });

  const docs      = results.documents[0]  || [];
  const metas     = results.metadatas[0]  || [];
  const distances = results.distances[0]  || [];

  return docs.map((doc, i) => ({
    text:        doc,
    score:       1 - (distances[i] || 0),  // cosine similarity
    sourceLabel: metas[i]?.sourceLabel || '',
    url:         metas[i]?.url || '',
    docId:       metas[i]?.docId || '',
  }));
}

/**
 * List unique documents in the agent's knowledge base.
 * Returns array of { docId, sourceLabel, url, addedAt, chunks }.
 */
async function listDocuments(locationId, agentId) {
  const collection = await getOrCreateCollection(locationId, agentId);
  const count      = await collection.count();
  if (count === 0) return [];

  // Fetch all items (limit to 1000 for safety)
  const all = await collection.get({ limit: 1000, include: ['metadatas'] });
  const map = new Map();

  for (const meta of (all.metadatas || [])) {
    if (!map.has(meta.docId)) {
      map.set(meta.docId, {
        docId:       meta.docId,
        sourceLabel: meta.sourceLabel,
        url:         meta.url,
        addedAt:     meta.addedAt,
        chunks:      0,
      });
    }
    map.get(meta.docId).chunks++;
  }

  return Array.from(map.values()).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

/**
 * Delete a document (all its chunks) from the knowledge base.
 */
async function deleteDocument(locationId, agentId, docId) {
  const collection = await getOrCreateCollection(locationId, agentId);
  const all        = await collection.get({ limit: 1000, include: ['metadatas'] });
  const toDelete   = [];

  (all.ids || []).forEach((id, i) => {
    if ((all.metadatas[i] || {}).docId === docId) toDelete.push(id);
  });

  if (toDelete.length === 0) throw new Error(`Document ${docId} not found.`);
  await collection.delete({ ids: toDelete });
  return { deleted: toDelete.length };
}

/**
 * Delete the entire collection for an agent (called when agent is deleted).
 */
async function deleteCollection(locationId, agentId) {
  try {
    const client = getClient();
    const name   = collectionName(locationId, agentId);
    await client.deleteCollection(name);
  } catch (err) {
    // Collection may not exist — not fatal
    console.warn(`[Chroma] deleteCollection warning: ${err.message}`);
  }
}

/**
 * Get collection status: enabled flag + total chunk count.
 */
async function getStatus(locationId, agentId) {
  if (!config.isChromaEnabled) {
    return { enabled: false, chunks: 0, docs: 0 };
  }
  try {
    const collection = await getOrCreateCollection(locationId, agentId);
    const chunks     = await collection.count();
    const docs       = chunks > 0 ? (await listDocuments(locationId, agentId)).length : 0;
    return { enabled: true, chunks, docs };
  } catch (err) {
    console.error('[Chroma] getStatus error:', err.message);
    return { enabled: true, chunks: 0, docs: 0, error: err.message };
  }
}

// ── YouTube transcript extraction ─────────────────────────────────────────────

/**
 * Extract video ID from any YouTube URL format.
 */
function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

/**
 * Fetch YouTube transcript using youtube-captions-scraper.
 * Returns plain text of the full transcript.
 */
async function fetchYoutubeTranscript(videoUrl) {
  const videoId = extractVideoId(videoUrl);
  if (!videoId) throw new Error('Invalid YouTube URL — could not extract video ID.');

  const { getSubtitles } = require('youtube-captions-scraper');
  let captions;
  try {
    captions = await getSubtitles({ videoID: videoId, lang: 'en' });
  } catch {
    // Fall back to auto-generated captions
    captions = await getSubtitles({ videoID: videoId, lang: 'en', auto: true });
  }

  if (!captions || captions.length === 0) {
    throw new Error('No captions/transcript available for this video.');
  }

  // Merge caption segments into readable paragraphs (group every ~10 lines)
  const lines = captions.map(c => c.text.replace(/\n/g, ' ').trim()).filter(Boolean);
  const paragraphs = [];
  for (let i = 0; i < lines.length; i += 10) {
    paragraphs.push(lines.slice(i, i + 10).join(' '));
  }
  return paragraphs.join('\n\n');
}

/**
 * Ingest a YouTube video into a knowledge base collection.
 * Returns { docId, chunks, videoId, title }.
 */
async function addYoutubeVideo(locationId, agentId, videoUrl, titleHint) {
  const videoId   = extractVideoId(videoUrl);
  if (!videoId) throw new Error('Invalid YouTube URL.');

  const transcript = await fetchYoutubeTranscript(videoUrl);
  const label      = titleHint || `YouTube: ${videoId}`;

  const result = await addDocument(locationId, agentId, {
    text:        transcript,
    url:         `https://www.youtube.com/watch?v=${videoId}`,
    sourceLabel: label,
  });

  return { ...result, videoId, title: label };
}

module.exports = {
  isEnabled:             () => config.isChromaEnabled,
  addDocument,
  addYoutubeVideo,
  queryKnowledge,
  listDocuments,
  deleteDocument,
  deleteCollection,
  getStatus,
  extractVideoId,
};
