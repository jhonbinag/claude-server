/**
 * src/services/brainStore.js
 *
 * Multi-brain Redis-backed knowledge base — no Chroma/Jina required.
 * Uses Upstash Redis REST API (same pattern as redisStore.js).
 *
 * Key layout:
 *   hltools:brains:{locationId}                        → array of brain metadata
 *   hltools:brain:{locationId}:{brainId}:docs          → array of doc metadata
 *   hltools:brain:{locationId}:{brainId}:chunks:{docId} → array of chunks
 *
 * Search: keyword/TF-IDF scoring; primary channel docs boosted 1.5×.
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
      headers: {
        Authorization:   `Bearer ${REDIS_TOKEN}`,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const p = JSON.parse(d);
          if (p.error) reject(new Error(p.error));
          else resolve(p.result);
        } catch (e) {
          reject(new Error(`Redis parse error: ${d}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function rGet(key) {
  if (!isRedisEnabled) return _mem[key] !== undefined ? _mem[key] : null;
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

async function rSAdd(key, member) {
  if (!isRedisEnabled) { _mem[key] = [...(_mem[key] || []).filter(x => x !== member), member]; return; }
  await redisReq(['SADD', key, member]);
}

async function rSMembers(key) {
  if (!isRedisEnabled) return _mem[key] || [];
  const r = await redisReq(['SMEMBERS', key]);
  return Array.isArray(r) ? r : [];
}

async function rSRem(key, member) {
  if (!isRedisEnabled) { _mem[key] = (_mem[key] || []).filter(x => x !== member); return; }
  await redisReq(['SREM', key, member]);
}

// ── Key helpers ───────────────────────────────────────────────────────────────

const brainsKey         = (loc)                => `hltools:brains:${loc}`;
const docsKey           = (loc, brainId)       => `hltools:brain:${loc}:${brainId}:docs`;
const chunksKey         = (loc, brainId, docId)=> `hltools:brain:${loc}:${brainId}:chunks:${docId}`;
const syncQueueKey      = (loc, brainId)       => `hltools:brain:${loc}:${brainId}:syncqueue`;
const videosKey         = (loc, brainId)       => `hltools:brain:${loc}:${brainId}:videos`;
const discoverKey       = (loc, brainId, chId) => `hltools:brain:${loc}:${brainId}:disc:${chId}`;
const BRAIN_LOCS_KEY    = 'hltools:brain-locations'; // Redis set of all locationIds with brains

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
    score += matches * (1 + term.length / 10);
  }
  return score;
}

// ── Slug helper ───────────────────────────────────────────────────────────────

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

// ── Handle extractor ──────────────────────────────────────────────────────────

function extractHandle(url) {
  if (!url) return '';
  const m = url.match(/youtube\.com\/@([^/?&]+)/);
  if (m) return '@' + m[1];
  const m2 = url.match(/youtube\.com\/channel\/(UC[^/?&]+)/);
  if (m2) return m2[1];
  if (url.startsWith('@')) return url;
  return url;
}

// ── Brain CRUD ────────────────────────────────────────────────────────────────

/**
 * Create a new brain for a location.
 * Accepts optional docsUrl, changelogUrl, primaryChannel, and secondaryChannels.
 */
