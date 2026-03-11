/**
 * JioStar Stream Proxy Server
 * ───────────────────────────
 * Endpoints:
 *  GET /api/health          → health check + cache status
 *  GET /api/m3u             → fetch & cache M3U (server-side, no CORS)
 *  GET /api/proxy/stream    → proxy HLS/DASH manifests, rewrite all URLs
 *  GET /api/proxy/segment   → proxy TS/fMP4/init segments (binary pipe)
 *  GET /api/proxy/key       → proxy AES-128 key files
 *  GET /api/proxy/image     → proxy channel logo images
 *
 * Deployed on Render.com as a single Web Service.
 */

import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { createServer } from 'http';
import { URL } from 'url';
import rateLimit from 'express-rate-limit';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const M3U_SOURCE =
  process.env.M3U_SOURCE ||
  'https://pocket-tv-tamil-5afe35.gitlab.io/jiostar.m3u';

// ── CORS ────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:3000',
  /^https:\/\/.*\.onrender\.com$/,
  /^https:\/\/.*\.vercel\.app$/,
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const ok = ALLOWED_ORIGINS.some(o =>
        typeof o === 'string' ? o === origin : o.test(origin)
      );
      if (ok || process.env.ALLOW_ALL_ORIGINS === 'true')
        return callback(null, true);
      return callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    methods: ['GET', 'HEAD', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Range', 'Accept'],
    exposedHeaders: ['Content-Range', 'Content-Length', 'Content-Type', 'Accept-Ranges'],
    credentials: false,
  })
);

app.use(express.json({ limit: '1mb' }));

