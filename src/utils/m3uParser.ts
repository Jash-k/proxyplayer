import { Channel } from '../types/channel';

const TAMIL_KEYWORDS = [
  'tamil', 'vijay', 'sun tv', 'sun music', 'kalaignar',
  'jaya', 'vendhar', 'polimer', 'puthiya', 'captain', 'zee tamil',
  'colors tamil', 'raj tv', 'star vijay', 'isai',
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
  // Strip query params and pipe params before detecting
  const cleanUrl = url.split('|')[0].split('?')[0].toLowerCase();
  if (cleanUrl.endsWith('.mpd')) return 'dash';
  if (cleanUrl.endsWith('.m3u8')) return 'hls';
  // Check with query string too
  const withQuery = url.split('|')[0].toLowerCase();
  if (withQuery.includes('.mpd')) return 'dash';
  if (withQuery.includes('.m3u8')) return 'hls';
  if (withQuery.includes('/dash/') || withQuery.includes('manifest.mpd')) return 'dash';
  return 'hls';
}

/**
 * Parse VLC-style pipe-delimited headers from a stream URL.
 *
 * Formats seen in the wild:
 *   1. URL|Cookie=xxx&User-Agent=yyy
 *      e.g. https://example.com/stream.m3u8|Cookie=abc&User-Agent=xyz
 *
 *   2. URL?|Cookie=xxx&User-Agent=yyy   (pipe right after ?)
 *      e.g. https://example.com/stream.mpd?|Cookie=abc&User-Agent=xyz
 *
 *   3. URL?realParam=val|Cookie=xxx&User-Agent=yyy
 *
 *   4. URL?%7CCookie=...  (pipe URL-encoded as %7C — same as case 2 but encoded)
 *
 *   5. URL?realParam=val%7CCookie=xxx   (encoded pipe mid query-string)
 *
 * We also parse headers embedded as URL query params with the format:
 *   %7CCookie=val&User-agent=val&Origin=val&Referer=val
 * This is what Hotstar M3U entries look like.
 */
