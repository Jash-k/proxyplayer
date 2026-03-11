import { Channel } from '../types/channel';

const TAMIL_KEYWORDS = [
  'tamil', 'vijay', 'sun tv', 'sun music', 'kalaignar',
  'jaya', 'vendhar', 'polimer', 'puthiya', 'captain', 'zee tamil',
  'colors tamil', 'raj tv', 'star vijay', 'star suvarna', 'isai',
  'adithya', 'tamilan', 'tamilanda', 'raj musix', 'sun life',
  'kstv', 'jaya max', 'jaya plus', 'thirai',
];

export function isTamilChannel(name: string, group: string): boolean {
  const lowerName = name.toLowerCase();
  const lowerGroup = group.toLowerCase();
  return (
    lowerGroup.includes('tamil') ||
    lowerName.includes('tamil') ||
    TAMIL_KEYWORDS.some(kw => lowerName.includes(kw))
  );
}

export function detectStreamType(url: string): 'hls' | 'dash' | 'mpd' {
  // Strip query params and VLC-style pipe params before detecting
  const cleanUrl = url.split('|')[0].split('?')[0].toLowerCase();
  if (cleanUrl.endsWith('.mpd') || cleanUrl.includes('/manifest.mpd') || cleanUrl.includes('.mpd?')) return 'dash';
  if (cleanUrl.endsWith('.m3u8') || cleanUrl.includes('.m3u8')) return 'hls';
  if (cleanUrl.includes('/dash/') || cleanUrl.includes('manifest.mpd')) return 'dash';
  // Check full URL (with query)
  const fullLower = url.split('|')[0].toLowerCase();
  if (fullLower.includes('.mpd')) return 'dash';
  if (fullLower.includes('.m3u8')) return 'hls';
  return 'hls';
}

/**
 * Some M3U entries encode HTTP headers directly in the URL after a pipe `|`:
 * https://example.com/stream.m3u8|Cookie=abc&User-Agent=xyz&Referer=https://...
 * This function splits them out.
 */
function extractUrlAndPipeHeaders(rawUrl: string): {
  cleanUrl: string;
  pipeUserAgent?: string;
  pipeCookie?: string;
  pipeReferer?: string;
  pipeOrigin?: string;
} {
  const pipeIdx = rawUrl.indexOf('|');
  if (pipeIdx === -1) return { cleanUrl: rawUrl };

  const cleanUrl = rawUrl.substring(0, pipeIdx);
  const paramStr = rawUrl.substring(pipeIdx + 1);

  // Parse pipe params — they are like Cookie=...&User-Agent=...
  const result: {
    cleanUrl: string;
    pipeUserAgent?: string;
    pipeCookie?: string;
    pipeReferer?: string;
    pipeOrigin?: string;
  } = { cleanUrl };

  // We cannot use URLSearchParams directly because Cookie values often contain = signs
  // and the values are not encoded. Parse manually.
  const pairs = paramStr.split('&');
  let i = 0;
  while (i < pairs.length) {
    const eqIdx = pairs[i].indexOf('=');
    if (eqIdx === -1) { i++; continue; }
    const key = pairs[i].substring(0, eqIdx).trim();
    let value = pairs[i].substring(eqIdx + 1);

    // For Cookie especially, values may span multiple &-delimited segments if they
    // contain raw = signs. We greedily collect until we hit a known next key.
    const knownKeys = ['Cookie', 'User-Agent', 'User-agent', 'Referer', 'Origin', 'Connection'];
    let j = i + 1;
    while (j < pairs.length) {
      const nextEq = pairs[j].indexOf('=');
      if (nextEq === -1) { value += '&' + pairs[j]; j++; continue; }
      const nextKey = pairs[j].substring(0, nextEq).trim();
      if (knownKeys.includes(nextKey)) break;
      value += '&' + pairs[j];
      j++;
    }
    i = j;

    const keyLower = key.toLowerCase();
    if (keyLower === 'cookie') result.pipeCookie = value;
    else if (keyLower === 'user-agent') result.pipeUserAgent = value;
    else if (keyLower === 'referer') result.pipeReferer = value;
    else if (keyLower === 'origin') result.pipeOrigin = value;
  }

  return result;
}

function parseClearKey(licenseKey: string): { keyId: string; key: string } | null {
  if (!licenseKey) return null;
  const parts = licenseKey.split(':');
  if (parts.length >= 2) {
    return { keyId: parts[0].trim(), key: parts[1].trim() };
  }
  return null;
}