// ── Rate limiting ────────────────────────────────────────────────────────────
const m3uLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  message: { error: 'Too many M3U requests.' },
  standardHeaders: true,
  legacyHeaders: false,
});
const streamLimiter = rateLimit({
  windowMs: 60_000,
  max: 600,
  message: { error: 'Too many proxy requests.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── M3U cache ────────────────────────────────────────────────────────────────
let m3uCache = { content: null, fetchedAt: 0 };
const M3U_TTL = 6 * 60 * 60 * 1000; // 6 hours

async function fetchM3U() {
  console.log(`[M3U] Fetching ${M3U_SOURCE}`);
  const res = await fetch(M3U_SOURCE, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      Accept: 'text/plain, */*',
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (!text.includes('#EXTM3U') && !text.includes('#EXTINF'))
    throw new Error('Not a valid M3U');
  console.log(`[M3U] Fetched ${text.length} bytes`);
  return text;
}

// ── URL utilities ─────────────────────────────────────────────────────────────
/**
 * Decode a URL that may be single- or double-encoded, and strip any VLC-style
 * pipe-delimited header params that got appended.
 *
 * Formats handled:
 *   https://host/stream.m3u8|Cookie=xxx&User-Agent=yyy
 *   https://host/stream.mpd?|Cookie=xxx&User-Agent=yyy      ← pipe right after ?
 *   https://host/stream.mpd?%7CCookie=xxx&User-Agent=yyy    ← encoded pipe
 *   https://host/stream.mpd?realParam=v%7CCookie=xxx        ← encoded pipe mid-QS
 */
function cleanStreamUrl(raw) {
  if (!raw) return null;

  // Step 1 – fully decode
  let url = raw;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const d = decodeURIComponent(url);
      if (d === url) break; // nothing left to decode
      url = d;
    } catch {
      break;
    }
  }

  // Step 2 – strip pipe-delimited VLC header params
  // After decoding, the pipe may appear as:
  //   |Cookie=      right in the string
  //   ?|Cookie=     pipe just after the query-string '?'
  const pipeIdx = url.indexOf('|');
  if (pipeIdx !== -1) {
    let base = url.substring(0, pipeIdx);
    // If pipe was right after '?', drop the trailing '?'
    if (base.endsWith('?')) base = base.slice(0, -1);
    url = base;
  }

  // Step 3 – validate
  try {
    new URL(url);
    return url;
  } catch {
    return null;
  }
}

/**
 * Extract VLC-style pipe params from the raw URL string.
 * Returns an object with cookie / userAgent / referer / origin.
 */
function extractPipeParams(raw) {
  if (!raw) return {};

  let decoded = raw;
  for (let i = 0; i < 3; i++) {
    try {
      const d = decodeURIComponent(decoded);
      if (d === decoded) break;
      decoded = d;
    } catch {
      break;
    }
  }

  const pipeIdx = decoded.indexOf('|');
  if (pipeIdx === -1) return {};

  const paramStr = decoded.substring(pipeIdx + 1);
  const result = {};

  // Regex-based key detection (case-insensitive)
  const keyRe = /(?:^|&)(cookie|user-agent|referer|origin)=/gi;
  const positions = [];
  let m;
  while ((m = keyRe.exec(paramStr)) !== null) {
    positions.push({ key: m[1].toLowerCase(), start: m.index + m[0].length });
  }

  for (let i = 0; i < positions.length; i++) {
    const { key, start } = positions[i];
    let end = paramStr.length;
    // Find where this value ends (start of next known key's &)
    if (i + 1 < positions.length) {
      // walk back from next key's value start to find the preceding &
      let p = positions[i + 1].start - positions[i + 1].key.length - 2; // -2 for '&' + '='
      // but we need the & that precedes the key name
      // simpler: cut at the & that appears just before next key's text
      const nextKeyName = positions[i + 1].key;
      const search = '&' + nextKeyName + '=';
      const searchCI = search.toLowerCase();
      const idx = paramStr.toLowerCase().indexOf(searchCI, start);
      if (idx !== -1) end = idx;
    }
    let value = paramStr.substring(start, end);
    try { value = decodeURIComponent(value.replace(/\+/g, ' ')); } catch { /* raw */ }
    if (key === 'cookie') result.cookie = value;
    else if (key === 'user-agent') result.userAgent = value;
    else if (key === 'referer') result.referer = value;
    else if (key === 'origin') result.origin = value;
  }

  return result;
}

/**
 * Build upstream request headers from the proxy query-string params.
 * Params: cookie, useragent, referer, origin
 */
function buildHeaders(query) {
  const h = {
    'User-Agent':
      query.useragent ||
      'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
    Accept: '*/*',
    'Accept-Encoding': 'identity',
    Connection: 'keep-alive',
  };
  if (query.cookie) h['Cookie'] = safeHeaderVal(query.cookie);
  if (query.referer) h['Referer'] = safeHeaderVal(query.referer);
  if (query.origin) h['Origin'] = safeHeaderVal(query.origin);
  return h;
}

function safeHeaderVal(v) {
  try { return decodeURIComponent(v); } catch { return v; }
}

function isForbidden(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
    if (process.env.RENDER_EXTERNAL_HOSTNAME && h === process.env.RENDER_EXTERNAL_HOSTNAME) return true;
    return false;
  } catch {
    return true;
  }
}

function resolveUrl(rel, base) {
  try { return new URL(rel, base).href; } catch { return rel; }
}

// Build the query string forwarded to proxied sub-requests
function proxyQS(query) {
  const p = new URLSearchParams();
  if (query.cookie) p.set('cookie', query.cookie);
  if (query.useragent) p.set('useragent', query.useragent);
  if (query.referer) p.set('referer', query.referer);
  if (query.origin) p.set('origin', query.origin);
  return p.toString();
}

// ── HLS manifest rewriter ─────────────────────────────────────────────────────
function rewriteHLS(manifest, baseUrl, query) {
  const base = new URL(baseUrl);
  const srv = process.env.SERVER_BASE_URL || '';
  const qs = proxyQS(query);

  return manifest
    .split('\n')
    .map(line => {
      const t = line.trim();
      if (!t) return line;

      // EXT-X-KEY URI rewrite
      if (t.startsWith('#EXT-X-KEY')) {
        return t.replace(/URI="([^"]+)"/, (_, uri) => {
          const abs = resolveUrl(uri, base);
          return `URI="${srv}/api/proxy/key?url=${encodeURIComponent(abs)}&${qs}"`;
        });
      }
      // EXT-X-MAP (init segment)
      if (t.startsWith('#EXT-X-MAP')) {
        return t.replace(/URI="([^"]+)"/, (_, uri) => {
          const abs = resolveUrl(uri, base);
          return `URI="${srv}/api/proxy/segment?url=${encodeURIComponent(abs)}&${qs}"`;
        });
      }
      // EXT-X-MEDIA or EXT-X-STREAM-INF sub-manifest URI
      if (t.startsWith('#EXT-X-MEDIA') || t.startsWith('#EXT-X-STREAM-INF')) {
        return t.replace(/URI="([^"]+)"/, (_, uri) => {
          const abs = resolveUrl(uri, base);
          return `URI="${srv}/api/proxy/stream?url=${encodeURIComponent(abs)}&${qs}"`;
        });
      }
      // Segment / sub-manifest URL lines
      if (!t.startsWith('#')) {
        const abs = resolveUrl(t, base);
        if (abs.startsWith('http')) {
          const ep = t.endsWith('.m3u8') || t.includes('.m3u8?') ? 'stream' : 'segment';
          return `${srv}/api/proxy/${ep}?url=${encodeURIComponent(abs)}&${qs}`;
        }
      }
      return line;
    })
    .join('\n');
}

