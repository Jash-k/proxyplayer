/**
 * JioStar Stream Proxy Server
 * ───────────────────────────
 * Handles:
 *  1. GET /api/m3u            → Fetches & returns M3U playlist (no CORS issues)
 *  2. GET /api/proxy/stream   → Proxies any stream URL with injected headers
 *  3. GET /api/proxy/segment  → Proxies TS/MP4 segments with injected headers
 *  4. GET /api/proxy/key      → Proxies AES-128 decryption keys
 *  5. GET /api/health         → Health check
 *
 * Deployed on Render.com as a Web Service.
 */

import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { createServer } from 'http';
import { URL } from 'url';
import rateLimit from 'express-rate-limit';

const app = express();
const PORT = process.env.PORT || 3001;
const M3U_SOURCE = process.env.M3U_SOURCE || 'https://pocket-tv-tamil-5afe35.gitlab.io/jiostar.m3u';

// ── Allowed frontend origins ────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:3000',
  // Render preview URLs
  /^https:\/\/.*\.onrender\.com$/,
  // Vercel preview URLs (if frontend is on Vercel)
  /^https:\/\/.*\.vercel\.app$/,
  // Add your custom domain here:
  // 'https://yourdomain.com',
];

// ── CORS ────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, same-origin)
    if (!origin) return callback(null, true);
    const allowed = ALLOWED_ORIGINS.some(o =>
      typeof o === 'string' ? o === origin : o.test(origin)
    );
    if (allowed) return callback(null, true);
    // In development / when ALLOW_ALL_ORIGINS is set, allow everything
    if (process.env.ALLOW_ALL_ORIGINS === 'true') return callback(null, true);
    return callback(new Error(`CORS: Origin ${origin} not allowed`));
  },
  methods: ['GET', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Range', 'Accept', 'Authorization'],
  exposedHeaders: ['Content-Range', 'Content-Length', 'Content-Type', 'Accept-Ranges'],
  credentials: false,
}));

app.use(express.json({ limit: '1mb' }));

