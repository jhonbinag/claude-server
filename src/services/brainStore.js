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

// ── Key helpers ───────────────────────────────────────────────────────────────

const brainsKey    = (loc)                => `hltools:brains:${loc}`;
const docsKey      = (loc, brainId)       => `hltools:brain:${loc}:${brainId}:docs`;
const chunksKey    = (loc, brainId, docId)=> `hltools:brain:${loc}:${brainId}:chunks:${docId}`;
const syncQueueKey = (loc, brainId)       => `hltools:brain:${loc}:${brainId}:syncqueue`;

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
async function createBrain(locationId, { name, slug, description, docsUrl, changelogUrl, primaryChannel, secondaryChannels } = {}) {
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
    pipelineStage: channels.length > 0 ? 'needs_sync' : 'ready',
    pendingCount:  0,
    createdAt:     now,
    updatedAt:     now,
  };

  const brains = (await rGet(brainsKey(locationId))) || [];
  brains.push(brain);
  await rSet(brainsKey(locationId), brains);
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
  // Attach quick stats (doc count, chunk count)
  const withStats = await Promise.all(brains.map(async b => {
    const docs   = (await rGet(docsKey(locationId, b.brainId))) || [];
    const chunks = docs.reduce((acc, d) => acc + (d.chunkCount || 0), 0);
    return { ...b, docCount: docs.length, chunkCount: chunks };
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
  await rSet(brainsKey(locationId), brains.filter(b => b.brainId !== brainId));
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
  console.log('[resolveHandle] resolving', url, 'via InnerTube resolve_url');

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
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[resolveHandle] resolve_url failed:', res.status, text.slice(0, 300));
    throw new Error(`resolve_url returned ${res.status}`);
  }

  const json = await res.json();
  console.log('[resolveHandle] full response:', JSON.stringify(json).slice(0, 1000));

  // Walk all known response shapes
  const browseId = json?.endpoint?.browseEndpoint?.browseId
    || json?.endpoint?.channelPageEndpoint?.browseId
    || json?.endpoint?.watchEndpoint?.videoId  // not a channel, but log it
    || null;

  // Also try scanning the whole response string for a UC ID
  let resolvedId = browseId;
  if (!resolvedId || !resolvedId.startsWith('UC')) {
    const m = JSON.stringify(json).match(/"(UC[a-zA-Z0-9_-]{20,})"/);
    if (m) {
      resolvedId = m[1];
      console.log('[resolveHandle] found UC ID via string scan:', resolvedId);
    }
  }

  console.log('[resolveHandle] resolved channel ID:', resolvedId);
  if (!resolvedId || !resolvedId.startsWith('UC')) {
    throw new Error(`Could not extract UC channel ID from resolve_url response for ${handle}`);
  }
  return resolvedId;
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
  // Priority 1: use YouTube OAuth token from Social Planner (most reliable — authenticated)
  const oauthToken = await getYoutubeOAuthToken(locationId);

  if (oauthToken) {
    try {
      // With OAuth: use official captions API to list tracks, then fetch with Bearer auth
      const listRes = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=&fields=items(snippet(title))`,
        { headers: { Authorization: `Bearer ${oauthToken}` } }
      );
      // Get title separately via a simple fetch
      const titleRes = await fetch(YT_PLAYER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': YT_ANDROID_UA },
        body: JSON.stringify({
          context: { client: { clientName: 'ANDROID', clientVersion: YT_ANDROID_VER, androidSdkVersion: YT_ANDROID_SDK, hl: 'en', gl: 'US' } },
          videoId,
        }),
      });
      const playerJson = titleRes.ok ? await titleRes.json() : {};
      const title = playerJson.videoDetails?.title || null;
      const tracks = playerJson.captions?.playerCaptionsTracklistRenderer?.captionTracks;

      if (tracks && tracks.length) {
        const track = tracks.find(t => t.languageCode === 'en') ||
                      tracks.find(t => t.languageCode?.startsWith('en')) ||
                      tracks[0];
        // Fetch caption with OAuth Bearer token — bypasses bot detection entirely
        const captionRes = await fetch(track.baseUrl, {
          headers: {
            'Authorization': `Bearer ${oauthToken}`,
            'User-Agent': YT_BROWSER_UA,
          },
        });
        if (captionRes.ok) {
          const xml = await captionRes.text();
          if (xml && xml.length > 50) return { xml, title };
        }
      }
    } catch { /* fall through to unauthenticated path */ }
  }

  // Priority 2: visitorData + Android client (unauthenticated fallback)
  // Retry once with fresh visitorData if bot-detected
  async function tryAndroidPlayer(forceRefresh) {
    const visitorData = await getYtVisitorData(forceRefresh);
    const res = await fetch(YT_PLAYER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': YT_ANDROID_UA },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: YT_ANDROID_VER,
            androidSdkVersion: YT_ANDROID_SDK,
            hl: 'en',
            gl: 'US',
            ...(visitorData ? { visitorData } : {}),
          }
        },
        videoId,
      }),
    });
    if (!res.ok) throw new Error(`YouTube player API returned ${res.status}`);
    return res.json();
  }

  let playerJson = await tryAndroidPlayer(false);
  const playability = playerJson.playabilityStatus?.status;
  if (playability && playability !== 'OK') {
    // Bot-detected — force fresh visitorData and retry once
    _ytVisitorData = null;
    playerJson = await tryAndroidPlayer(true);
    const status2 = playerJson.playabilityStatus?.status;
    if (status2 && status2 !== 'OK') {
      throw new Error(`Video unavailable: ${playerJson.playabilityStatus?.reason || status2}`);
    }
  }

  const title       = playerJson.videoDetails?.title || null;
  const lengthSecs  = parseInt(playerJson.videoDetails?.lengthSeconds || 0, 10);
  const viewCount   = parseInt(playerJson.videoDetails?.viewCount || 0, 10);
  const publishDate = playerJson.microformat?.playerMicroformatRenderer?.publishDate || null;

  const tracks = playerJson.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks || !tracks.length) throw new Error('No captions available for this video. Try a video with CC enabled.');

  const track = tracks.find(t => t.languageCode === 'en') ||
                tracks.find(t => t.languageCode?.startsWith('en')) ||
                tracks[0];

  const captionRes = await fetch(track.baseUrl, {
    headers: { 'User-Agent': YT_BROWSER_UA },
  });
  if (!captionRes.ok) throw new Error(`Caption fetch failed: ${captionRes.status}`);
  const xml = await captionRes.text();
  if (!xml || xml.length < 50) throw new Error('Empty caption response — captions may be restricted for this video.');
  const parsed = parseYoutubeXml(xml, title);
  return { ...parsed, lengthSecs, viewCount, publishDate };
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
  const docs = (await rGet(docsKey(locationId, brainId))) || [];
  if (!docs.length) return [];

  const queryTerms = queryText.toLowerCase().split(/\s+/).filter(t => t.length > 2);

  const scored = [];
  for (const doc of docs) {
    const chunks = (await rGet(chunksKey(locationId, brainId, doc.docId))) || [];
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

  return scored.sort((a, b) => b.score - a.score).slice(0, k);
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
 * Queue all video IDs from a channel's uploads playlist into Redis.
 * Returns { queued, channelName } — fast call, no transcript fetching.
 */
async function queueChannelSync(locationId, brainId, channelId) {
  const tag = `[queueChannelSync ${brainId.slice(-6)}]`;
  const brains = (await rGet(brainsKey(locationId))) || [];
  const brain  = brains.find(b => b.brainId === brainId);
  if (!brain) throw new Error('Brain not found');

  const ch = (brain.channels || []).find(c => c.channelId === channelId);
  if (!ch) throw new Error('Channel not found');
  if (!ch.channelUrl) throw new Error('Channel has no URL');

  console.log(tag, 'Resolving playlists for', ch.channelName, ch.channelUrl);
  const playlists = await getChannelPlaylists(ch.channelUrl);
  console.log(tag, 'Found', playlists.length, 'playlist(s)');

  // Collect all video IDs from all playlists
  const Innertube = await getInnertube();
  const yt = await Innertube.create({ retrieve_player: false });

  const allVideos = [];
  for (const pl of playlists) {
    console.log(tag, 'Fetching video list for playlist', pl.id);
    try {
      let page = await yt.getPlaylist(pl.id);
      let vids = page.videos || [];
      while (page.has_continuation) {
        try { page = await page.getContinuation(); vids = vids.concat(page.videos || []); }
        catch { break; }
      }
      for (const v of vids) {
        if (v.id) allVideos.push({ videoId: v.id, title: v.title?.toString() || v.id, isPrimary: ch.type === 'primary' || ch.isPrimary, channelId });
      }
      console.log(tag, 'Playlist', pl.id, '→', vids.length, 'videos (running total:', allVideos.length, ')');
    } catch (e) {
      console.error(tag, 'Playlist fetch error:', e.message);
    }
  }

  // Deduplicate by videoId
  const existing = (await rGet(docsKey(locationId, brainId))) || [];
  const existingIds = new Set(existing.map(d => d.url?.match(/v=([a-zA-Z0-9_-]{11})/)?.[1]).filter(Boolean));
  const newVideos = allVideos.filter(v => !existingIds.has(v.videoId));
  console.log(tag, 'Total:', allVideos.length, '| already ingested:', existingIds.size, '| to queue:', newVideos.length);

  // Merge with any existing queue
  const currentQueue = (await rGet(syncQueueKey(locationId, brainId))) || [];
  const merged = [...currentQueue, ...newVideos.filter(v => !currentQueue.find(q => q.videoId === v.videoId))];
  await rSet(syncQueueKey(locationId, brainId), merged);

  await updateBrainMeta(locationId, brainId, {
    pipelineStage: merged.length > 0 ? 'processing' : 'ready',
    syncQueueTotal: merged.length,
    syncQueueDone:  0,
  });

  return { queued: merged.length, channelName: ch.channelName };
}

/**
 * Process the next batch of N videos from the sync queue.
 * Returns { processed, remaining, done, ingested, errors }.
 * Safe to call repeatedly — each call is a short Vercel function invocation.
 */
async function processSyncBatch(locationId, brainId, batchSize = 5) {
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
      await addYoutubeVideo(locationId, brainId, item.videoId, item.title, item.isPrimary);
      ingested++;
      process.stdout.write(`${tag}   ✓ ingested\n`);
    } catch (e) {
      errors++;
      process.stdout.write(`${tag}   ✗ ${e.message}\n`);
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
};