// ── DASH / MPD manifest rewriter ──────────────────────────────────────────────
/**
 * Rewrites ALL URLs inside an MPD file so that every media segment and init
 * segment is fetched through /api/proxy/segment with the correct auth headers.
 *
 * Handles:
 *  - <BaseURL>…</BaseURL>
 *  - initialization="…" in SegmentTemplate
 *  - media="…" in SegmentTemplate
 *  - SegmentURL mediaRange / media attributes
 *  - Any src="…" attributes
 */
function rewriteMPD(mpd, baseUrl, query) {
  const base = new URL(baseUrl);
  const srv = process.env.SERVER_BASE_URL || '';
  const qs = proxyQS(query);

  function proxyUrl(url, isManifest = false) {
    const abs = resolveUrl(url, base);
    if (!abs.startsWith('http')) return url;
    const ep = isManifest ? 'stream' : 'segment';
    return `${srv}/api/proxy/${ep}?url=${encodeURIComponent(abs)}&${qs}`;
  }

  return mpd
    // <BaseURL>https://...</BaseURL>
    .replace(/<BaseURL[^>]*>(https?:\/\/[^<]+)<\/BaseURL>/gi, (_, url) => {
      // BaseURL can be a prefix for many segments — proxy as stream so sub-manifests work too
      const abs = resolveUrl(url.trim(), base);
      if (!abs.startsWith('http')) return _;
      // Append the proxy segment base — we route everything through segment proxy
      const proxied = `${srv}/api/proxy/segment?url=${encodeURIComponent(abs)}&${qs}`;
      return `<BaseURL>${proxied}</BaseURL>`;
    })
    // initialization="…" (may be relative or absolute)
    .replace(/\binitialization="([^"]+)"/gi, (_, url) => {
      return `initialization="${proxyUrl(url)}"`;
    })
    // media="…" in SegmentTemplate
    .replace(/\bmedia="([^"]+)"/gi, (_, url) => {
      // media templates contain $Number$ / $Time$ — keep them, just proxy the base
      // We proxy by rewriting the scheme+host portion only if absolute
      if (url.startsWith('http')) {
        return `media="${proxyUrl(url)}"`;
      }
      // Relative: resolve against base and proxy
      const abs = resolveUrl(url, base);
      return `media="${proxyUrl(abs)}"`;
    })
    // SegmentURL media="…"
    .replace(/<SegmentURL([^>]*)media="([^"]+)"([^>]*)\/>/gi, (full, pre, url, post) => {
      return `<SegmentURL${pre}media="${proxyUrl(url)}"${post}/>`;
    })
    // src="…" (rare but possible in MPD)
    .replace(/\bsrc="(https?:\/\/[^"]+)"/gi, (_, url) => {
      return `src="${proxyUrl(url)}"`;
    });
}

// ── /api/health ───────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    m3uCached: !!m3uCache.content,
    m3uAgeSeconds: m3uCache.fetchedAt
      ? Math.round((Date.now() - m3uCache.fetchedAt) / 1000)
      : null,
    m3uSource: M3U_SOURCE,
    nodeVersion: process.version,
  });
});

// ── /api/m3u ──────────────────────────────────────────────────────────────────
app.get('/api/m3u', m3uLimiter, async (req, res) => {
  const forceRefresh = req.query.refresh === 'true';
  const age = Date.now() - m3uCache.fetchedAt;

  if (!forceRefresh && m3uCache.content && age < M3U_TTL) {
    console.log(`[M3U] Cache HIT (${Math.round(age / 60000)}m old)`);
    res.set({
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': `public, max-age=${Math.round((M3U_TTL - age) / 1000)}`,
      'X-Cache': 'HIT',
      'X-Cache-Age': String(Math.round(age / 1000)),
    });
    return res.send(m3uCache.content);
  }

  try {
    const content = await fetchM3U();
    m3uCache = { content, fetchedAt: Date.now() };
    res.set({
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': `public, max-age=${M3U_TTL / 1000}`,
      'X-Cache': 'MISS',
    });
    return res.send(content);
  } catch (err) {
    console.error('[M3U] Error:', err.message);
    if (m3uCache.content) {
      console.log('[M3U] Serving stale cache');
      res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'X-Cache': 'STALE' });
      return res.send(m3uCache.content);
    }
    return res.status(502).json({ error: 'Failed to fetch M3U', detail: err.message });
  }
});

