'use strict'

// PixelStream — Telegram Bot + Stremio Addon (single process)
// Flow: send pixeldrain link → auto-parse → save → appears in Stremio instantly
// Deps: node-telegram-bot-api  stremio-addon-sdk  @supabase/supabase-js

const { addonBuilder, serveHTTP } = require('stremio-addon-sdk')
const { createClient }            = require('@supabase/supabase-js')
const TelegramBot                 = require('node-telegram-bot-api')
const http                        = require('http')
const https                       = require('https')

// ── Clients ───────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true })

// ── Regex ─────────────────────────────────────────────────────────────────────
const PD_RE = /pixeldrain\.(?:com|dev|net)\/u\/([a-zA-Z0-9]+)/

// ── Filename Parser ───────────────────────────────────────────────────────────
// Extracts structured info from a raw filename like:
//   "Breaking.Bad.S03E07.1080p.mkv"
//   "Inception.2010.BluRay.mkv"
//   "The.Dark.Knight.2008.mkv"
function parseFilename(filename) {
  // Strip extension
  const base = filename.replace(/\.[a-zA-Z0-9]{2,4}$/, '')

  // Detect series pattern: S01E02 or 1x02
  const epMatch = base.match(/[Ss](\d{1,2})[Ee](\d{1,2})/)
  const isSeries = !!epMatch
  const season  = epMatch ? parseInt(epMatch[1]) : null
  const episode = epMatch ? parseInt(epMatch[2]) : null

  // Extract year (4-digit number that looks like a year)
  const yearMatch = base.match(/\b(19\d{2}|20\d{2})\b/)
  const year = yearMatch ? parseInt(yearMatch[1]) : null

  // Extract title — everything before the year or SxxExx pattern
  let rawTitle = base
  if (epMatch) {
    rawTitle = base.slice(0, base.search(/[Ss]\d{1,2}[Ee]\d{1,2}/))
  } else if (yearMatch) {
    rawTitle = base.slice(0, base.search(/\b(19\d{2}|20\d{2})\b/))
  }

  // Clean title: replace dots/underscores/dashes with spaces, trim
  const title = rawTitle
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[-]+$/, '')
    .trim()

  // Extract episode title — everything after SxxExx before quality tags
  let episodeTitle = null
  if (epMatch) {
    const afterEp = base.slice(base.search(/[Ss]\d{1,2}[Ee]\d{1,2}/) + epMatch[0].length)
    const epTitleRaw = afterEp
      .replace(/\b(1080p|720p|480p|4K|BluRay|WEBRip|HDTV|x264|x265|HEVC|AAC|AC3|DTS|HDR|Remux|NF|AMZN|DSNP)\b.*/i, '')
      .replace(/[._]/g, ' ')
      .trim()
    if (epTitleRaw.length > 1) episodeTitle = epTitleRaw
  }

  // Best-guess type
  const type = isSeries ? 'series' : 'movie'

  // Series slug from title
  const seriesSlug = type === 'series'
    ? title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')
    : null

  return { type, title, year, season, episode, episodeTitle, seriesSlug }
}

// ── Format helper ─────────────────────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0') }
function mb(bytes) { return (bytes / 1024 / 1024).toFixed(1) + ' MB' }

// ── Pixeldrain API ────────────────────────────────────────────────────────────
async function fetchPDInfo(pid) {
  const res  = await fetch('https://pixeldrain.com/api/file/' + pid + '/info')
  const data = await res.json()
  if (!res.ok) throw new Error(data.message || 'Pixeldrain API error')
  return data // { name, size, mime_type, ... }
}

// ── Save helpers ──────────────────────────────────────────────────────────────
async function saveMovie(pid, parsed, fileInfo) {
  const { error } = await supabase.from('movies').upsert({
    pixeldrain_id: pid,
    title:         parsed.title,
    year:          parsed.year,
    mime_type:     fileInfo.mime_type,
  }, { onConflict: 'pixeldrain_id' })
  return error
}

async function saveEpisode(pid, parsed, fileInfo) {
  const { error } = await supabase.from('episodes').upsert({
    pixeldrain_id: pid,
    series_id:     parsed.seriesSlug,
    title:         parsed.title,
    year:          parsed.year,
    season:        parsed.season,
    episode:       parsed.episode,
    episode_title: parsed.episodeTitle,
    mime_type:     fileInfo.mime_type,
  }, { onConflict: 'pixeldrain_id' })
  return error
}

// ── Edit sessions ─────────────────────────────────────────────────────────────
// Only used when user calls /edit
const editSessions = {}

