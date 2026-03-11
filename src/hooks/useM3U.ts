import { useState, useEffect, useCallback } from 'react';
import { Channel } from '../types/channel';
import { parseM3U } from '../utils/m3uParser';
import { API } from '../config';

const CACHE_KEY = 'jiostar_m3u_cache_v3';
const CACHE_TIME_KEY = 'jiostar_m3u_cache_time_v3';
const CACHE_DURATION = 6 * 60 * 60 * 1000; // 6 hours in ms

function isValidM3U(text: string): boolean {
  return (
    text.includes('#EXTM3U') ||
    text.includes('#EXTINF') ||
    text.includes('#EXT-X-')
  );
}

// ── Fetch strategies ──────────────────────────────────────────────────────────
// 1. Our own server proxy (primary — no CORS issues, injects headers properly)
// 2. Direct fetch fallback (works if the source has open CORS)
// 3. Public CORS proxies as last resort
type FetchStrategy = {
  name: string;
  fn: () => Promise<string>;
};

function buildStrategies(): FetchStrategy[] {
  return [
    // ── 1. Our server-side proxy (best — no CORS, caches 6h) ─────────────
    {
      name: 'Server /api/m3u',
      fn: async () => {
        const res = await fetch(API.m3u, {
          signal: AbortSignal.timeout(20000),
          headers: { Accept: 'text/plain, */*' },
        });
        if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`);
        const text = await res.text();
        if (!isValidM3U(text)) throw new Error('Server response is not a valid M3U');
        return text;
      },
    },
    // ── 2. Direct fetch (works for open-CORS sources) ─────────────────────
    {
      name: 'Direct fetch',
      fn: async () => {
        const M3U_URL = 'https://pocket-tv-tamil-5afe35.gitlab.io/jiostar.m3u';
        const res = await fetch(M3U_URL, {
          signal: AbortSignal.timeout(10000),
          headers: { Accept: 'text/plain, */*' },
          credentials: 'omit',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (!isValidM3U(text)) throw new Error('Not a valid M3U');
        return text;
      },
    },
    // ── 3. corsproxy.io ───────────────────────────────────────────────────
    {
      name: 'corsproxy.io',
      fn: async () => {
        const M3U_URL = 'https://pocket-tv-tamil-5afe35.gitlab.io/jiostar.m3u';
        const res = await fetch(
          `https://corsproxy.io/?url=${encodeURIComponent(M3U_URL)}`,
          { signal: AbortSignal.timeout(15000), credentials: 'omit' }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (!isValidM3U(text)) throw new Error('Not a valid M3U');
        return text;
      },
    },
    // ── 4. allorigins ─────────────────────────────────────────────────────
    {
      name: 'allorigins.win',
      fn: async () => {
        const M3U_URL = 'https://pocket-tv-tamil-5afe35.gitlab.io/jiostar.m3u';
        const res = await fetch(
          `https://api.allorigins.win/get?url=${encodeURIComponent(M3U_URL)}`,
          { signal: AbortSignal.timeout(15000), credentials: 'omit' }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json() as { contents?: string };
        if (!json.contents || !isValidM3U(json.contents)) throw new Error('Invalid allorigins response');
        return json.contents;
      },
    },
  ];
}

async function fetchM3UContent(): Promise<{ content: string; source: string }> {
  const strategies = buildStrategies();
  const errors: string[] = [];

  for (const strategy of strategies) {
    try {
      console.log(`[M3U] Trying: ${strategy.name}…`);
      const content = await strategy.fn();
      console.log(`[M3U] ✅ Success via: ${strategy.name} (${content.length} bytes)`);
      return { content, source: strategy.name };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[M3U] ❌ Failed (${strategy.name}): ${msg}`);
      errors.push(`${strategy.name}: ${msg}`);
    }
  }

  throw new Error(`All fetch strategies failed:\n${errors.join('\n')}`);
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useM3U() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [rawContent, setRawContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchSource, setFetchSource] = useState<string>('');
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [nextRefresh, setNextRefresh] = useState<Date | null>(null);

  const load = useCallback(async (forceRefresh = false) => {
    setIsLoading(true);
    setError(null);

    // ── Try localStorage cache first ───────────────────────────────────────
    if (!forceRefresh) {
      try {
        const cached = localStorage.getItem(CACHE_KEY);
        const cachedTime = localStorage.getItem(CACHE_TIME_KEY);
        if (cached && cachedTime) {
          const age = Date.now() - parseInt(cachedTime, 10);
          if (age < CACHE_DURATION && isValidM3U(cached)) {
            const parsed = parseM3U(cached);
            if (parsed.length > 0) {
              console.log(`[M3U] Cache hit — ${parsed.length} channels (${Math.round(age / 60000)}m old)`);
              setChannels(parsed);
              setRawContent(cached);
              setLastFetched(new Date(parseInt(cachedTime, 10)));
              setNextRefresh(new Date(parseInt(cachedTime, 10) + CACHE_DURATION));
              setFetchSource('localStorage cache');
              setIsLoading(false);
              return;
            }
          }
        }
      } catch {
        // localStorage unavailable
      }
    }

    // ── Fetch fresh ────────────────────────────────────────────────────────
    try {
      const { content, source } = await fetchM3UContent();
      const parsed = parseM3U(content);

      if (parsed.length === 0) {
        throw new Error('Playlist fetched but contains 0 channels — may be malformed.');
      }

      // Persist to cache
      try {
        localStorage.setItem(CACHE_KEY, content);
        const now = Date.now();
        localStorage.setItem(CACHE_TIME_KEY, now.toString());
        setLastFetched(new Date(now));
        setNextRefresh(new Date(now + CACHE_DURATION));
      } catch {
        // Storage full or blocked
      }

      setChannels(parsed);
      setRawContent(content);
      setFetchSource(source);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      setFetchSource('error');

      // Fallback to stale cache
      try {
        const stale = localStorage.getItem(CACHE_KEY);
        if (stale && isValidM3U(stale)) {
          const parsed = parseM3U(stale);
          if (parsed.length > 0) {
            console.log(`[M3U] Using stale cache — ${parsed.length} channels`);
            setChannels(parsed);
            setRawContent(stale);
            setFetchSource('stale cache');
          }
        }
      } catch {
        // ignore
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => { load(false); }, [load]);

  // Auto-refresh every 6 hours
  useEffect(() => {
    const interval = setInterval(() => {
      console.log('[M3U] Auto-refresh (6h interval)');
      load(true);
    }, CACHE_DURATION);
    return () => clearInterval(interval);
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  return {
    channels,
    rawContent,
    isLoading,
    error,
    fetchSource,
    lastFetched,
    nextRefresh,
    refresh,
  };
}
