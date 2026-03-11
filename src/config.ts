/**
 * Runtime configuration
 * ─────────────────────
 * In development  → vite dev server proxies /api/* → localhost:3001
 * In production   → Express serves both /api/* and the React dist/ from
 *                   the same origin, so there are zero CORS issues.
 *
 * VITE_API_BASE can be set in .env.local if you ever want to point the
 * frontend at a separate server (e.g. during local testing of a remote Render).
 */

export const API_BASE: string = (import.meta.env.VITE_API_BASE as string) ?? '';

export const API = {
  m3u: `${API_BASE}/api/m3u`,
  health: `${API_BASE}/api/health`,
  proxyStream: `${API_BASE}/api/proxy/stream`,
  proxySegment: `${API_BASE}/api/proxy/segment`,
  proxyKey: `${API_BASE}/api/proxy/key`,
  proxyImage: `${API_BASE}/api/proxy/image`,
} as const;

/**
 * Build a proxied manifest URL.
 *
 * IMPORTANT: `params.url` must already be the **clean** stream URL
 * (with VLC pipe-params stripped out by the M3U parser).
 * The server will also strip any remaining pipe-params as a belt-and-suspenders
 * measure, but the frontend parser should have already cleaned it.
 *
 * We use URLSearchParams so all values are properly percent-encoded exactly once.
 */
export function buildProxyStreamUrl(params: {
  url: string;
  cookie?: string;
  userAgent?: string;
  referer?: string;
  origin?: string;
}): string {
  const qs = new URLSearchParams();
  qs.set('url', params.url); // URLSearchParams encodes this safely
  if (params.cookie) qs.set('cookie', params.cookie);
  if (params.userAgent) qs.set('useragent', params.userAgent);
  if (params.referer) qs.set('referer', params.referer);
  if (params.origin) qs.set('origin', params.origin);
  return `${API.proxyStream}?${qs.toString()}`;
}

/**
 * Build a proxied segment URL (used when manually constructing segment requests,
 * though normally the server rewrites these inside the HLS/DASH manifests).
 */
export function buildProxySegmentUrl(params: {
  url: string;
  cookie?: string;
  userAgent?: string;
  referer?: string;
  origin?: string;
}): string {
  const qs = new URLSearchParams();
  qs.set('url', params.url);
  if (params.cookie) qs.set('cookie', params.cookie);
  if (params.userAgent) qs.set('useragent', params.userAgent);
  if (params.referer) qs.set('referer', params.referer);
  if (params.origin) qs.set('origin', params.origin);
  return `${API.proxySegment}?${qs.toString()}`;
}

/**
 * Build a proxied image URL for channel logos (avoids hotlink/mixed-content issues).
 */
export function buildProxyImageUrl(imageUrl: string): string {
  if (!imageUrl) return '';
  return `${API.proxyImage}?url=${encodeURIComponent(imageUrl)}`;
}