export function parseM3U(content: string): Channel[] {
  // Normalize line endings and split
  const lines = content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');

  const channels: Channel[] = [];
  let i = 0;
  let channelCounter = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    // Skip header and empty lines
    if (!line || line.startsWith('#EXTM3U') || line.startsWith('#EXT-X-')) {
      i++;
      continue;
    }

    if (line.startsWith('#EXTINF')) {
      channelCounter++;
      const channel: Partial<Channel> = {};

      // ── Parse EXTINF attributes ──────────────────────────────────────────
      const tvgIdMatch = line.match(/tvg-id="([^"]*)"/);
      const tvgLogoMatch = line.match(/tvg-logo="([^"]*)"/);
      const groupMatch = line.match(/group-title="([^"]*)"/);

      // Channel name is everything after the last comma
      const commaIdx = line.lastIndexOf(',');
      const name = commaIdx !== -1 ? line.substring(commaIdx + 1).trim() : 'Unknown Channel';

      channel.id = tvgIdMatch ? tvgIdMatch[1] : `ch-${channelCounter}`;
      channel.logo = tvgLogoMatch ? tvgLogoMatch[1] : '';
      channel.group = groupMatch ? groupMatch[1].trim() : 'General';
      channel.name = name || 'Unknown Channel';

      i++;

      // ── Parse subsequent metadata lines until we hit a URL ───────────────
      while (i < lines.length) {
        const metaLine = lines[i].trim();

        // A URL line starts with http(s)://
        if (/^https?:\/\//i.test(metaLine)) break;

        // Skip blank lines within a block
        if (!metaLine) { i++; continue; }

        // Skip next #EXTINF (malformed M3U where URL is missing)
        if (metaLine.startsWith('#EXTINF')) break;

        // ClearKey license type
        if (
          metaLine.startsWith('#KODIPROP:inputstream.adaptive.license_type=') ||
          metaLine.startsWith('#KODIPROP:inputstream.adaptive.stream_type=')
        ) {
          const val = metaLine.split('=').slice(1).join('=').trim();
          channel.licenseType = val;
        }
        // ClearKey license key
        else if (metaLine.startsWith('#KODIPROP:inputstream.adaptive.license_key=')) {
          channel.licenseKey = metaLine.split('=').slice(1).join('=').trim();
        }
        // User-Agent via EXTVLCOPT
        else if (metaLine.startsWith('#EXTVLCOPT:http-user-agent=')) {
          channel.userAgent = metaLine.replace('#EXTVLCOPT:http-user-agent=', '').trim();
        }
        // Referrer
        else if (metaLine.startsWith('#EXTVLCOPT:http-referrer=')) {
          channel.referer = metaLine.replace('#EXTVLCOPT:http-referrer=', '').trim();
        }
        // EXTHTTP JSON (cookie, user-agent, origin, etc.)
        else if (metaLine.startsWith('#EXTHTTP:')) {
          try {
            const jsonStr = metaLine.replace('#EXTHTTP:', '').trim();
            const httpData = JSON.parse(jsonStr);
            if (httpData.cookie) channel.cookie = httpData.cookie;
            if (httpData['user-agent'] || httpData['User-Agent']) {
              channel.userAgent = channel.userAgent || httpData['user-agent'] || httpData['User-Agent'];
            }
            if (httpData.origin || httpData.Origin) {
              channel.origin = httpData.origin || httpData.Origin;
            }
            if (httpData.referer || httpData.Referer) {
              channel.referer = channel.referer || httpData.referer || httpData.Referer;
            }
          } catch {
            // ignore JSON parse errors
          }
        }

        i++;
      }

      // ── The next line should be the URL ─────────────────────────────────
      if (i < lines.length && /^https?:\/\//i.test(lines[i].trim())) {
        const rawUrl = lines[i].trim();
        const { cleanUrl, pipeUserAgent, pipeCookie, pipeReferer, pipeOrigin } =
          extractUrlAndPipeHeaders(rawUrl);

        channel.url = cleanUrl;

        // Pipe-extracted headers override/supplement existing ones
        if (pipeUserAgent && !channel.userAgent) channel.userAgent = pipeUserAgent;
        if (pipeCookie && !channel.cookie) channel.cookie = pipeCookie;
        if (pipeReferer && !channel.referer) channel.referer = pipeReferer;
        if (pipeOrigin && !channel.origin) channel.origin = pipeOrigin;

        channel.streamType = detectStreamType(cleanUrl);
        channel.isTamil = isTamilChannel(channel.name || '', channel.group || '');

        // Parse ClearKey if present
        if (channel.licenseKey) {
          channel.clearKey = parseClearKey(channel.licenseKey) ?? undefined;
        }

        channels.push(channel as Channel);
        i++;
      }
      // If no URL found, just continue (skip corrupt block)
    } else {
      i++;
    }
  }

  return channels;
}

export function sortChannels(
  channels: Channel[],
  sort: string,
  tamilFirst: boolean = true
): Channel[] {
  let sorted = [...channels];

  switch (sort) {
    case 'name-asc':
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'name-desc':
      sorted.sort((a, b) => b.name.localeCompare(a.name));
      break;
    case 'group':
      sorted.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
      break;
    default:
      break;
  }

  if (tamilFirst) {
    const tamil = sorted.filter(c => c.isTamil);
    const nonTamil = sorted.filter(c => !c.isTamil);
    sorted = [...tamil, ...nonTamil];
  }

  return sorted;
}

export function filterChannels(
  channels: Channel[],
  search: string,
  group: string
): Channel[] {
  let filtered = channels;

  if (search.trim()) {
    const q = search.toLowerCase();
    filtered = filtered.filter(
      c =>
        c.name.toLowerCase().includes(q) ||
        c.group.toLowerCase().includes(q)
    );
  }

  if (group && group !== 'all') {
    if (group === 'tamil') {
      filtered = filtered.filter(c => c.isTamil);
    } else {
      filtered = filtered.filter(c => c.group === group);
    }
  }

  return filtered;
}

export function getGroups(channels: Channel[]): string[] {
  const groups = new Set(channels.map(c => c.group));
  return Array.from(groups).sort();
}

export function parseClearKeyForDash(licenseKey: string) {
  return parseClearKey(licenseKey);
}