// ── /api/proxy/stream ─────────────────────────────────────────────────────────
/**
 * Proxy HLS (.m3u8) and DASH (.mpd) manifests.
 *
 * The ?url= param may arrive as:
 *   - A clean URL  (already processed by the frontend parser)
 *   - A raw M3U URL with embedded pipe params (edge case fallback)
 *
 * We clean the URL on the server side too, extracting any pipe headers
 * and merging them with explicitly-passed query params.
 */
app.get('/api/proxy/stream', streamLimiter, async (req, res) => {
  const rawParam = req.query.url;
  if (!rawParam) return res.status(400).json({ error: 'Missing ?url=' });

  // Clean the URL — strip pipe params, decode double-encoding
  const targetUrl = cleanStreamUrl(rawParam);
  if (!targetUrl) return res.status(400).json({ error: 'Invalid URL' });
  if (isForbidden(targetUrl)) return res.status(403).json({ error: 'Forbidden' });

  // Extract any pipe params that survived in the raw URL (belt-and-suspenders)
  const pipeParams = extractPipeParams(rawParam);

  // Merge: explicit query params take priority over pipe-extracted ones
  const mergedQuery = {
    cookie: req.query.cookie || pipeParams.cookie,
    useragent: req.query.useragent || pipeParams.userAgent,
    referer: req.query.referer || pipeParams.referer,
    origin: req.query.origin || pipeParams.origin,
  };

  const headers = buildHeaders(mergedQuery);
  if (req.headers.range) headers['Range'] = req.headers.range;

  console.log(`[PROXY/stream] → ${targetUrl.substring(0, 120)}`);
  if (mergedQuery.cookie) console.log(`[PROXY/stream]   cookie: ${mergedQuery.cookie.substring(0, 40)}…`);

  try {
    const upstream = await fetch(targetUrl, {
      headers,
      signal: AbortSignal.timeout(30_000),
      redirect: 'follow',
    });

    if (!upstream.ok) {
      console.warn(`[PROXY/stream] Upstream ${upstream.status} for ${targetUrl.substring(0, 80)}`);
      return res.status(upstream.status).json({
        error: `Upstream returned HTTP ${upstream.status}`,
        hint:
          upstream.status === 403
            ? 'Stream token may have expired. The M3U refreshes every 6 hours.'
            : upstream.status === 404
            ? 'Stream URL not found.'
            : 'Check if the channel is currently live.',
      });
    }

    const contentType = upstream.headers.get('content-type') || '';
    const body = await upstream.text();

    const isHLS =
      contentType.includes('mpegurl') ||
      targetUrl.includes('.m3u8') ||
      body.trimStart().startsWith('#EXTM3U');

    const isDASH =
      contentType.includes('dash+xml') ||
      targetUrl.includes('.mpd') ||
      body.trimStart().startsWith('<?xml');

    if (isHLS) {
      const rewritten = rewriteHLS(body, targetUrl, mergedQuery);
      res.set({
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-cache, no-store',
        'Access-Control-Allow-Origin': '*',
      });
      return res.send(rewritten);
    }

    if (isDASH) {
      const rewritten = rewriteMPD(body, targetUrl, mergedQuery);
      res.set({
        'Content-Type': 'application/dash+xml',
        'Cache-Control': 'no-cache, no-store',
        'Access-Control-Allow-Origin': '*',
      });
      return res.send(rewritten);
    }

    // Unknown type — pass through raw
    res.set({
      'Content-Type': contentType || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
    });
    return res.send(body);
  } catch (err) {
    console.error('[PROXY/stream] Error:', err.message);
    return res.status(502).json({ error: 'Proxy error', detail: err.message });
  }
});