async function createBrain(locationId, { name, slug, description, docsUrl, changelogUrl, primaryChannel, secondaryChannels, autoSync } = {}) {
  if (!name || !name.trim()) throw new Error('"name" is required.');
  const brainId  = `brain_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const now      = new Date().toISOString();
  const finalSlug = (slug || slugify(name)).replace(/[^a-z0-9-]/g, '-');

  const channels = [];

  if (primaryChannel && primaryChannel.name) {
    channels.push({
      channelId:   `ch_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      channelName: primaryChannel.name,
      channelUrl:  primaryChannel.url || '',
      handle:      extractHandle(primaryChannel.url || ''),
      type:        'primary',
      isPrimary:   true,
      videoCount:  0,
      lastSynced:  null,
      addedAt:     now,
    });
  }

  if (Array.isArray(secondaryChannels)) {
    for (const ch of secondaryChannels) {
      if (ch.name) {
        channels.push({
          channelId:   `ch_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          channelName: ch.name,
          channelUrl:  ch.url || '',
          handle:      extractHandle(ch.url || ''),
          type:        'secondary',
          isPrimary:   false,
          videoCount:  0,
          lastSynced:  null,
          addedAt:     now,
        });
      }
    }
  }

  const brain = {
    brainId,
    name:          name.trim(),
    slug:          finalSlug,
    description:   (description || '').trim(),
    docsUrl:       (docsUrl || '').trim(),
    changelogUrl:  (changelogUrl || '').trim(),
    channels,
    autoSync:      !!autoSync,
    pipelineStage: channels.length > 0 ? 'needs_sync' : 'ready',
    pendingCount:  0,
    createdAt:     now,
    updatedAt:     now,
  };

  const brains = (await rGet(brainsKey(locationId))) || [];
  brains.push(brain);
  await rSet(brainsKey(locationId), brains);
  // Register locationId in the global set so cron can enumerate it
  await rSAdd(BRAIN_LOCS_KEY, locationId).catch(() => {});
  return brain;
}

/**
 * Update brain metadata fields (name, description, docsUrl, changelogUrl, pipelineStage, etc.)
 */
async function updateBrainMeta(locationId, brainId, fields) {
  const brains = (await rGet(brainsKey(locationId))) || [];
  const idx = brains.findIndex(b => b.brainId === brainId);
  if (idx === -1) throw new Error(`Brain "${brainId}" not found.`);
  brains[idx] = { ...brains[idx], ...fields, updatedAt: new Date().toISOString() };
  await rSet(brainsKey(locationId), brains);
  return brains[idx];
}

/**
 * List all brains for a location, including per-brain stats.
 */
async function listBrains(locationId) {
  const brains = (await rGet(brainsKey(locationId))) || [];
  // Attach quick stats (doc count, chunk count, video catalogue count)
  const withStats = await Promise.all(brains.map(async b => {
    const docs   = (await rGet(docsKey(locationId, b.brainId))) || [];
    const vids   = (await rGet(videosKey(locationId, b.brainId))) || [];
    const chunks = docs.reduce((acc, d) => acc + (d.chunkCount || 0), 0);
    const pendingVids = vids.filter(v => v.transcriptStatus === 'pending').length;
    const errorVids   = vids.filter(v => v.transcriptStatus === 'error').length;
    return { ...b, docCount: docs.length, chunkCount: chunks, videoCount: vids.length, pendingVideos: pendingVids, errorVideos: errorVids };
  }));
  return withStats;
}

/**
 * Get a single brain with its documents.
 */
async function getBrain(locationId, brainId) {
  const brains = (await rGet(brainsKey(locationId))) || [];
  const brain  = brains.find(b => b.brainId === brainId);
  if (!brain) throw new Error(`Brain "${brainId}" not found.`);
  const docs   = (await rGet(docsKey(locationId, brainId))) || [];
  const chunks = docs.reduce((acc, d) => acc + (d.chunkCount || 0), 0);
  return { ...brain, docs, chunkCount: chunks };
}

/**
 * Delete a brain and all its data.
 */
async function deleteBrain(locationId, brainId) {
  // Remove all doc chunk keys
  const docs = (await rGet(docsKey(locationId, brainId))) || [];
  await Promise.all(docs.map(d => rDel(chunksKey(locationId, brainId, d.docId))));
  await rDel(docsKey(locationId, brainId));

  // Remove from brains list
  const brains = (await rGet(brainsKey(locationId))) || [];
  const remaining = brains.filter(b => b.brainId !== brainId);
  await rSet(brainsKey(locationId), remaining);
  // If no brains left, remove location from global set
  if (remaining.length === 0) await rSRem(BRAIN_LOCS_KEY, locationId).catch(() => {});
  return { deleted: brainId };
}

/**
 * Add a channel record to a brain (metadata only — no ingestion).
 * Legacy function — kept for backward compat; delegates to addChannelToBrain.
 */
async function addChannel(locationId, brainId, { channelName, channelUrl, isPrimary = false } = {}) {
  return addChannelToBrain(locationId, brainId, { channelName, channelUrl, isPrimary });
}

/**
 * Add a channel to a brain with full new data model.
 */
async function addChannelToBrain(locationId, brainId, { channelName, channelUrl, isPrimary = false } = {}) {
  if (!channelName) throw new Error('"channelName" is required.');
  const brains = (await rGet(brainsKey(locationId))) || [];
  const idx    = brains.findIndex(b => b.brainId === brainId);
  if (idx === -1) throw new Error(`Brain "${brainId}" not found.`);

  const now = new Date().toISOString();
  const channel = {
    channelId:   `ch_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    channelName,
    channelUrl:  channelUrl || '',
    handle:      extractHandle(channelUrl || ''),
    type:        isPrimary ? 'primary' : 'secondary',
    isPrimary:   !!isPrimary,
    videoCount:  0,
    lastSynced:  null,
    addedAt:     now,
  };
  brains[idx].channels = brains[idx].channels || [];
  brains[idx].channels.push(channel);
  brains[idx].updatedAt = now;
  await rSet(brainsKey(locationId), brains);
  return channel;
}

/**
 * Remove a channel from a brain by channelId.
 */
async function removeChannelFromBrain(locationId, brainId, channelId) {
  const brains = (await rGet(brainsKey(locationId))) || [];
  const idx    = brains.findIndex(b => b.brainId === brainId);
  if (idx === -1) throw new Error(`Brain "${brainId}" not found.`);

  const before = (brains[idx].channels || []).length;
  brains[idx].channels = (brains[idx].channels || []).filter(c => c.channelId !== channelId);
  if (brains[idx].channels.length === before) throw new Error(`Channel "${channelId}" not found.`);
  brains[idx].updatedAt = new Date().toISOString();
  await rSet(brainsKey(locationId), brains);
  return { deleted: channelId };
}

// ── Document-level operations ─────────────────────────────────────────────────

/**
 * Add a text document to a brain.
 */
async function addDocument(locationId, brainId, { text, sourceLabel, url, isPrimary = false, videoMeta = null }) {
  if (!text || text.trim().length === 0) throw new Error('No text content to add.');

  // Verify brain exists
  const brains = (await rGet(brainsKey(locationId))) || [];
  if (!brains.find(b => b.brainId === brainId)) throw new Error(`Brain "${brainId}" not found.`);

  const chunks = chunkText(text);
  if (!chunks.length) throw new Error('Text too short to chunk.');

  const docId = `doc_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const now   = new Date().toISOString();

  await rSet(chunksKey(locationId, brainId, docId), chunks.map((t, i) => ({ text: t, index: i })));

  const docs = (await rGet(docsKey(locationId, brainId))) || [];
  docs.push({
    docId,
    sourceLabel: sourceLabel || url || 'manual',
    url:         url || '',
    isPrimary:   !!isPrimary,
    chunkCount:  chunks.length,
    ...(videoMeta ? { videoMeta } : {}),
    addedAt:     now,
  });
  await rSet(docsKey(locationId, brainId), docs);

  return { docId, chunks: chunks.length };
}

/**
 * Ingest a YouTube video transcript into a brain.
 * isPrimary = true boosts this doc's chunks 1.5× in search results.
 */
/**
 * Extract a JSON object assigned to a JS variable in HTML source.
 * Uses brace-counting to handle nested objects reliably.
 */
function extractEmbeddedJson(html, varName) {
  // Try both "var X = {" and "X = {" patterns
  let idx = html.indexOf(`var ${varName} = {`);
  let offset = `var ${varName} = `.length;
  if (idx === -1) {
    idx = html.indexOf(`${varName} = {`);
    offset = `${varName} = `.length;
  }
  if (idx === -1) return null;

  const jsonStart = idx + offset;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = jsonStart; i < html.length; i++) {
    const ch = html[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return html.substring(jsonStart, i + 1); }
  }
  return null;
}

const YT_PLAYER_URL      = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
const YT_RESOLVE_URL     = 'https://www.youtube.com/youtubei/v1/navigation/resolve_url?prettyPrint=false';
const YT_ANDROID_VER     = '21.03.36';
const YT_ANDROID_SDK     = 36;
const YT_ANDROID_UA      = `com.google.android.youtube/${YT_ANDROID_VER}(Linux; U; Android 16; en_US; SM-S908E Build/TP1A.220624.014) gzip`;
const YT_BROWSER_UA      = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)';

/**
 * Resolve a YouTube @handle or channel URL to a UC channel ID using the
 * InnerTube navigation/resolve_url endpoint (same transport as the player API).
 */
async function resolveHandleToChannelId(handle) {
  // handle is like '@AlexBerman' or 'AlexBerman'
  const cleanHandle = handle.startsWith('@') ? handle : '@' + handle;
  const url = `https://www.youtube.com/${cleanHandle}`;
  console.log('[resolveHandle] resolving', url);

  // ── Approach 1: youtubei.js resolveURL (handles InnerTube versioning internally) ──
  try {
    const Innertube = await getInnertube();
    const yt = await Innertube.create({ retrieve_player: false });
    const resolved = await yt.resolveURL(url);
    console.log('[resolveHandle] yt.resolveURL result:', JSON.stringify(resolved).slice(0, 500));
    const browseId = resolved?.payload?.browseId
      || resolved?.endpoint?.payload?.browseId
      || null;
    if (browseId?.startsWith('UC')) {
      console.log('[resolveHandle] resolved via yt.resolveURL:', browseId);
      return browseId;
    }
    // Scan serialized response for UC ID
    const scanMatch = JSON.stringify(resolved).match(/"(UC[a-zA-Z0-9_-]{20,})"/);
    if (scanMatch) {
      console.log('[resolveHandle] resolved via yt.resolveURL string scan:', scanMatch[1]);
      return scanMatch[1];
    }
    console.warn('[resolveHandle] yt.resolveURL returned no UC ID, trying manual resolve_url');
  } catch (e) {
    console.warn('[resolveHandle] yt.resolveURL failed:', e.message, '— trying manual resolve_url');
  }

  // ── Approach 2: manual InnerTube resolve_url with ANDROID client ──
  try {
    const visitorData = await getYtVisitorData().catch(() => null);
    const body = {
      context: {
        client: {
          clientName:       'ANDROID',
          clientVersion:    YT_ANDROID_VER,
          androidSdkVersion: YT_ANDROID_SDK,
          hl: 'en',
          gl: 'US',
          ...(visitorData ? { visitorData } : {}),
        },
      },
      url,
    };

    const res = await fetch(YT_RESOLVE_URL, {
      method:  'POST',
      headers: {
        'Content-Type':              'application/json',
        'User-Agent':                YT_ANDROID_UA,
        'X-YouTube-Client-Name':    '3',
        'X-YouTube-Client-Version': YT_ANDROID_VER,
      },
      body: JSON.stringify(body),
    });

    console.log('[resolveHandle] resolve_url status:', res.status);
    if (res.ok) {
      const json = await res.json();
      console.log('[resolveHandle] resolve_url response:', JSON.stringify(json).slice(0, 1000));

      const browseId = json?.endpoint?.browseEndpoint?.browseId
        || json?.endpoint?.channelPageEndpoint?.browseId
        || null;

      let resolvedId = browseId;
      if (!resolvedId || !resolvedId.startsWith('UC')) {
        const m = JSON.stringify(json).match(/"(UC[a-zA-Z0-9_-]{20,})"/);
        if (m) resolvedId = m[1];
      }
      if (resolvedId?.startsWith('UC')) {
        console.log('[resolveHandle] resolved via manual resolve_url:', resolvedId);
        return resolvedId;
      }
    }
    console.warn('[resolveHandle] manual resolve_url did not yield UC ID, trying HTML scrape');
  } catch (e) {
    console.warn('[resolveHandle] manual resolve_url failed:', e.message, '— trying HTML scrape');
  }

  // ── Approach 3: scrape channel page HTML for externalId / channelId ──
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': YT_BROWSER_UA },
      redirect: 'follow',
    });
    if (res.ok) {
      const html = await res.text();
      const externalId = html.match(/"externalId"\s*:\s*"(UC[a-zA-Z0-9_-]{20,})"/);
      if (externalId) {
        console.log('[resolveHandle] resolved via HTML externalId:', externalId[1]);
        return externalId[1];
      }
      const channelIdMeta = html.match(/(?:<meta[^>]+content="https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{20,})")/);
      if (channelIdMeta) {
        console.log('[resolveHandle] resolved via HTML meta tag:', channelIdMeta[1]);
        return channelIdMeta[1];
      }
      const browseIdHtml = html.match(/"browseId"\s*:\s*"(UC[a-zA-Z0-9_-]{20,})"/);
      if (browseIdHtml) {
        console.log('[resolveHandle] resolved via HTML browseId:', browseIdHtml[1]);
        return browseIdHtml[1];
      }
    }
  } catch (e) {
    console.warn('[resolveHandle] HTML scrape failed:', e.message);
  }

  throw new Error(`Could not extract UC channel ID for ${handle} — all 3 approaches failed`);
}

// Suppress youtubei.js parser warnings (non-fatal type mismatches from YouTube response changes)
let _ytImportDone = false;
async function getInnertube() {
  const mod = await import('youtubei.js');
  if (!_ytImportDone) {
    try {
      // Log.Level: 0=NONE 1=ERROR 2=WARNING 3=INFO 4=DEBUG
      mod.Log?.setLevel?.(0);
    } catch {}
    _ytImportDone = true;
  }
  return mod.Innertube;
}

// Cache visitorData for ~5 min — short enough to avoid stale bot-detect failures
let _ytVisitorData = null;
let _ytVisitorDataExpiry = 0;
async function getYtVisitorData(force = false) {
  if (!force && _ytVisitorData && Date.now() < _ytVisitorDataExpiry) return _ytVisitorData;
  try {
    const Innertube = await getInnertube();
    const yt = await Innertube.create({ retrieve_player: false });
    _ytVisitorData = yt.session.context.client.visitorData || null;
    _ytVisitorDataExpiry = Date.now() + 5 * 60 * 1000;
  } catch { _ytVisitorData = null; }
  return _ytVisitorData;
}

// ── Channel + Playlist discovery ─────────────────────────────────────────────

/**
 * Given a YouTube video URL, return the channel info and its playlists.
 */
async function getChannelFromVideo(videoUrl) {
  const m = videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  const videoId = m ? m[1] : videoUrl.length === 11 ? videoUrl : null;
  if (!videoId) throw new Error('Invalid YouTube URL.');

  const Innertube = await getInnertube();
  const yt = await Innertube.create({ retrieve_player: true });
  const info = await yt.getInfo(videoId);

  const channelId   = info.basic_info?.channel_id;
  const channelName = info.basic_info?.author;
  const videoTitle  = info.basic_info?.title;
  const thumbnail   = info.basic_info?.thumbnail?.[0]?.url || null;

  if (!channelId) throw new Error('Could not detect channel from this video.');

  // Fetch channel playlists
  const channel   = await yt.getChannel(channelId);
  const plTab     = await channel.getPlaylists();
  const plItems   = plTab?.playlists || [];

  const playlists = plItems.map(pl => ({
    id:        pl.content_id,
    title:     pl.metadata?.title?.text || pl.metadata?.title?.runs?.[0]?.text || 'Untitled Playlist',
    thumbnail: pl.content_image?.primary_thumbnail?.image?.[0]?.url || null,
    videoCount: (() => {
      const badge = pl.content_image?.overlays?.[0]?.badges?.[0]?.text || '';
      const n = parseInt(badge);
      return isNaN(n) ? null : n;
    })(),
  })).filter(pl => pl.id);

  return { channelId, channelName, videoTitle, thumbnail, playlists };
}

/**
 * Ingest all videos from a YouTube playlist into a brain.
 * Returns { ingested, skipped, errors } counts.
 * Optionally accepts channelId to update channel stats after ingestion.
 */
async function addPlaylistToBrain(locationId, brainId, playlistId, { isPrimary = false, onProgress, channelId } = {}) {
  const Innertube = await getInnertube();
  const yt = await Innertube.create({ retrieve_player: false });

  console.log('[addPlaylistToBrain] fetching playlist:', playlistId);
  const playlist = await yt.getPlaylist(playlistId);
  let videos = playlist.videos || [];
  console.log('[addPlaylistToBrain] first page videos:', videos.length, '| has_continuation:', playlist.has_continuation);

  // Fetch all pages
  let cont = playlist;
  let page = 1;
  while (cont.has_continuation) {
    try {
      cont = await cont.getContinuation();
      const added = cont.videos || [];
      videos = videos.concat(added);
      page++;
      console.log('[addPlaylistToBrain] page', page, 'fetched', added.length, 'more, total:', videos.length);
    } catch (e) {
      console.warn('[addPlaylistToBrain] continuation failed at page', page, ':', e.message);
      break;
    }
  }

  const results = { ingested: 0, skipped: 0, errors: [] };
  console.log('[addPlaylistToBrain] processing', videos.length, 'videos from playlist', playlistId);

  for (let vi = 0; vi < videos.length; vi++) {
    const video   = videos[vi];
    const videoId = video.id;
    if (!videoId) { results.skipped++; continue; }
    const title = video.title?.toString() || `Video ${videoId}`;
    process.stdout.write(`[addPlaylistToBrain] [${vi + 1}/${videos.length}] ${videoId} "${title.slice(0, 60)}"\n`);
    try {
      if (onProgress) onProgress({ videoId, title, status: 'ingesting' });
      await addYoutubeVideo(locationId, brainId, videoId, title, isPrimary);
      results.ingested++;
      process.stdout.write(`[addPlaylistToBrain]   ✓ ingested (total: ${results.ingested})\n`);
    } catch (e) {
      results.errors.push({ videoId, title, error: e.message });
      results.skipped++;
      process.stdout.write(`[addPlaylistToBrain]   ✗ failed: ${e.message}\n`);
    }
    // Small delay to avoid hammering YouTube
    await new Promise(r => setTimeout(r, 500));
  }
  console.log('[addPlaylistToBrain] done — ingested:', results.ingested, 'skipped:', results.skipped, 'errors:', results.errors.length);

  // Update matching channel's videoCount and lastSynced
  if (channelId) {
    try {
      const brains = (await rGet(brainsKey(locationId))) || [];
      const idx    = brains.findIndex(b => b.brainId === brainId);
      if (idx !== -1) {
        const chIdx = (brains[idx].channels || []).findIndex(c => c.channelId === channelId);
        if (chIdx !== -1) {
          brains[idx].channels[chIdx].videoCount  = (brains[idx].channels[chIdx].videoCount || 0) + results.ingested;
          brains[idx].channels[chIdx].lastSynced  = new Date().toISOString();
          brains[idx].updatedAt = new Date().toISOString();
          await rSet(brainsKey(locationId), brains);
        }
      }
    } catch { /* non-fatal */ }
  }

  return results;
}

async function getYoutubeOAuthToken(locationId) {
  if (!locationId) return null;
  try {
    const registry = require('../tools/toolRegistry');
    const configs  = await registry.getToolConfig(locationId);
    const yt = configs && configs.social_youtube;
    if (!yt || !yt.accessToken) return null;

    // Check if token needs refresh (Google tokens expire after 1h)
    if (yt.refreshToken && yt.tokenExpiry && Date.now() > yt.tokenExpiry - 60000) {
      const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id:     process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          refresh_token: yt.refreshToken,
          grant_type:    'refresh_token',
        }),
      });
      if (r.ok) {
        const data = await r.json();
        const newToken = {
          ...yt,
          accessToken: data.access_token,
          tokenExpiry: Date.now() + (data.expires_in || 3600) * 1000,
        };
        await registry.saveToolConfig(locationId, 'social_youtube', newToken);
        return data.access_token;
      }
    }
    return yt.accessToken;
  } catch { return null; }
}