// ── Bot: handle any message ───────────────────────────────────────────────────
bot.on('message', async function(msg) {
  const chatId = msg.chat.id
  const text   = (msg.text || '').trim()

  // ── Active edit session ────────────────────────────────────────────────────
  const es = editSessions[chatId]
  if (es && !text.startsWith('/')) {
    return handleEditStep(chatId, text, es)
  }

  // ── Commands ───────────────────────────────────────────────────────────────
  if (text === '/start' || text === '/help') {
    return bot.sendMessage(chatId,
      '👋 *PixelStream Bot*\n\n' +
      'Just send me a Pixeldrain link — I\'ll add it automatically.\n\n' +
      '*Commands:*\n' +
      '/list — show last 10 added\n' +
      '/edit `ID` — edit details of an entry\n' +
      '/delete `ID` — remove an entry\n' +
      '/cancel — cancel current edit',
      { parse_mode: 'Markdown' }
    )
  }

  if (text === '/cancel') {
    delete editSessions[chatId]
    return bot.sendMessage(chatId, '✅ Cancelled.')
  }

  if (text.startsWith('/list')) {
    return handleList(chatId)
  }

  if (text.startsWith('/delete')) {
    const pid = text.replace('/delete', '').trim()
    if (!pid) return bot.sendMessage(chatId, 'Usage: /delete PIXELDRAIN_ID')
    return handleDelete(chatId, pid)
  }

  if (text.startsWith('/edit')) {
    const pid = text.replace('/edit', '').trim()
    if (!pid) return bot.sendMessage(chatId, 'Usage: /edit PIXELDRAIN_ID')
    return handleEditStart(chatId, pid)
  }

  // ── Auto-detect Pixeldrain link ────────────────────────────────────────────
  const urlMatch  = text.match(PD_RE)
  const bareMatch = text.match(/^([a-zA-Z0-9]{8})$/)
  const pid       = urlMatch ? urlMatch[1] : bareMatch ? bareMatch[1] : null

  if (!pid) return // ignore non-pixeldrain messages silently

  // Fetch & auto-add
  let infoMsg
  try {
    infoMsg = await bot.sendMessage(chatId, '⏳ Fetching info...')

    const fileInfo = await fetchPDInfo(pid)
    const parsed   = parseFilename(fileInfo.name)

    // Save to DB
    let error
    if (parsed.type === 'movie') {
      error = await saveMovie(pid, parsed, fileInfo)
    } else {
      error = await saveEpisode(pid, parsed, fileInfo)
    }

    if (error) {
      return bot.editMessageText('❌ DB error: ' + error.message, {
        chat_id: chatId, message_id: infoMsg.message_id
      })
    }

    // Build confirmation message
    let conf = ''
    if (parsed.type === 'movie') {
      conf =
        '✅ *Movie added!*\n\n' +
        '🎬 *' + parsed.title + '*' + (parsed.year ? ' (' + parsed.year + ')' : '') + '\n' +
        '📦 ' + mb(fileInfo.size) + '\n' +
        '🆔 `' + pid + '`\n\n' +
        '_Wrong details? Use /edit ' + pid + '_'
    } else {
      conf =
        '✅ *Episode added!*\n\n' +
        '📺 *' + parsed.title + '* S' + pad(parsed.season) + 'E' + pad(parsed.episode) +
        (parsed.episodeTitle ? ' — ' + parsed.episodeTitle : '') + '\n' +
        (parsed.year ? '📅 ' + parsed.year + '\n' : '') +
        '📦 ' + mb(fileInfo.size) + '\n' +
        '🆔 `' + pid + '`\n\n' +
        '_Wrong details? Use /edit ' + pid + '_'
    }

    bot.editMessageText(conf, {
      chat_id: chatId, message_id: infoMsg.message_id, parse_mode: 'Markdown'
    })

  } catch(e) {
    const errText = '❌ Failed: ' + e.message
    if (infoMsg) {
      bot.editMessageText(errText, { chat_id: chatId, message_id: infoMsg.message_id })
    } else {
      bot.sendMessage(chatId, errText)
    }
  }
})

// ── /list handler ─────────────────────────────────────────────────────────────
async function handleList(chatId) {
  const { data: movies } = await supabase
    .from('movies').select('title, year, pixeldrain_id')
    .order('added_at', { ascending: false }).limit(5)

  const { data: eps } = await supabase
    .from('episodes').select('title, season, episode, pixeldrain_id')
    .order('added_at', { ascending: false }).limit(5)

  let out = '🎬 *Recent Movies:*\n'
  ;(movies || []).forEach(function(m) {
    out += '• ' + m.title + (m.year ? ' (' + m.year + ')' : '') + ' — `' + m.pixeldrain_id + '`\n'
  })
  if (!movies || !movies.length) out += '_None yet_\n'

  out += '\n📺 *Recent Episodes:*\n'
  ;(eps || []).forEach(function(e) {
    out += '• ' + e.title + ' S' + pad(e.season) + 'E' + pad(e.episode) + ' — `' + e.pixeldrain_id + '`\n'
  })
  if (!eps || !eps.length) out += '_None yet_\n'

  bot.sendMessage(chatId, out, { parse_mode: 'Markdown' })
}