// ── /api/proxy/segment ────────────────────────────────────────────────────────
app.get('/api/proxy/segment', streamLimiter, async (req, res) => {
  const rawParam = req.query.url;
  if (!rawParam) return res.status(400).json({ error: 'Missing ?url=' });

  const targetUrl = cleanStreamUrl(rawParam);
  if (!targetUrl) return res.status(400).json({ error: 'Invalid URL' });
  if (isForbidden(targetUrl)) return res.status(403).json({ error: 'Forbidden' });

  const headers = buildHeaders(req.query);
  if (req.headers.range) headers['Range'] = req.headers.range;

  console.log(`[PROXY/segment] → ${targetUrl.substring(0, 100)}`);

  try {
    const upstream = await fetch(targetUrl, {
      headers,
      signal: AbortSignal.timeout(30_000),
      redirect: 'follow',
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Upstream ${upstream.status}` });
    }

    const fwd = {
      'Content-Type': upstream.headers.get('content-type') || 'video/mp2t',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    };
    const cl = upstream.headers.get('content-length');
    const cr = upstream.headers.get('content-range');
    const ar = upstream.headers.get('accept-ranges');
    if (cl) fwd['Content-Length'] = cl;
    if (cr) fwd['Content-Range'] = cr;
    if (ar) fwd['Accept-Ranges'] = ar;

    res.writeHead(upstream.status, fwd);

    if (upstream.body) {
      upstream.body.pipe(res);
      upstream.body.on('error', err => {
        console.error('[PROXY/segment] Pipe error:', err.message);
        if (!res.writableEnded) res.end();
      });
    } else {
      const buf = await upstream.arrayBuffer();
      res.end(Buffer.from(buf));
    }
  } catch (err) {
    console.error('[PROXY/segment] Error:', err.message);
    if (!res.headersSent)
      res.status(502).json({ error: 'Segment proxy error', detail: err.message });
  }
});

// ── /api/proxy/key ────────────────────────────────────────────────────────────
app.get('/api/proxy/key', streamLimiter, async (req, res) => {
  const targetUrl = cleanStreamUrl(req.query.url);
  if (!targetUrl) return res.status(400).json({ error: 'Missing ?url=' });
  if (isForbidden(targetUrl)) return res.status(403).json({ error: 'Forbidden' });

  const headers = buildHeaders(req.query);

  try {
    const upstream = await fetch(targetUrl, {
      headers,
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
    });
    if (!upstream.ok)
      return res.status(upstream.status).json({ error: `Upstream ${upstream.status}` });
    const buf = await upstream.arrayBuffer();
    res.set({
      'Content-Type': 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    });
    res.end(Buffer.from(buf));
  } catch (err) {
    console.error('[PROXY/key] Error:', err.message);
    res.status(502).json({ error: 'Key proxy error', detail: err.message });
  }
});

// ── /api/proxy/image ──────────────────────────────────────────────────────────
app.get('/api/proxy/image', async (req, res) => {
  const targetUrl = cleanStreamUrl(req.query.url);
  if (!targetUrl) return res.status(400).end();
  if (isForbidden(targetUrl)) return res.status(403).end();

  try {
    const upstream = await fetch(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'image/*' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!upstream.ok) return res.status(upstream.status).end();
    const ct = upstream.headers.get('content-type') || 'image/png';
    const buf = await upstream.arrayBuffer();
    res.set({
      'Content-Type': ct,
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(Buffer.from(buf));
  } catch {
    res.status(502).end();
  }
});

// ── Serve built frontend ──────────────────────────────────────────────────────
const distPath = join(__dirname, '..', 'dist');

if (existsSync(distPath)) {
  console.log(`[Server] Serving static files from ${distPath}`);
  app.use(
    express.static(distPath, {
      maxAge: '1h',
      etag: true,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
          res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
      },
    })
  );
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return;
    res.sendFile(join(distPath, 'index.html'));
  });
} else {
  console.log('[Server] No dist/ folder — API-only mode');
  app.get('/', (_req, res) => {
    res.json({
      name: 'JioStar Proxy Server',
      endpoints: [
        '/api/health',
        '/api/m3u',
        '/api/proxy/stream',
        '/api/proxy/segment',
        '/api/proxy/key',
        '/api/proxy/image',
      ],
    });
  });
}

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[Server] Error:', err.message);
  res.status(500).json({ error: err.message });
});

// ── Start ─────────────────────────────────────────────────────────────────────
createServer(app).listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║       JioStar Stream Proxy  —  Started ✓             ║
╠══════════════════════════════════════════════════════╣
║  Port     : ${String(PORT).padEnd(41)}║
║  M3U      : ${M3U_SOURCE.substring(0, 41).padEnd(41)}║
║  Env      : ${(process.env.NODE_ENV || 'development').padEnd(41)}║
║  Dist     : ${(existsSync(distPath) ? 'Serving React app' : 'API-only').padEnd(41)}║
╚══════════════════════════════════════════════════════╝
  `);
});
