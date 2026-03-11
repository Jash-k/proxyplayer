/**
 * Runtime configuration
 * ─────────────────────
 * In development  → Vite's dev-server proxy forwards /api/* to localhost:3001
 * In production   → The Express server serves both /api/* and the React app
 *                   from the same origin, so no CORS issues.
 */

// The base URL for all API calls.
// Empty string = same origin (works for both dev proxy and prod same-origin).
export const API_BASE = import.meta.env.VITE_API_BASE ?? '';

/** Full proxy endpoint helpers */
export const API = {
  m3u: `${API_BASE}/api/m3u`,
  health: `${API_BASE}/api/health`,
  proxyStream: `${API_BASE}/api/proxy/stream`,
  proxySegment: `${API_BASE}/api/proxy/segment`,
  proxyKey: `${API_BASE}/api/proxy/key`,
  proxyImage: `${API_BASE}/api/proxy/image`,
} as const;

/**
 * Build a proxied stream URL.
 * The server will inject Cookie / User-Agent / Referer when fetching upstream.
 */
export function buildProxyStreamUrl(params: {
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
  return `${API.proxyStream}?${qs.toString()}`;
}

/**
 * Build a proxied segment URL.
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
 * Build a proxied image URL.
 */
export function buildProxyImageUrl(imageUrl: string): string {
  if (!imageUrl) return '';
  return `${API.proxyImage}?url=${encodeURIComponent(imageUrl)}`;
}