// ── /delete handler ───────────────────────────────────────────────────────────
async function handleDelete(chatId, pid) {
  await supabase.from('movies').delete().eq('pixeldrain_id', pid)
  await supabase.from('episodes').delete().eq('pixeldrain_id', pid)
  bot.sendMessage(chatId, '✅ Deleted `' + pid + '`', { parse_mode: 'Markdown' })
}

// ── /edit flow ────────────────────────────────────────────────────────────────
async function handleEditStart(chatId, pid) {
  // Find the entry
  const { data: movie } = await supabase.from('movies').select('*').eq('pixeldrain_id', pid).single()
  const { data: ep    } = await supabase.from('episodes').select('*').eq('pixeldrain_id', pid).single()

  const entry = movie || ep
  if (!entry) return bot.sendMessage(chatId, '❌ Not found: `' + pid + '`', { parse_mode: 'Markdown' })

  const type = movie ? 'movie' : 'series'

  editSessions[chatId] = { pid, type, data: { ...entry }, step: 'menu' }

  let current = ''
  if (type === 'movie') {
    current =
      '🎬 *' + entry.title + '*' + (entry.year ? ' (' + entry.year + ')' : '') + '\n' +
      'Type: Movie\n'
  } else {
    current =
      '📺 *' + entry.title + '* S' + pad(entry.season) + 'E' + pad(entry.episode) + '\n' +
      (entry.episode_title ? 'Episode: ' + entry.episode_title + '\n' : '') +
      'Series ID: ' + entry.series_id + '\n'
  }

  let opts = '\nWhat to edit?\n\n'
  opts += '1 — Title: ' + entry.title + '\n'
  opts += '2 — Year: ' + (entry.year || 'not set') + '\n'
  if (type === 'series') {
    opts += '3 — Season: ' + entry.season + '\n'
    opts += '4 — Episode: ' + entry.episode + '\n'
    opts += '5 — Episode title: ' + (entry.episode_title || 'not set') + '\n'
    opts += '6 — Series ID: ' + entry.series_id + '\n'
  }
  opts += '\nReply with the number:'

  bot.sendMessage(chatId, current + opts, { parse_mode: 'Markdown' })
}

async function handleEditStep(chatId, text, es) {
  // Menu selection
  if (es.step === 'menu') {
    const n = parseInt(text)
    const fields = ['title', 'year', 'season', 'episode', 'episode_title', 'series_id']
    const labels = ['Title', 'Year', 'Season', 'Episode number', 'Episode title', 'Series ID']

    if (es.type === 'movie' && (n < 1 || n > 2)) {
      return bot.sendMessage(chatId, 'Reply 1 or 2.')
    }
    if (es.type === 'series' && (n < 1 || n > 6)) {
      return bot.sendMessage(chatId, 'Reply 1–6.')
    }

    es.editField = fields[n - 1]
    es.step = 'value'
    bot.sendMessage(chatId,
      'Send new value for *' + labels[n - 1] + '*\n' +
      'Current: ' + (es.data[es.editField] || 'not set'),
      { parse_mode: 'Markdown' }
    )
    return
  }

  // Receive new value
  if (es.step === 'value') {
    const val = es.editField === 'year' || es.editField === 'season' || es.editField === 'episode'
      ? (parseInt(text) || null)
      : text.trim()

    const table = es.type === 'movie' ? 'movies' : 'episodes'
    const update = {}
    update[es.editField] = val

    // If editing title and it's a series, also update series_id slug
    if (es.editField === 'title' && es.type === 'series') {
      update.series_id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')
    }

    const { error } = await supabase.from(table).update(update).eq('pixeldrain_id', es.pid)
    delete editSessions[chatId]

    if (error) return bot.sendMessage(chatId, '❌ Error: ' + error.message)
    bot.sendMessage(chatId,
      '✅ Updated! `' + es.editField + '` → *' + val + '*',
      { parse_mode: 'Markdown' }
    )
  }
}