function extractUrlAndPipeHeaders(rawLine: string): {
  cleanUrl: string;
  pipeUserAgent?: string;
  pipeCookie?: string;
  pipeReferer?: string;
  pipeOrigin?: string;
} {
  // First fully decode the URL so we can work with it uniformly
  let decoded = rawLine;
  try {
    // Decode once — handles %7C -> |, %252f -> %2f, etc.
    decoded = decodeURIComponent(rawLine);
  } catch {
    decoded = rawLine;
  }

  // Now find where the pipe separator is
  // It can be:  ?|Cookie=   or   |Cookie=   or   ?realparam=val|Cookie=
  let baseUrl = decoded;
  let paramStr = '';

  // Case: pipe exists literally in the decoded string
  const pipeIdx = decoded.indexOf('|');
  if (pipeIdx !== -1) {
    baseUrl = decoded.substring(0, pipeIdx);
    paramStr = decoded.substring(pipeIdx + 1);

    // If the pipe was right after '?', strip the '?' from baseUrl
    if (baseUrl.endsWith('?')) {
      baseUrl = baseUrl.slice(0, -1);
    }
  }

  if (!paramStr) {
    return { cleanUrl: baseUrl };
  }

  const result: {
    cleanUrl: string;
    pipeUserAgent?: string;
    pipeCookie?: string;
    pipeReferer?: string;
    pipeOrigin?: string;
  } = { cleanUrl: baseUrl };

  // Parse the pipe params — format: Key=value&Key2=value2
  // Keys are case-insensitive: Cookie, User-Agent, User-agent, Referer, Origin
  // Values may contain '=' (especially Cookie). We parse by known key names.
  // Split on & but only when the next segment starts with a known key=
  // We do a regex split approach
  const keyPattern = /(?:^|&)(cookie|user-agent|referer|origin|connection|accept)=/gi;
  
  // Find all key positions
  const keyPositions: Array<{ key: string; valueStart: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = keyPattern.exec(paramStr)) !== null) {
    keyPositions.push({
      key: m[1].toLowerCase(),
      valueStart: m.index + m[0].length,
    });
  }

  for (let i = 0; i < keyPositions.length; i++) {
    const { key, valueStart } = keyPositions[i];
    
    // Re-extract accurately: find the actual & before next known key
    let value = paramStr.substring(valueStart);
    if (i + 1 < keyPositions.length) {
      // Find the right cut: next occurrence of &knownkey=
      let found = -1;
      for (let ni = i + 1; ni < keyPositions.length; ni++) {
        const candidate = paramStr.lastIndexOf('&', keyPositions[ni].valueStart - 1);
        if (candidate >= valueStart) {
          if (found === -1 || candidate < found) found = candidate;
        }
      }
      if (found !== -1) {
        value = paramStr.substring(valueStart, found);
      }
    }

    // URL-decode the value
    let decodedValue = value;
    try { decodedValue = decodeURIComponent(value.replace(/\+/g, ' ')); } catch { /* keep raw */ }

    if (key === 'cookie') result.pipeCookie = decodedValue;
    else if (key === 'user-agent') result.pipeUserAgent = decodedValue;
    else if (key === 'referer') result.pipeReferer = decodedValue;
    else if (key === 'origin') result.pipeOrigin = decodedValue;
  }

  // Fallback: if regex approach got nothing, try simple split
  if (!result.pipeCookie && !result.pipeUserAgent && !result.pipeReferer) {
    const simplePairs = paramStr.split('&');
    for (const pair of simplePairs) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) continue;
      const k = pair.substring(0, eqIdx).toLowerCase().trim();
      const v = pair.substring(eqIdx + 1);
      if (k === 'cookie') result.pipeCookie = v;
      else if (k === 'user-agent') result.pipeUserAgent = v;
      else if (k === 'referer') result.pipeReferer = v;
      else if (k === 'origin') result.pipeOrigin = v;
    }
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
  const lines = content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');

  const channels: Channel[] = [];
  let i = 0;
  let channelCounter = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    // Skip header, empty, and EXT-X lines
    if (!line || line.startsWith('#EXTM3U') || line.startsWith('#EXT-X-')) {
      i++;
      continue;
    }

    if (line.startsWith('#EXTINF')) {
      channelCounter++;
      const channel: Partial<Channel> = {};

      // Parse EXTINF attributes
      const tvgIdMatch = line.match(/tvg-id="([^"]*)"/);
      const tvgLogoMatch = line.match(/tvg-logo="([^"]*)"/);
      const groupMatch = line.match(/group-title="([^"]*)"/);

      const commaIdx = line.lastIndexOf(',');
      const name = commaIdx !== -1 ? line.substring(commaIdx + 1).trim() : 'Unknown Channel';

      channel.id = tvgIdMatch?.[1] || `ch-${channelCounter}`;
      channel.logo = tvgLogoMatch?.[1] || '';
      channel.group = groupMatch?.[1]?.trim() || 'General';
      channel.name = name || 'Unknown Channel';

      i++;

      // Parse subsequent metadata lines until we hit a URL or next EXTINF
      while (i < lines.length) {
        const metaLine = lines[i].trim();

        // URL line
        if (/^https?:\/\//i.test(metaLine)) break;

        // Skip blank lines
        if (!metaLine) { i++; continue; }

        // Next EXTINF = malformed block, skip
        if (metaLine.startsWith('#EXTINF')) break;

        // ClearKey license type
        if (
          metaLine.startsWith('#KODIPROP:inputstream.adaptive.license_type=') ||
          metaLine.startsWith('#KODIPROP:inputstream.adaptive.stream_type=')
        ) {
          channel.licenseType = metaLine.split('=').slice(1).join('=').trim();
        }
        // ClearKey license key
        else if (metaLine.startsWith('#KODIPROP:inputstream.adaptive.license_key=')) {
          channel.licenseKey = metaLine.split('=').slice(1).join('=').trim();
        }
        // User-Agent via EXTVLCOPT
        else if (metaLine.startsWith('#EXTVLCOPT:http-user-agent=')) {
          channel.userAgent = metaLine.replace('#EXTVLCOPT:http-user-agent=', '').trim();
        }
        // Referrer via EXTVLCOPT
        else if (metaLine.startsWith('#EXTVLCOPT:http-referrer=')) {
          channel.referer = metaLine.replace('#EXTVLCOPT:http-referrer=', '').trim();
        }
        // EXTHTTP JSON
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

      // The next line should be the stream URL
      if (i < lines.length && /^https?:\/\//i.test(lines[i].trim())) {
        const rawUrl = lines[i].trim();
        const { cleanUrl, pipeUserAgent, pipeCookie, pipeReferer, pipeOrigin } =
          extractUrlAndPipeHeaders(rawUrl);

        channel.url = cleanUrl;

        // Pipe-extracted headers fill in missing values (don't override #EXTHTTP/#EXTVLCOPT)
        if (pipeUserAgent && !channel.userAgent) channel.userAgent = pipeUserAgent;
        if (pipeCookie && !channel.cookie) channel.cookie = pipeCookie;
        if (pipeReferer && !channel.referer) channel.referer = pipeReferer;
        if (pipeOrigin && !channel.origin) channel.origin = pipeOrigin;

        channel.streamType = detectStreamType(cleanUrl);
        channel.isTamil = isTamilChannel(channel.name || '', channel.group || '');

        // Parse ClearKey
        if (channel.licenseKey) {
          channel.clearKey = parseClearKey(channel.licenseKey) ?? undefined;
        }

        // Validate we have a usable URL
        if (channel.url && channel.name) {
          channels.push(channel as Channel);
        }
        i++;
      }
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
