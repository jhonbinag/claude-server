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

const brainsKey  = (loc)              => `hltools:brains:${loc}`;
const docsKey    = (loc, brainId)     => `hltools:brain:${loc}:${brainId}:docs`;
const chunksKey  = (loc, brainId, docId) => `hltools:brain:${loc}:${brainId}:chunks:${docId}`;

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
const YT_PLAYER_URL  = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
const YT_ANDROID_VER = '21.03.36';
const YT_ANDROID_SDK = 36;
const YT_ANDROID_UA  = `com.google.android.youtube/${YT_ANDROID_VER}(Linux; U; Android 16; en_US; SM-S908E Build/TP1A.220624.014) gzip`;
const YT_BROWSER_UA  = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)';

// Cache visitorData for ~5 min — short enough to avoid stale bot-detect failures
let _ytVisitorData = null;
let _ytVisitorDataExpiry = 0;
async function getYtVisitorData(force = false) {
  if (!force && _ytVisitorData && Date.now() < _ytVisitorDataExpiry) return _ytVisitorData;
  try {
    const { Innertube } = require('youtubei.js');
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

  const { Innertube } = require('youtubei.js');
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
  const { Innertube } = require('youtubei.js');
  const yt = await Innertube.create({ retrieve_player: false });

  const playlist = await yt.getPlaylist(playlistId);
  let videos = playlist.videos || [];

  // Fetch all pages
  let cont = playlist;
  while (cont.has_continuation) {
    try {
      cont = await cont.getContinuation();
      videos = videos.concat(cont.videos || []);
    } catch { break; }
  }

  const results = { ingested: 0, skipped: 0, errors: [] };

  for (const video of videos) {
    const videoId = video.id;
    if (!videoId) { results.skipped++; continue; }
    const title = video.title?.toString() || `Video ${videoId}`;
    try {
      if (onProgress) onProgress({ videoId, title, status: 'ingesting' });
      await addYoutubeVideo(locationId, brainId, videoId, title, isPrimary);
      results.ingested++;
    } catch (e) {
      results.errors.push({ videoId, title, error: e.message });
      results.skipped++;
    }
    // Small delay to avoid hammering YouTube
    await new Promise(r => setTimeout(r, 500));
  }

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
  const { Innertube } = require('youtubei.js');
  const yt = await Innertube.create({ retrieve_player: false });

  // Resolve the channel identifier
  let identifier;
  const ucMatch  = (channelUrl || '').match(/youtube\.com\/channel\/(UC[^/?&]+)/);
  const atMatch  = (channelUrl || '').match(/youtube\.com\/@([^/?&]+)/);
  if (ucMatch)                          identifier = ucMatch[1];
  else if (atMatch)                     identifier = '@' + atMatch[1];
  else if (channelUrl?.startsWith('@')) identifier = channelUrl;
  else                                  identifier = channelUrl;

  const channel = await yt.getChannel(identifier);
  const plTab   = await channel.getPlaylists();
  const plItems = plTab?.playlists || [];

  return plItems.map(pl => ({
    id:    pl.content_id,
    title: pl.metadata?.title?.text || pl.metadata?.title?.runs?.[0]?.text || 'Untitled',
  })).filter(pl => pl.id);
}

/**
 * Background sync: fetch all playlists from every channel in a brain and ingest transcripts.
 * Updates pipelineStage on the brain as it progresses.
 */
async function syncBrainChannels(locationId, brainId) {
  const tag = `[Brain sync ${brainId.slice(-6)}]`;
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
      if (!ch.channelUrl) continue;
      console.log(tag, `Fetching playlists for ${ch.channelName} (${ch.channelUrl})`);
      let playlists = [];
      try {
        playlists = await getChannelPlaylists(ch.channelUrl);
        console.log(tag, `  Found ${playlists.length} playlists`);
      } catch (e) {
        console.error(tag, `  Failed to get playlists: ${e.message}`);
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

    await updateBrainMeta(locationId, brainId, {
      pipelineStage: 'ready',
      pendingCount:  totalErrors,
    });
    console.log(tag, `Sync complete — ${totalIngested} ingested, ${totalErrors} errors`);
  } catch (e) {
    console.error(tag, 'Sync failed:', e.message);
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