// ── Rate limiting ────────────────────────────────────────────────────────────
const m3uLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: { error: 'Too many M3U requests, please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const streamLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: { error: 'Too many proxy requests.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── In-memory M3U cache ──────────────────────────────────────────────────────
let m3uCache = { content: null, fetchedAt: 0 };
const M3U_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

async function fetchM3UFromSource() {
  console.log(`[M3U] Fetching from: ${M3U_SOURCE}`);
  const res = await fetch(M3U_SOURCE, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/plain, */*',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching M3U`);
  const text = await res.text();
  if (!text.includes('#EXTM3U') && !text.includes('#EXTINF')) {
    throw new Error('Response does not appear to be a valid M3U playlist');
  }
  console.log(`[M3U] Fetched ${text.length} bytes, cached.`);
  return text;
}

// ── Helper: parse proxy query params ─────────────────────────────────────────
/**
 * All proxy endpoints accept these query params:
 *   url        — required, the target URL (URL-encoded)
 *   cookie     — optional Cookie header value
 *   useragent  — optional User-Agent value
 *   referer    — optional Referer header value
 *   origin     — optional Origin header value
 */
function buildUpstreamHeaders(query) {
  const headers = {
    'User-Agent': query.useragent
      || 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Accept': '*/*',
    'Accept-Encoding': 'identity', // avoid gzip so we can pipe raw bytes
    'Connection': 'keep-alive',
  };

  if (query.cookie) headers['Cookie'] = decodeURIComponent(query.cookie);
  if (query.referer) headers['Referer'] = decodeURIComponent(query.referer);
  if (query.origin) headers['Origin'] = decodeURIComponent(query.origin);

  return headers;
}

function safeDecodeUrl(raw) {
  if (!raw) return null;
  try {
    // Accept both encoded and raw URLs
    const decoded = decodeURIComponent(raw);
    new URL(decoded); // validate
    return decoded;
  } catch {
    try {
      new URL(raw);
      return raw;
    } catch {
      return null;
    }
  }
}

// ── Forbidden domains (self-referential loops, localhost) ────────────────────
function isForbiddenUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
    if (host.endsWith('.onrender.com') && process.env.RENDER_EXTERNAL_HOSTNAME) {
      if (host === process.env.RENDER_EXTERNAL_HOSTNAME) return true;
    }
    return false;
  } catch {
    return true;
  }
}

// ── /api/health ──────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    m3uCached: !!m3uCache.content,
    m3uAge: m3uCache.fetchedAt ? Math.round((Date.now() - m3uCache.fetchedAt) / 1000) : null,
    m3uSource: M3U_SOURCE,
  });
});

// ── /api/m3u ─────────────────────────────────────────────────────────────────
app.get('/api/m3u', m3uLimiter, async (req, res) => {
  const forceRefresh = req.query.refresh === 'true';
  const cacheAge = Date.now() - m3uCache.fetchedAt;

  if (!forceRefresh && m3uCache.content && cacheAge < M3U_CACHE_TTL) {
    console.log(`[M3U] Serving from cache (${Math.round(cacheAge / 60000)}m old)`);
    res.set({
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': `public, max-age=${Math.round((M3U_CACHE_TTL - cacheAge) / 1000)}`,
      'X-Cache': 'HIT',
      'X-Cache-Age': Math.round(cacheAge / 1000).toString(),
    });
    return res.send(m3uCache.content);
  }

  try {
    const content = await fetchM3UFromSource();
    m3uCache = { content, fetchedAt: Date.now() };
    res.set({
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': `public, max-age=${M3U_CACHE_TTL / 1000}`,
      'X-Cache': 'MISS',
    });
    res.send(content);
  } catch (err) {
    console.error('[M3U] Fetch error:', err.message);
    // Serve stale cache if available
    if (m3uCache.content) {
      console.log('[M3U] Serving stale cache after fetch error');
      res.set({
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Cache': 'STALE',
        'X-Error': err.message,
      });
      return res.send(m3uCache.content);
    }
    res.status(502).json({
      error: 'Failed to fetch M3U playlist',
      detail: err.message,
    });
  }
});

// ── /api/proxy/stream ─────────────────────────────────────────────────────────
/**
 * Proxies HLS manifests (.m3u8) and DASH manifests (.mpd).
 * For HLS, it rewrites segment URLs to go through /api/proxy/segment.
 * For DASH (MPD), passes through as-is (DASH.js handles segment fetching,
 * and we inject headers at the player level for DASH).
 */
app.get('/api/proxy/stream', streamLimiter, async (req, res) => {
  const targetUrl = safeDecodeUrl(req.query.url);
  if (!targetUrl) return res.status(400).json({ error: 'Missing or invalid ?url= parameter' });
  if (isForbiddenUrl(targetUrl)) return res.status(403).json({ error: 'Forbidden URL' });

  const headers = buildUpstreamHeaders(req.query);

  // Pass Range header through if present (for VOD)
  if (req.headers.range) headers['Range'] = req.headers.range;

  console.log(`[PROXY/stream] → ${targetUrl.substring(0, 100)}`);

  try {
    const upstream = await fetch(targetUrl, {
      headers,
      signal: AbortSignal.timeout(25000),
      redirect: 'follow',
    });

    if (!upstream.ok) {
      console.warn(`[PROXY/stream] Upstream error: ${upstream.status}`);
      return res.status(upstream.status).json({
        error: `Upstream returned ${upstream.status}`,
        url: targetUrl,
      });
    }

    const contentType = upstream.headers.get('content-type') || '';
    const bodyText = await upstream.text();

    // ── Rewrite HLS manifests ────────────────────────────────────────────
    const isHLS = contentType.includes('mpegurl') ||
      targetUrl.includes('.m3u8') ||
      bodyText.trimStart().startsWith('#EXTM3U');

    const isDASH = contentType.includes('dash+xml') ||
      targetUrl.includes('.mpd') ||
      bodyText.trimStart().startsWith('<?xml');

    if (isHLS) {
      const rewritten = rewriteHLSManifest(bodyText, targetUrl, req.query);
      res.set({
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      });
      return res.send(rewritten);
    }

    if (isDASH) {
      // For MPD, we can optionally rewrite BaseURL — for now pass through
      res.set({
        'Content-Type': 'application/dash+xml',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      });
      return res.send(bodyText);
    }

    // Unknown type — pass through
    res.set({
      'Content-Type': contentType || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
    });
    res.send(bodyText);

  } catch (err) {
    console.error('[PROXY/stream] Error:', err.message);
    res.status(502).json({ error: 'Stream proxy error', detail: err.message });
  }
});

// ── /api/proxy/segment ────────────────────────────────────────────────────────
/**
 * Proxies binary TS/fMP4/AAC segments.
 * Streams the response body directly to the client.
 */
app.get('/api/proxy/segment', streamLimiter, async (req, res) => {
  const targetUrl = safeDecodeUrl(req.query.url);
  if (!targetUrl) return res.status(400).json({ error: 'Missing or invalid ?url= parameter' });
  if (isForbiddenUrl(targetUrl)) return res.status(403).json({ error: 'Forbidden URL' });

  const headers = buildUpstreamHeaders(req.query);
  if (req.headers.range) headers['Range'] = req.headers.range;

  console.log(`[PROXY/segment] → ${targetUrl.substring(0, 100)}`);

  try {
    const upstream = await fetch(targetUrl, {
      headers,
      signal: AbortSignal.timeout(30000),
      redirect: 'follow',
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Upstream ${upstream.status}` });
    }

    // Forward important headers
    const forwardHeaders = {
      'Content-Type': upstream.headers.get('content-type') || 'video/mp2t',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    };
    const contentLength = upstream.headers.get('content-length');
    const contentRange = upstream.headers.get('content-range');
    if (contentLength) forwardHeaders['Content-Length'] = contentLength;
    if (contentRange) forwardHeaders['Content-Range'] = contentRange;

    res.writeHead(upstream.status, forwardHeaders);

    // Pipe the binary body
    if (upstream.body) {
      upstream.body.pipe(res);
      upstream.body.on('error', (err) => {
        console.error('[PROXY/segment] Pipe error:', err.message);
        res.end();
      });
    } else {
      const buf = await upstream.arrayBuffer();
      res.end(Buffer.from(buf));
    }

  } catch (err) {
    console.error('[PROXY/segment] Error:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Segment proxy error', detail: err.message });
    }
  }
});

// ── /api/proxy/key ────────────────────────────────────────────────────────────
/**
 * Proxies AES-128 HLS encryption key files.
 */
app.get('/api/proxy/key', streamLimiter, async (req, res) => {
  const targetUrl = safeDecodeUrl(req.query.url);
  if (!targetUrl) return res.status(400).json({ error: 'Missing or invalid ?url= parameter' });
  if (isForbiddenUrl(targetUrl)) return res.status(403).json({ error: 'Forbidden URL' });

  const headers = buildUpstreamHeaders(req.query);

  try {
    const upstream = await fetch(targetUrl, {
      headers,
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Upstream ${upstream.status}` });
    }

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

// ── /api/proxy/image ─────────────────────────────────────────────────────────
/**
 * Proxies channel logo images to avoid mixed-content / hotlink errors.
 */
app.get('/api/proxy/image', async (req, res) => {
  const targetUrl = safeDecodeUrl(req.query.url);
  if (!targetUrl) return res.status(400).end();
  if (isForbiddenUrl(targetUrl)) return res.status(403).end();

  try {
    const upstream = await fetch(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/*' },
      signal: AbortSignal.timeout(8000),
    });
    if (!upstream.ok) return res.status(upstream.status).end();

    const contentType = upstream.headers.get('content-type') || 'image/png';
    const buf = await upstream.arrayBuffer();
    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(Buffer.from(buf));
  } catch {
    res.status(502).end();
  }
});

// ── HLS manifest rewriter ────────────────────────────────────────────────────
/**
 * Rewrites URLs in an HLS manifest so that segments/keys/sub-manifests
 * are fetched through this proxy server, which injects the required headers.
 */
function rewriteHLSManifest(manifest, baseUrl, queryParams) {
  const base = new URL(baseUrl);
  const serverBase = process.env.SERVER_BASE_URL || '';

  // Build the shared proxy query string (headers to forward)
  const proxyQs = buildProxyQueryString(queryParams);

  const lines = manifest.split('\n');
  const rewritten = lines.map((line) => {
    const trimmed = line.trim();

    // Skip empty lines and comments (except ones we need to rewrite)
    if (!trimmed) return line;

    // ── EXT-X-KEY (encryption key) ──────────────────────────────────────
    if (trimmed.startsWith('#EXT-X-KEY')) {
      return trimmed.replace(/URI="([^"]+)"/, (_, uri) => {
        const abs = resolveUrl(uri, base);
        return `URI="${serverBase}/api/proxy/key?url=${encodeURIComponent(abs)}&${proxyQs}"`;
      });
    }

    // ── EXT-X-MAP (init segment) ─────────────────────────────────────────
    if (trimmed.startsWith('#EXT-X-MAP')) {
      return trimmed.replace(/URI="([^"]+)"/, (_, uri) => {
        const abs = resolveUrl(uri, base);
        return `URI="${serverBase}/api/proxy/segment?url=${encodeURIComponent(abs)}&${proxyQs}"`;
      });
    }

    // ── Sub-manifest / variant playlist ─────────────────────────────────
    if (trimmed.startsWith('#EXT-X-MEDIA') || trimmed.startsWith('#EXT-X-STREAM-INF')) {
      return trimmed.replace(/URI="([^"]+)"/, (_, uri) => {
        const abs = resolveUrl(uri, base);
        return `URI="${serverBase}/api/proxy/stream?url=${encodeURIComponent(abs)}&${proxyQs}"`;
      });
    }

    // ── Segment URLs (non-comment, non-empty lines that look like URLs) ──
    if (!trimmed.startsWith('#')) {
      const abs = resolveUrl(trimmed, base);
      if (abs.startsWith('http')) {
        // Determine if it's a sub-manifest or a segment
        const isSubManifest = trimmed.endsWith('.m3u8') || trimmed.includes('.m3u8?');
        const endpoint = isSubManifest ? 'stream' : 'segment';
        return `${serverBase}/api/proxy/${endpoint}?url=${encodeURIComponent(abs)}&${proxyQs}`;
      }
    }

    return line;
  });

  return rewritten.join('\n');
}

function resolveUrl(url, base) {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

function buildProxyQueryString(query) {
  const parts = [];
  if (query.cookie) parts.push(`cookie=${query.cookie}`);
  if (query.useragent) parts.push(`useragent=${query.useragent}`);
  if (query.referer) parts.push(`referer=${query.referer}`);
  if (query.origin) parts.push(`origin=${query.origin}`);
  return parts.join('&');
}

// ── Serve built frontend (for same-origin deployment) ─────────────────────
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createReadStream } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distPath = join(__dirname, '..', 'dist');

if (existsSync(distPath)) {
  console.log(`[Server] Serving static files from ${distPath}`);
  app.use(express.static(distPath, {
    maxAge: '1h',
    etag: true,
    setHeaders: (res, filePath) => {
      // Don't cache index.html
      if (filePath.endsWith('index.html')) {
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    },
  }));

  // SPA fallback — all non-API routes serve index.html
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return; // let 404 bubble
    res.sendFile(join(distPath, 'index.html'));
  });
} else {
  console.log('[Server] No dist/ folder found — running API-only mode');
  app.get('/', (_req, res) => {
    res.json({
      name: 'JioStar Proxy Server',
      endpoints: ['/api/health', '/api/m3u', '/api/proxy/stream', '/api/proxy/segment', '/api/proxy/key'],
    });
  });
}

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[Server] Unhandled error:', err.message);
  res.status(500).json({ error: err.message });
});

// ── Start ─────────────────────────────────────────────────────────────────────
createServer(app).listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║       JioStar Stream Proxy Server — Started          ║
╠══════════════════════════════════════════════════════╣
║  Port    : ${String(PORT).padEnd(42)}║
║  M3U     : ${M3U_SOURCE.substring(0, 42).padEnd(42)}║
║  Env     : ${(process.env.NODE_ENV || 'development').padEnd(42)}║
╚══════════════════════════════════════════════════════╝
  `);
});