// ── Stremio Manifest ──────────────────────────────────────────────────────────
const manifest = {
  id:          'com.pixelstream.personal',
  version:     '1.0.0',
  name:        'PixelStream',
  description: 'Personal Pixeldrain streaming addon',
  resources:   ['catalog', 'meta', 'stream'],
  types:       ['movie', 'series'],
  catalogs: [
    { type: 'movie',  id: 'pd-movies', name: 'My Movies'  },
    { type: 'series', id: 'pd-series', name: 'My Series'  },
  ],
  idPrefixes: ['pd_m:', 'pd_s:', 'pd_e:'],
  behaviorHints: { adult: false, p2p: false },
}

const builder = new addonBuilder(manifest)

// ── Catalog Handler ───────────────────────────────────────────────────────────
builder.defineCatalogHandler(async function({ type, id }) {
  if (type === 'movie' && id === 'pd-movies') {
    const { data } = await supabase
      .from('movies')
      .select('pixeldrain_id, title, year, poster')
      .order('added_at', { ascending: false })
    return {
      metas: (data || []).map(function(m) {
        return {
          id:          'pd_m:' + m.pixeldrain_id,
          type:        'movie',
          name:        m.title,
          year:        m.year,
          poster:      m.poster || null,
          posterShape: 'poster',
        }
      })
    }
  }

  if (type === 'series' && id === 'pd-series') {
    const { data } = await supabase
      .from('episodes')
      .select('series_id, title, year, poster')
      .order('added_at', { ascending: false })
    const seen   = new Set()
    const unique = (data || []).filter(function(e) {
      if (seen.has(e.series_id)) return false
      seen.add(e.series_id)
      return true
    })
    return {
      metas: unique.map(function(s) {
        return {
          id:          'pd_s:' + s.series_id,
          type:        'series',
          name:        s.title,
          year:        s.year,
          poster:      s.poster || null,
          posterShape: 'poster',
        }
      })
    }
  }

  return { metas: [] }
})

// ── Meta Handler ──────────────────────────────────────────────────────────────
builder.defineMetaHandler(async function({ type, id }) {
  if (type === 'movie' && id.startsWith('pd_m:')) {
    const pid      = id.replace('pd_m:', '')
    const { data } = await supabase
      .from('movies').select('*').eq('pixeldrain_id', pid).single()
    if (!data) return { meta: null }
    return {
      meta: {
        id:     'pd_m:' + data.pixeldrain_id,
        type:   'movie',
        name:   data.title,
        year:   data.year,
        poster: data.poster || null,
      }
    }
  }

  if (type === 'series' && id.startsWith('pd_s:')) {
    const sid      = id.replace('pd_s:', '')
    const { data } = await supabase
      .from('episodes').select('*')
      .eq('series_id', sid)
      .order('season').order('episode')
    if (!data || !data.length) return { meta: null }
    return {
      meta: {
        id,
        type:   'series',
        name:   data[0].title,
        year:   data[0].year,
        poster: data[0].poster || null,
        videos: data.map(function(ep) {
          return {
            id:       'pd_e:' + ep.pixeldrain_id,
            title:    ep.episode_title || ('Episode ' + ep.episode),
            season:   ep.season,
            episode:  ep.episode,
            released: new Date(ep.added_at).toISOString(),
          }
        })
      }
    }
  }

  return { meta: null }
})

// ── Stream Handler ────────────────────────────────────────────────────────────
builder.defineStreamHandler(async function({ type, id }) {
  var pid = null
  if (id.startsWith('pd_m:')) pid = id.replace('pd_m:', '')
  if (id.startsWith('pd_e:')) pid = id.replace('pd_e:', '')
  if (!pid) return { streams: [] }
  return {
    streams: [{
      url:   'https://pixeldrain.com/api/file/' + pid,
      name:  'PixelStream',
      title: 'Pixeldrain Direct',
    }]
  }
})

// ── Start Addon ───────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT) || 7000
serveHTTP(builder.getInterface(), { port: PORT })
console.log('[addon] Stremio addon running on port', PORT)
console.log('[bot]   Telegram bot polling...')

// ── Keep-Alive ────────────────────────────────────────────────────────────────
function startKeepAlive() {
  const url = process.env.RENDER_EXTERNAL_URL
  if (!url) {
    console.log('[keep-alive] skipped — no RENDER_EXTERNAL_URL (ok for local)')
    return
  }
  const isHttps  = url.startsWith('https://')
  const hostname = url.replace(/^https?:\/\//, '')
  const client   = isHttps ? https : http

  setInterval(function() {
    const req = client.request({ hostname, path: '/', method: 'GET' }, function(res) {
      console.log('[keep-alive] ping ->', res.statusCode)
    })
    req.on('error', function(e) { console.error('[keep-alive] error:', e.message) })
    req.end()
  }, 10 * 60 * 1000)

  console.log('[keep-alive] started — pinging', url, 'every 10 min')
}

startKeepAlive()