async function fetchYoutubeTranscript(videoId, locationId) {
  const tag = `[fetchTranscript ${videoId}]`;
  const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  // Helper: given caption tracks array, fetch the best caption XML and return parsed result
  async function fetchCaptionXml(tracks, title, lengthSecs, viewCount, publishDate, label) {
    const track = tracks.find(t => (t.languageCode || t.language_code) === 'en')
      || tracks.find(t => (t.languageCode || t.language_code || '').startsWith('en'))
      || tracks[0];
    const url = track.baseUrl || track.base_url;
    const lang = track.languageCode || track.language_code;
    console.log(tag, `${label}: fetching caption lang=${lang}`);
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9' },
    });
    if (!res.ok) throw new Error(`Caption fetch ${res.status}`);
    const xml = await res.text();
    if (!xml || xml.length < 50) throw new Error('Empty caption response');
    console.log(tag, `${label}: got caption XML, length: ${xml.length}`);
    const parsed = parseYoutubeXml(xml, title);
    return { ...parsed, lengthSecs, viewCount, publishDate };
  }

  // Helper: get video metadata from youtubei.js (works even when captions don't)
  let ytMeta = null;
  try {
    const Innertube = await getInnertube();
    const yt = await Innertube.create({ retrieve_player: true });
    const info = await yt.getInfo(videoId);
    ytMeta = {
      title:       info.basic_info?.title || null,
      lengthSecs:  parseInt(info.basic_info?.duration || 0, 10),
      viewCount:   parseInt(info.basic_info?.view_count || 0, 10),
      publishDate: info.primary_info?.published?.text || null,
    };
  } catch (e) { console.warn(tag, 'metadata fetch failed:', e.message); }

  // ── Approach 1: Supadata API (third-party transcript service — most reliable) ──
  const SUPADATA_KEY = process.env.SUPADATA_API_KEY;
  if (SUPADATA_KEY) {
    try {
      console.log(tag, 'trying Supadata API');
      const res = await fetch(`https://api.supadata.ai/v1/youtube/transcript?videoId=${videoId}&text=true`, {
        headers: { 'x-api-key': SUPADATA_KEY },
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Supadata returned ${res.status}: ${errBody.slice(0, 200)}`);
      }
      const data = await res.json();
      const content = data.content;
      if (typeof content === 'string' && content.length > 20) {
        // text=true returns plain text
        console.log(tag, 'Supadata: got plain text transcript, length:', content.length);
        return {
          transcript: content,
          title: ytMeta?.title || null,
          lengthSecs: ytMeta?.lengthSecs || 0,
          viewCount: ytMeta?.viewCount || 0,
          publishDate: ytMeta?.publishDate || null,
        };
      }
      if (Array.isArray(content) && content.length > 0) {
        // content is array of {text, offset, duration}
        const lines = content.map(s => (s.text || '').trim()).filter(Boolean);
        if (lines.length > 0) {
          const paragraphs = [];
          for (let i = 0; i < lines.length; i += 10) paragraphs.push(lines.slice(i, i + 10).join(' '));
          console.log(tag, 'Supadata: got transcript:', lines.length, 'segments');
          return {
            transcript: paragraphs.join('\n\n'),
            title: ytMeta?.title || null,
            lengthSecs: ytMeta?.lengthSecs || 0,
            viewCount: ytMeta?.viewCount || 0,
            publishDate: ytMeta?.publishDate || null,
          };
        }
      }
      console.warn(tag, 'Supadata: empty transcript response');
    } catch (e) { console.warn(tag, 'Supadata failed:', e.message); }
  } else {
    console.log(tag, 'SUPADATA_API_KEY not set — skipping Supadata');
  }

  // ── Approach 2: youtubei.js WEB client (getTranscript + caption tracks) ──
  try {
    console.log(tag, 'trying youtubei.js WEB client');
    const Innertube = await getInnertube();
    const yt = await Innertube.create({ retrieve_player: true });
    const info = await yt.getInfo(videoId);
    const title       = info.basic_info?.title || null;
    const lengthSecs  = parseInt(info.basic_info?.duration || 0, 10);
    const viewCount   = parseInt(info.basic_info?.view_count || 0, 10);
    const publishDate = info.primary_info?.published?.text || null;

    try {
      const td = await info.getTranscript();
      const segments = td?.content?.body?.initial_segments || td?.content?.body?.segments || [];
      const lines = segments.map(s => ((s.snippet || s).text || '').trim()).filter(Boolean);
      if (lines.length > 0) {
        const paragraphs = [];
        for (let i = 0; i < lines.length; i += 10) paragraphs.push(lines.slice(i, i + 10).join(' '));
        console.log(tag, 'got transcript via getTranscript():', lines.length, 'lines');
        return { transcript: paragraphs.join('\n\n'), title, lengthSecs, viewCount, publishDate };
      }
    } catch (e) { console.warn(tag, 'getTranscript() failed:', e.message); }

    const captions = info.captions?.caption_tracks;
    if (captions?.length) return await fetchCaptionXml(captions, title, lengthSecs, viewCount, publishDate, 'youtubei.js');
    console.warn(tag, 'youtubei.js: no usable captions');
  } catch (e) { console.warn(tag, 'youtubei.js failed:', e.message); }

  // ── Approach 3: HTML scrape with consent cookie ──
  try {
    console.log(tag, 'trying HTML scrape with consent cookie');
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const htmlRes = await fetch(watchUrl, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Cookie': 'CONSENT=PENDING+999; SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgJnSmgY',
      },
      redirect: 'follow',
    });
    if (!htmlRes.ok) throw new Error(`Watch page returned ${htmlRes.status}`);
    const html = await htmlRes.text();

    const playerJsonStr = extractEmbeddedJson(html, 'ytInitialPlayerResponse');
    if (!playerJsonStr) throw new Error('ytInitialPlayerResponse not found');
    const pj = JSON.parse(playerJsonStr);
    const ps = pj.playabilityStatus?.status;
    console.log(tag, 'HTML scrape playability:', ps);
    if (ps && ps !== 'OK') throw new Error(`HTML scrape: ${ps}`);
    const tracks = pj.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!tracks?.length) throw new Error('No captions in HTML');
    return await fetchCaptionXml(tracks,
      pj.videoDetails?.title || null,
      parseInt(pj.videoDetails?.lengthSeconds || 0, 10),
      parseInt(pj.videoDetails?.viewCount || 0, 10),
      pj.microformat?.playerMicroformatRenderer?.publishDate || null,
      'HTML scrape');
  } catch (e) { console.warn(tag, 'HTML scrape failed:', e.message); }

  // ── Approach 4: Android client (last resort) ──
  try {
    console.log(tag, 'trying Android client (last resort)');
    const visitorData = await getYtVisitorData(true).catch(() => null);
    const res = await fetch(YT_PLAYER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': YT_ANDROID_UA },
      body: JSON.stringify({
        context: { client: { clientName: 'ANDROID', clientVersion: YT_ANDROID_VER, androidSdkVersion: YT_ANDROID_SDK, hl: 'en', gl: 'US', ...(visitorData ? { visitorData } : {}) } },
        videoId,
      }),
    });
    if (!res.ok) throw new Error(`Android API returned ${res.status}`);
    const pj = await res.json();
    const ps = pj.playabilityStatus?.status;
    if (ps && ps !== 'OK') throw new Error(`Android: ${pj.playabilityStatus?.reason || ps}`);
    const tracks = pj.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!tracks?.length) throw new Error('No captions (Android)');
    return await fetchCaptionXml(tracks,
      pj.videoDetails?.title || null,
      parseInt(pj.videoDetails?.lengthSeconds || 0, 10),
      parseInt(pj.videoDetails?.viewCount || 0, 10),
      pj.microformat?.playerMicroformatRenderer?.publishDate || null,
      'Android');
  } catch (e) {
    console.warn(tag, 'Android client failed:', e.message);
    throw new Error(`All transcript approaches failed for ${videoId}: ${e.message}`);
  }
}

function parseYoutubeXml(xml, title) {
  function decodeEntities(s) {
    return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
            .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
  }

  const lines = [];
  const pMatches = [...xml.matchAll(/<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g)];
  if (pMatches.length > 0) {
    for (const [, , , inner] of pMatches) {
      const sMatches = [...inner.matchAll(/<s[^>]*>([^<]*)<\/s>/g)];
      const text = sMatches.length > 0
        ? sMatches.map(m => m[1]).join('')
        : inner.replace(/<[^>]+>/g, '');
      const decoded = decodeEntities(text).replace(/\n/g, ' ').trim();
      if (decoded) lines.push(decoded);
    }
  } else {
    for (const [, , , text] of xml.matchAll(/<text[^>]*>([^<]*)<\/text>/g)) {
      const decoded = decodeEntities(text).replace(/\n/g, ' ').trim();
      if (decoded) lines.push(decoded);
    }
  }

  const paragraphs = [];
  for (let i = 0; i < lines.length; i += 10) paragraphs.push(lines.slice(i, i + 10).join(' '));
  return { transcript: paragraphs.join('\n\n'), title };
}

async function addYoutubeVideo(locationId, brainId, videoUrl, titleHint, isPrimary = false) {
  const m = videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  const videoId = m ? m[1] : videoUrl.length === 11 ? videoUrl : null;
  if (!videoId) throw new Error('Invalid YouTube URL — could not extract video ID.');

  const { transcript, title: pageTitle, lengthSecs, viewCount, publishDate } =
    await fetchYoutubeTranscript(videoId, locationId);
  if (!transcript || transcript.trim().length < 50) throw new Error('Transcript too short or unavailable for this video.');

  const label  = titleHint || pageTitle || `YouTube: ${videoId}`;
  const result = await addDocument(locationId, brainId, {
    text:        transcript,
    url:         `https://www.youtube.com/watch?v=${videoId}`,
    sourceLabel: label,
    isPrimary:   !!isPrimary,
    // YouTube metadata stored on the doc for display in Videos tab
    videoMeta: {
      lengthSecs:  lengthSecs  || 0,
      viewCount:   viewCount   || 0,
      publishDate: publishDate || null,
    },
  });

  return { ...result, videoId, title: label };
}

/**
 * Keyword search across all chunks in a brain.
 * Primary-channel docs get a 1.5× score boost.
 */
async function queryKnowledge(locationId, brainId, queryText, k = 5) {
  const tag = `[queryKnowledge loc=${locationId?.slice(0,8)} brain=${brainId?.slice(-6)}]`;
  process.stdout.write(`${tag} query="${queryText}" k=${k}\n`);

  const docs = (await rGet(docsKey(locationId, brainId))) || [];
  process.stdout.write(`${tag} docs=${docs.length}\n`);
  if (!docs.length) {
    process.stdout.write(`${tag} ✗ no indexed documents\n`);
    return [];
  }

  const queryTerms = queryText.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  process.stdout.write(`${tag} terms=[${queryTerms.join(', ')}]\n`);

  const scored = [];
  let totalChunks = 0;
  for (const doc of docs) {
    const chunks = (await rGet(chunksKey(locationId, brainId, doc.docId))) || [];
    totalChunks += chunks.length;
    const boost  = doc.isPrimary ? 1.5 : 1.0;
    for (const chunk of chunks) {
      const raw   = scoreChunk(chunk.text, queryTerms);
      const score = raw * boost;
      if (score > 0) {
        scored.push({
          text:        chunk.text,
          score,
          sourceLabel: doc.sourceLabel,
          url:         doc.url,
          docId:       doc.docId,
          isPrimary:   !!doc.isPrimary,
        });
      }
    }
  }

  const results = scored.sort((a, b) => b.score - a.score).slice(0, k);
  process.stdout.write(`${tag} scanned=${totalChunks} chunks | matched=${scored.length} | returning top ${results.length}\n`);
  if (results.length > 0) {
    results.forEach((r, i) =>
      process.stdout.write(`${tag}   [${i + 1}] score=${r.score.toFixed(3)} source="${r.sourceLabel}"\n`)
    );
  } else {
    process.stdout.write(`${tag} ✗ no chunks matched query terms\n`);
  }

  return results;
}

/**
 * List all documents in a brain.
 */
async function listDocuments(locationId, brainId) {
  return (await rGet(docsKey(locationId, brainId))) || [];
}

/**
 * Delete a document and its chunks from a brain.
 */
async function deleteDocument(locationId, brainId, docId) {
  await rDel(chunksKey(locationId, brainId, docId));
  const docs = (await rGet(docsKey(locationId, brainId))) || [];
  await rSet(docsKey(locationId, brainId), docs.filter(d => d.docId !== docId));
  return { deleted: docId };
}

/**
 * Get status for a brain.
 */
async function getStatus(locationId, brainId) {
  const docs   = (await rGet(docsKey(locationId, brainId))) || [];
  const chunks = docs.reduce((a, d) => a + (d.chunkCount || 0), 0);
  return {
    enabled: true,
    backend: isRedisEnabled ? 'redis' : 'memory',
    docs:    docs.length,
    chunks,
  };
}

/**
 * Get all playlists for a YouTube channel given its URL, @handle, or UC ID.
 */
async function getChannelPlaylists(channelUrl) {
  console.log('[getChannelPlaylists] input channelUrl:', channelUrl);
  const Innertube = await getInnertube();

  // ── Step 1: resolve a UC channel ID ─────────────────────────────────────────
  let channelId = null;

  const videoMatch = (channelUrl || '').match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  const ucMatch    = (channelUrl || '').match(/youtube\.com\/channel\/(UC[^/?&]+)/);
  const atMatch    = (channelUrl || '').match(/youtube\.com\/@([^/?&]+)/);
  const bareUc     = /^UC[a-zA-Z0-9_-]{20,}$/.test(channelUrl || '') ? channelUrl : null;

  console.log('[getChannelPlaylists] videoMatch:', videoMatch?.[1] || null,
    '| ucMatch:', ucMatch?.[1] || null,
    '| atMatch:', atMatch?.[1] || null,
    '| bareUc:', bareUc);

  if (videoMatch) {
    // Resolve through video info — player endpoint, most reliable
    const videoId = videoMatch[1];
    console.log('[getChannelPlaylists] resolving channelId via video', videoId);
    try {
      const yt   = await Innertube.create({ retrieve_player: true });
      const info = await yt.getInfo(videoId);
      channelId  = info.basic_info?.channel_id || null;
      console.log('[getChannelPlaylists] resolved channelId from video:', channelId);
    } catch (e) {
      console.error('[getChannelPlaylists] yt.getInfo failed:', e.message, e.stack);
      throw new Error(`Could not fetch video info for ${videoId}: ${e.message}`);
    }
  } else if (ucMatch) {
    channelId = ucMatch[1];
    console.log('[getChannelPlaylists] using UC ID from URL:', channelId);
  } else if (bareUc) {
    channelId = bareUc;
    console.log('[getChannelPlaylists] using bare UC ID:', channelId);
  }

  // ── Step 2: if we have a UC ID, use uploads playlist (avoids browse API) ────
  if (channelId) {
    const uploadsId = 'UU' + channelId.slice(2);
    console.log('[getChannelPlaylists] using uploads playlist:', uploadsId, 'for channel:', channelId);

    // Verify the uploads playlist exists before returning
    try {
      const yt  = await Innertube.create({ retrieve_player: false });
      const pl  = await yt.getPlaylist(uploadsId);
      const cnt = pl?.videos?.length || 0;
      console.log('[getChannelPlaylists] uploads playlist OK, ~', cnt, 'videos visible on first page');
    } catch (e) {
      console.warn('[getChannelPlaylists] uploads playlist probe failed:', e.message, '— returning anyway');
    }

    return [{ id: uploadsId, title: 'All Videos (uploads)' }];
  }

  // ── Step 3: @handle — use InnerTube resolve_url (same transport as player API) ─
  const handle = atMatch ? ('@' + atMatch[1]) : (channelUrl?.startsWith('@') ? channelUrl : null);
  if (!handle) {
    console.error('[getChannelPlaylists] cannot resolve identifier from:', channelUrl);
    throw new Error(`Cannot resolve channel identifier from: ${channelUrl}`);
  }

  console.log('[getChannelPlaylists] resolving @handle via InnerTube resolve_url:', handle);
  try {
    const resolvedChannelId = await resolveHandleToChannelId(handle);
    const uploadsId = 'UU' + resolvedChannelId.slice(2);
    console.log('[getChannelPlaylists] resolved', handle, '→', resolvedChannelId, '→ uploads:', uploadsId);
    return [{ id: uploadsId, title: 'All Videos (uploads)' }];
  } catch (e) {
    console.error('[getChannelPlaylists] handle resolution failed for', handle,
      '| message:', e.message, '| stack:', e.stack);
    throw e;
  }
}

/**
 * Incremental channel video discovery — designed for Vercel free tier (10s limit).
 * Each call fetches one "chunk" of work within an 8s time budget, saves progress
 * to Redis, and returns { discovering: true } until all playlist pages are fetched.
 * Once complete, writes video catalogue + sync queue and returns { discovering: false }.
 */
async function queueChannelSync(locationId, brainId, channelId) {
  const startMs   = Date.now();
  const BUDGET_MS = 8000; // 8s of 10s Vercel limit
  const tag       = `[queueSync ${brainId.slice(-6)}]`;

  const brains = (await rGet(brainsKey(locationId))) || [];
  const brain  = brains.find(b => b.brainId === brainId);
  if (!brain) throw new Error('Brain not found');
  const ch = (brain.channels || []).find(c => c.channelId === channelId);
  if (!ch) throw new Error('Channel not found');
  if (!ch.channelUrl) throw new Error('Channel has no URL');

  const dKey = discoverKey(locationId, brainId, channelId);
  let disc   = await rGet(dKey);

  // ── Phase 1: Resolve handle + get playlists (first call only) ──
  if (!disc) {
    console.log(tag, 'Phase 1: resolving playlists for', ch.channelName);
    await updateBrainMeta(locationId, brainId, { pipelineStage: 'syncing' });
    const playlists = await getChannelPlaylists(ch.channelUrl);
    disc = {
      playlists:          playlists.map(p => p.id),
      completedPlaylists: [],
      videos:             [],
    };
    await rSet(dKey, disc);
    console.log(tag, 'Phase 1 done:', playlists.length, 'playlist(s)');
    return { discovering: true, phase: 'playlists', videoCount: 0, playlistCount: playlists.length };
  }

  // ── Phase 2: Fetch videos from playlists within time budget ──
  const remaining = disc.playlists.filter(id => !disc.completedPlaylists.includes(id));
  if (remaining.length === 0) {
    return await _finalizeDiscovery(locationId, brainId, channelId, ch, disc, dKey);
  }

  const Innertube       = await getInnertube();
  const yt              = await Innertube.create({ retrieve_player: false });
  const knownVideoIds   = new Set(disc.videos.map(v => v.videoId));
  let newFound = 0;

  for (const plId of remaining) {
    if ((Date.now() - startMs) >= BUDGET_MS) break;
    console.log(tag, 'Fetching playlist', plId);
    try {
      let page = await yt.getPlaylist(plId);
      for (const v of (page.videos || [])) {
        if (v.id && !knownVideoIds.has(v.id)) {
          disc.videos.push({ videoId: v.id, title: v.title?.toString() || v.id, isPrimary: ch.type === 'primary' || ch.isPrimary, channelId });
          knownVideoIds.add(v.id);
          newFound++;
        }
      }
      while (page.has_continuation && (Date.now() - startMs) < BUDGET_MS) {
        try {
          page = await page.getContinuation();
          for (const v of (page.videos || [])) {
            if (v.id && !knownVideoIds.has(v.id)) {
              disc.videos.push({ videoId: v.id, title: v.title?.toString() || v.id, isPrimary: ch.type === 'primary' || ch.isPrimary, channelId });
              knownVideoIds.add(v.id);
              newFound++;
            }
          }
        } catch { break; }
      }
      if (!page.has_continuation) disc.completedPlaylists.push(plId);
    } catch (e) {
      console.error(tag, 'Playlist error:', e.message);
      disc.completedPlaylists.push(plId); // skip errored
    }
    await rSet(dKey, disc); // save progress after each playlist attempt
  }

  console.log(tag, `Progress: ${disc.videos.length} videos, ${disc.completedPlaylists.length}/${disc.playlists.length} playlists, +${newFound} this call`);

  if (disc.completedPlaylists.length >= disc.playlists.length) {
    return await _finalizeDiscovery(locationId, brainId, channelId, ch, disc, dKey);
  }
  return { discovering: true, phase: 'videos', videoCount: disc.videos.length,
           completedPlaylists: disc.completedPlaylists.length, totalPlaylists: disc.playlists.length };
}

/**
 * Finalize discovery — write video catalogue + sync queue, clean up state.
 */
async function _finalizeDiscovery(locationId, brainId, channelId, ch, disc, dKey) {
  const tag = `[queueSync ${brainId.slice(-6)}]`;
  const allVideos = disc.videos;

  const existing    = (await rGet(docsKey(locationId, brainId))) || [];
  const existingIds = new Set(existing.map(d => d.url?.match(/v=([a-zA-Z0-9_-]{11})/)?.[1]).filter(Boolean));
  const newVideos   = allVideos.filter(v => !existingIds.has(v.videoId));
  console.log(tag, 'Discovery complete. Total:', allVideos.length, '| already ingested:', existingIds.size, '| to queue:', newVideos.length);

  const now                  = new Date().toISOString();
  const existingVideoRecords = (await rGet(videosKey(locationId, brainId))) || [];
  const existingVideoIdSet   = new Set(existingVideoRecords.map(v => v.videoId));

  const newVideoRecords = allVideos
    .filter(v => !existingVideoIdSet.has(v.videoId))
    .map(v => ({
      videoId: v.videoId, title: v.title, channelId: v.channelId,
      channelName: ch.channelName, isPrimary: v.isPrimary,
      transcriptStatus: existingIds.has(v.videoId) ? 'complete' : 'pending',
      docId: null, lengthSecs: null, viewCount: null, publishDate: null, addedAt: now,
    }));

  const mergedVideoRecords = [...existingVideoRecords, ...newVideoRecords];
  for (const doc of existing) {
    const vid = doc.url?.match(/v=([a-zA-Z0-9_-]{11})/)?.[1];
    if (!vid) continue;
    const vr = mergedVideoRecords.find(v => v.videoId === vid);
    if (vr && vr.transcriptStatus !== 'complete') {
      vr.transcriptStatus = 'complete';
      vr.docId = doc.docId;
      if (doc.videoMeta) {
        vr.lengthSecs  = doc.videoMeta.lengthSecs  || null;
        vr.viewCount   = doc.videoMeta.viewCount   || null;
        vr.publishDate = doc.videoMeta.publishDate || null;
      }
    }
  }
  await rSet(videosKey(locationId, brainId), mergedVideoRecords);

  const currentQueue = (await rGet(syncQueueKey(locationId, brainId))) || [];
  const merged = [...currentQueue, ...newVideos.filter(v => !currentQueue.find(q => q.videoId === v.videoId))];
  await rSet(syncQueueKey(locationId, brainId), merged);

  // Count videos per channel so each channel row shows the correct total
  const channelVideoCount = mergedVideoRecords.filter(v => v.channelId === channelId).length;

  // Update brain-level meta + channel-level videoCount + lastSynced
  const brains2 = (await rGet(brainsKey(locationId))) || [];
  const bIdx    = brains2.findIndex(b => b.brainId === brainId);
  if (bIdx !== -1) {
    brains2[bIdx].pipelineStage  = merged.length > 0 ? 'processing' : 'ready';
    brains2[bIdx].syncQueueTotal = merged.length;
    brains2[bIdx].syncQueueDone  = 0;
    brains2[bIdx].videoCount     = mergedVideoRecords.length;
    brains2[bIdx].lastSynced     = now;
    const chIdx = (brains2[bIdx].channels || []).findIndex(c => c.channelId === channelId);
    if (chIdx !== -1) {
      brains2[bIdx].channels[chIdx].videoCount  = channelVideoCount;
      brains2[bIdx].channels[chIdx].lastSynced  = now;
    }
    await rSet(brainsKey(locationId), brains2);
  }

  await rDel(dKey);
  console.log(tag, 'Finalized — catalogue:', mergedVideoRecords.length, '| queued:', merged.length);
  return { queued: merged.length, channelName: ch.channelName, videoCount: mergedVideoRecords.length, discovering: false };
}

/**
 * Process the next batch of N videos from the sync queue.
 * Returns { processed, remaining, done, ingested, errors }.
 * Safe to call repeatedly — each call is a short Vercel function invocation.
 */
async function processSyncBatch(locationId, brainId, batchSize = 2) {
  const tag = `[syncBatch ${brainId.slice(-6)}]`;
  const queue = (await rGet(syncQueueKey(locationId, brainId))) || [];

  if (queue.length === 0) {
    console.log(tag, 'Queue empty — marking ready');
    const finalDocs   = (await rGet(docsKey(locationId, brainId))) || [];
    const finalChunks = finalDocs.reduce((a, d) => a + (d.chunkCount || 0), 0);
    await _writeSyncComplete(locationId, brainId, 0, 0, finalDocs, finalChunks, 'Batch complete');
    return { processed: 0, remaining: 0, done: true, ingested: 0, errors: 0 };
  }

  const batch    = queue.slice(0, batchSize);
  const rest     = queue.slice(batchSize);
  console.log(tag, `Processing batch of ${batch.length}, remaining after: ${rest.length}`);

  let ingested = 0;
  let errors   = 0;
  for (const item of batch) {
    process.stdout.write(`${tag} [${item.videoId}] "${(item.title || '').slice(0, 50)}"\n`);
    try {
      const result = await addYoutubeVideo(locationId, brainId, item.videoId, item.title, item.isPrimary);
      ingested++;
      process.stdout.write(`${tag}   ✓ ingested (docId: ${result.docId})\n`);
      // Update video record status to complete
      _updateVideoRecord(locationId, brainId, item.videoId, {
        transcriptStatus: 'complete',
        docId: result.docId,
      }).catch(() => {});
    } catch (e) {
      errors++;
      process.stdout.write(`${tag}   ✗ ${e.message}\n`);
      // Mark as error in video catalogue
      _updateVideoRecord(locationId, brainId, item.videoId, {
        transcriptStatus: 'error',
        transcriptError: e.message,
      }).catch(() => {});
    }
  }

  // Save remaining queue
  await rSet(syncQueueKey(locationId, brainId), rest);

  // Update progress on brain
  const brains = (await rGet(brainsKey(locationId))) || [];
  const bi     = brains.findIndex(b => b.brainId === brainId);
  const total  = (bi !== -1 ? brains[bi].syncQueueTotal : 0) || (queue.length);
  const done_n = total - rest.length;
  if (bi !== -1) {
    brains[bi].syncQueueDone = done_n;
    brains[bi].pipelineStage = rest.length === 0 ? 'ready' : 'processing';
    if (rest.length === 0) {
      const finalDocs   = (await rGet(docsKey(locationId, brainId))) || [];
      const finalChunks = finalDocs.reduce((a, d) => a + (d.chunkCount || 0), 0);
      brains[bi].docCount   = finalDocs.length;
      brains[bi].chunkCount = finalChunks;
      brains[bi].updatedAt  = new Date().toISOString();
      const entry = { ts: new Date().toISOString(), ingested: done_n, errors, docCount: finalDocs.length, chunkCount: finalChunks };
      brains[bi].syncLog = [ entry, ...((brains[bi].syncLog || []).slice(0, 49)) ];
    }
    await rSet(brainsKey(locationId), brains);
  }

  console.log(tag, `Batch done — ingested: ${ingested}, errors: ${errors}, remaining: ${rest.length}`);
  return { processed: batch.length, remaining: rest.length, done: rest.length === 0, ingested, errors };
}

async function _writeSyncComplete(locationId, brainId, ingested, errors, finalDocs, finalChunks, reason) {
  const brains = (await rGet(brainsKey(locationId))) || [];
  const bi     = brains.findIndex(b => b.brainId === brainId);
  if (bi !== -1) {
    brains[bi].pipelineStage = 'ready';
    brains[bi].docCount      = finalDocs.length;
    brains[bi].chunkCount    = finalChunks;
    brains[bi].updatedAt     = new Date().toISOString();
    const entry = { ts: new Date().toISOString(), ingested, errors, docCount: finalDocs.length, chunkCount: finalChunks };
    brains[bi].syncLog = [ entry, ...((brains[bi].syncLog || []).slice(0, 49)) ];
    await rSet(brainsKey(locationId), brains);
  }
  console.log(`[syncComplete] ${reason} — docs: ${finalDocs.length}, chunks: ${finalChunks}`);
}

/**
 * Background sync: fetch all playlists from every channel in a brain and ingest transcripts.
 * Updates pipelineStage on the brain as it progresses.
 */
async function syncBrainChannels(locationId, brainId) {
  const tag = `[Brain sync ${brainId.slice(-6)}]`;
  process.stdout.write(`${tag} syncBrainChannels START locationId=${locationId}\n`);
  try {
    const brains = (await rGet(brainsKey(locationId))) || [];
    const brain  = brains.find(b => b.brainId === brainId);
    if (!brain) { console.error(tag, 'Brain not found'); return; }

    const channels = brain.channels || [];
    if (!channels.length) {
      await updateBrainMeta(locationId, brainId, { pipelineStage: 'ready' });
      return;
    }

    await updateBrainMeta(locationId, brainId, { pipelineStage: 'syncing' });
    console.log(tag, `Syncing ${channels.length} channel(s)`);

    let totalIngested = 0;
    let totalErrors   = 0;

    for (const ch of channels) {
      console.log(tag, `Channel record:`, JSON.stringify({ channelId: ch.channelId, channelName: ch.channelName, channelUrl: ch.channelUrl, type: ch.type, isPrimary: ch.isPrimary }));
      if (!ch.channelUrl) {
        console.warn(tag, `  Skipping — no channelUrl`);
        continue;
      }
      console.log(tag, `Fetching playlists for ${ch.channelName} (${ch.channelUrl})`);
      let playlists = [];
      try {
        playlists = await getChannelPlaylists(ch.channelUrl);
        console.log(tag, `  Found ${playlists.length} playlists:`, playlists.map(p => `${p.title} (${p.id})`).join(', '));
      } catch (e) {
        console.error(tag, `  Failed to get playlists: ${e.message}`, e.stack);
        continue;
      }

      await updateBrainMeta(locationId, brainId, { pipelineStage: 'processing' });

      let channelVideos = 0;
      for (const pl of playlists) {
        try {
          console.log(tag, `  Ingesting playlist "${pl.title}" (${pl.id})`);
          const result = await addPlaylistToBrain(locationId, brainId, pl.id, {
            isPrimary: ch.type === 'primary' || ch.isPrimary,
            channelId: ch.channelId,
          });
          totalIngested += result.ingested || 0;
          totalErrors   += (result.errors || []).length;
          channelVideos += result.ingested || 0;
        } catch (e) {
          console.error(tag, `  Playlist error: ${e.message}`);
          totalErrors++;
        }
        // Small pause between playlists
        await new Promise(r => setTimeout(r, 300));
      }

      // Update channel stats after sync
      const updatedBrains = (await rGet(brainsKey(locationId))) || [];
      const bi = updatedBrains.findIndex(b => b.brainId === brainId);
      if (bi !== -1) {
        const ci = updatedBrains[bi].channels?.findIndex(c => c.channelId === ch.channelId);
        if (ci !== undefined && ci !== -1) {
          updatedBrains[bi].channels[ci].videoCount  = (updatedBrains[bi].channels[ci].videoCount || 0) + channelVideos;
          updatedBrains[bi].channels[ci].lastSynced  = new Date().toISOString();
          updatedBrains[bi].updatedAt = new Date().toISOString();
          await rSet(brainsKey(locationId), updatedBrains);
        }
      }
    }

    // Recount docs + chunks from Redis and write back to brain record
    const finalDocs   = (await rGet(docsKey(locationId, brainId))) || [];
    const finalChunks = finalDocs.reduce((a, d) => a + (d.chunkCount || 0), 0);
    const syncEntry   = { ts: new Date().toISOString(), ingested: totalIngested, errors: totalErrors, docCount: finalDocs.length, chunkCount: finalChunks };

    const latestBrains = (await rGet(brainsKey(locationId))) || [];
    const lbi = latestBrains.findIndex(b => b.brainId === brainId);
    if (lbi !== -1) {
      latestBrains[lbi].pipelineStage = 'ready';
      latestBrains[lbi].pendingCount  = totalErrors;
      latestBrains[lbi].docCount      = finalDocs.length;
      latestBrains[lbi].chunkCount    = finalChunks;
      latestBrains[lbi].updatedAt     = syncEntry.ts;
      latestBrains[lbi].syncLog       = [ syncEntry, ...((latestBrains[lbi].syncLog || []).slice(0, 49)) ];
      await rSet(brainsKey(locationId), latestBrains);
    }

    process.stdout.write(`${tag} syncBrainChannels DONE — ingested: ${totalIngested}, errors: ${totalErrors}, docs: ${finalDocs.length}, chunks: ${finalChunks}\n`);
  } catch (e) {
    process.stdout.write(`${tag} syncBrainChannels FAILED: ${e.message}\n${e.stack}\n`);
    await updateBrainMeta(locationId, brainId, { pipelineStage: 'ready', pendingCount: 1 }).catch(() => {});
  }
}

/**
 * Sync a single channel within a brain (background).
 */
async function syncSingleChannel(locationId, brainId, channelId) {
  const tag = `[Brain sync ${brainId.slice(-6)}]`;
  process.stdout.write(`${tag} syncSingleChannel START channelId=${channelId}\n`);
  try {
    const brains = (await rGet(brainsKey(locationId))) || [];
    const brain  = brains.find(b => b.brainId === brainId);
    if (!brain) { console.error(tag, 'Brain not found'); return; }

    const ch = (brain.channels || []).find(c => c.channelId === channelId);
    if (!ch) { console.error(tag, `Channel ${channelId} not found`); return; }
    if (!ch.channelUrl) { console.error(tag, 'Channel has no URL'); return; }

    await updateBrainMeta(locationId, brainId, { pipelineStage: 'syncing' });
    console.log(tag, `Syncing single channel — record:`, JSON.stringify({ channelId: ch.channelId, channelName: ch.channelName, channelUrl: ch.channelUrl, type: ch.type, isPrimary: ch.isPrimary }));

    let playlists = [];
    try {
      playlists = await getChannelPlaylists(ch.channelUrl);
      console.log(tag, `  Found ${playlists.length} playlists:`, playlists.map(p => `${p.title} (${p.id})`).join(', '));
    } catch (e) {
      console.error(tag, `  Failed to get playlists: ${e.message}`, e.stack);
      await updateBrainMeta(locationId, brainId, { pipelineStage: 'ready', pendingCount: 1 }).catch(() => {});
      return;
    }

    await updateBrainMeta(locationId, brainId, { pipelineStage: 'processing' });

    let channelVideos = 0;
    let errors = 0;
    for (const pl of playlists) {
      try {
        const result = await addPlaylistToBrain(locationId, brainId, pl.id, {
          isPrimary: ch.type === 'primary' || ch.isPrimary,
          channelId: ch.channelId,
        });
        channelVideos += result.ingested || 0;
        errors        += (result.errors || []).length;
      } catch (e) {
        console.error(tag, `  Playlist error: ${e.message}`);
        errors++;
      }
      await new Promise(r => setTimeout(r, 300));
    }

    // Recount docs + chunks, update channel stats, append syncLog
    const finalDocs   = (await rGet(docsKey(locationId, brainId))) || [];
    const finalChunks = finalDocs.reduce((a, d) => a + (d.chunkCount || 0), 0);
    const syncEntry   = { ts: new Date().toISOString(), channel: ch.channelName, ingested: channelVideos, errors, docCount: finalDocs.length, chunkCount: finalChunks };

    const updatedBrains = (await rGet(brainsKey(locationId))) || [];
    const bi = updatedBrains.findIndex(b => b.brainId === brainId);
    if (bi !== -1) {
      const ci = updatedBrains[bi].channels?.findIndex(c => c.channelId === channelId);
      if (ci !== undefined && ci !== -1) {
        updatedBrains[bi].channels[ci].videoCount = (updatedBrains[bi].channels[ci].videoCount || 0) + channelVideos;
        updatedBrains[bi].channels[ci].lastSynced = syncEntry.ts;
      }
      updatedBrains[bi].pipelineStage = 'ready';
      updatedBrains[bi].pendingCount  = errors;
      updatedBrains[bi].docCount      = finalDocs.length;
      updatedBrains[bi].chunkCount    = finalChunks;
      updatedBrains[bi].updatedAt     = syncEntry.ts;
      updatedBrains[bi].syncLog       = [ syncEntry, ...((updatedBrains[bi].syncLog || []).slice(0, 49)) ];
      await rSet(brainsKey(locationId), updatedBrains);
    }

    process.stdout.write(`${tag} syncSingleChannel DONE — ingested: ${channelVideos}, errors: ${errors}, docs: ${finalDocs.length}, chunks: ${finalChunks}\n`);
  } catch (e) {
    process.stdout.write(`${tag} syncSingleChannel FAILED: ${e.message}\n${e.stack}\n`);
    await updateBrainMeta(locationId, brainId, { pipelineStage: 'ready', pendingCount: 1 }).catch(() => {});
  }
}

// ── Video catalogue helpers ───────────────────────────────────────────────────

/**
 * Internal: update a single video record in the videos catalogue.
 */
async function _updateVideoRecord(locationId, brainId, videoId, fields) {
  const vids = (await rGet(videosKey(locationId, brainId))) || [];
  const vi = vids.findIndex(v => v.videoId === videoId);
  if (vi === -1) return;
  vids[vi] = { ...vids[vi], ...fields };
  await rSet(videosKey(locationId, brainId), vids);
}

/**
 * List all video records for a brain (metadata catalogue, includes transcript status).
 * Merges in any YouTube docs that aren't in the catalogue yet (backward compat).
 */
async function listVideos(locationId, brainId) {
  const vids = (await rGet(videosKey(locationId, brainId))) || [];
  const docs = (await rGet(docsKey(locationId, brainId))) || [];

  // Back-fill any YouTube docs that somehow aren't in the catalogue
  const catalogueIds = new Set(vids.map(v => v.videoId));
  for (const doc of docs) {
    const vid = doc.url?.match(/v=([a-zA-Z0-9_-]{11})/)?.[1];
    if (!vid || catalogueIds.has(vid)) continue;
    vids.push({
      videoId:          vid,
      title:            doc.sourceLabel || vid,
      channelId:        null,
      channelName:      null,
      isPrimary:        doc.isPrimary || false,
      transcriptStatus: 'complete',
      docId:            doc.docId,
      lengthSecs:       doc.videoMeta?.lengthSecs  || null,
      viewCount:        doc.videoMeta?.viewCount   || null,
      publishDate:      doc.videoMeta?.publishDate || null,
      addedAt:          doc.addedAt,
    });
  }

  return vids;
}

/**
 * Generate transcript on-demand for a single video.
 * Updates the video record status as it progresses.
 */
async function generateVideoTranscript(locationId, brainId, videoId) {
  const tag = `[genTranscript ${videoId}]`;

  // Mark as processing
  await _updateVideoRecord(locationId, brainId, videoId, { transcriptStatus: 'processing', transcriptError: null });

  const vids = (await rGet(videosKey(locationId, brainId))) || [];
  const vr   = vids.find(v => v.videoId === videoId);
  const titleHint  = vr?.title || null;
  const isPrimary  = vr?.isPrimary || false;

  try {
    process.stdout.write(`${tag} fetching transcript\n`);
    const result = await addYoutubeVideo(locationId, brainId, videoId, titleHint, isPrimary);
    process.stdout.write(`${tag} ✓ docId=${result.docId}\n`);

    // Fetch the saved doc to get videoMeta back
    const docs = (await rGet(docsKey(locationId, brainId))) || [];
    const doc  = docs.find(d => d.docId === result.docId);

    await _updateVideoRecord(locationId, brainId, videoId, {
      transcriptStatus: 'complete',
      docId:      result.docId,
      transcriptError: null,
      lengthSecs:  doc?.videoMeta?.lengthSecs  || null,
      viewCount:   doc?.videoMeta?.viewCount   || null,
      publishDate: doc?.videoMeta?.publishDate || null,
    });

    return { success: true, docId: result.docId, videoId, chunks: result.chunks };
  } catch (e) {
    process.stdout.write(`${tag} ✗ ${e.message}\n`);
    await _updateVideoRecord(locationId, brainId, videoId, {
      transcriptStatus: 'error',
      transcriptError:   e.message,
    });
    throw e;
  }
}

/**
 * Retrieve the full transcript text for a video by reassembling its chunks.
 * Returns null if the video has no indexed transcript.
 */
async function getVideoTranscriptText(locationId, brainId, videoId) {
  const vids  = (await rGet(videosKey(locationId, brainId))) || [];
  const vr    = vids.find(v => v.videoId === videoId);
  if (!vr?.docId) return null;

  const chunks = (await rGet(chunksKey(locationId, brainId, vr.docId))) || [];
  if (!chunks.length) return null;

  const header = [
    `Title:     ${vr.title || videoId}`,
    `Channel:   ${vr.channelName || ''}`,
    `Video URL: https://www.youtube.com/watch?v=${videoId}`,
    vr.publishDate ? `Published: ${vr.publishDate}` : null,
    vr.lengthSecs  ? `Duration:  ${Math.floor(vr.lengthSecs / 60)}:${String(vr.lengthSecs % 60).padStart(2, '0')}` : null,
  ].filter(Boolean).join('\n');

  const body = chunks.map(c => c.text).join('\n\n');
  return `${header}\n\n${'─'.repeat(60)}\n\n${body}`;
}

function isEnabled() {
  return true;
}

module.exports = {
  isEnabled,
  // Brain CRUD
  createBrain,
  listBrains,
  getBrain,
  deleteBrain,
  updateBrainMeta,
  addChannel,
  addChannelToBrain,
  removeChannelFromBrain,
  // Sync
  syncBrainChannels,
  syncSingleChannel,
  queueChannelSync,
  processSyncBatch,
  getChannelPlaylists,
  // Document ops
  addDocument,
  addYoutubeVideo,
  addPlaylistToBrain,
  getChannelFromVideo,
  queryKnowledge,
  listDocuments,
  deleteDocument,
  getStatus,
  // Video catalogue
  listVideos,
  generateVideoTranscript,
  getVideoTranscriptText,
  // Auto-sync
  listBrainLocations: () => rSMembers(BRAIN_LOCS_KEY),
};
