// index.js — PixelStream: Telegram Bot + Stremio Addon + Keep-Alive
// Single process. Deploy as ONE Render Web Service.
// Deps: node-telegram-bot-api  stremio-addon-sdk  @supabase/supabase-js

'use strict'

const { addonBuilder, serveHTTP } = require('stremio-addon-sdk')
const { createClient }            = require('@supabase/supabase-js')
const TelegramBot                 = require('node-telegram-bot-api')
const http                        = require('http')

// ── Clients ───────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const bot      = new TelegramBot(process.env.BOT_TOKEN, { polling: true })
const PD_RE    = /pixeldrain\.com\/u\/([a-zA-Z0-9]+)/
const sessions = {}  // in-memory conversation state per chat

// ── Keep-Alive ────────────────────────────────────────────────────────────────
// Render free tier spins down after 15 min of no HTTP traffic.
// Self-ping every 10 min keeps the service awake 24/7.
function startKeepAlive() {
  const url = process.env.RENDER_EXTERNAL_URL  // auto-injected by Render
  if (!url) {
    console.log('[keep-alive] skipped — no RENDER_EXTERNAL_URL (ok for local)')
    return
  }
  const target = url.replace('https://', '') // http.get needs just host
  const interval = 10 * 60 * 1000  // 10 minutes

  setInterval(() => {
    const opts = {
      hostname: target,
      path: '/',
      method: 'GET',
    }
    const req = http.request(opts, res => {
      console.log('[keep-alive] ping ->', res.statusCode)
    })
    req.on('error', e => console.error('[keep-alive] error:', e.message))
    req.end()
  }, interval)

  console.log('[keep-alive] started — pinging', url, 'every 10 min')
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
}

const builder = new addonBuilder(manifest)

// ── Catalog Handler ───────────────────────────────────────────────────────────
builder.defineCatalogHandler(async function({ type, id }) {
  if (type === 'movie' && id === 'pd-movies') {
    const { data } = await supabase
      .from('movies')
      .select('pixeldrain_id, title, year, genre, poster')
      .order('added_at', { ascending: false })
    return {
      metas: (data || []).map(function(m) {
        return {
          id:          'pd_m:' + m.pixeldrain_id,
          type:        'movie',
          name:        m.title,
          year:        m.year,
          genres:      m.genre ? [m.genre] : [],
          poster:      m.poster,
          posterShape: 'poster',
        }
      })
    }
  }

  if (type === 'series' && id === 'pd-series') {
    const { data } = await supabase
      .from('episodes')
      .select('series_id, title, year, genre, poster')
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
          genres:      s.genre ? [s.genre] : [],
          poster:      s.poster,
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
        genres: data.genre ? [data.genre] : [],
        poster: data.poster,
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
    function pad(n) { return String(n).padStart(2, '0') }
    return {
      meta: {
        id,
        type:   'series',
        name:   data[0].title,
        year:   data[0].year,
        genres: data[0].genre ? [data[0].genre] : [],
        poster: data[0].poster,
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
builder.defineStreamHandler(async function({ id }) {
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

// ── Start Addon HTTP Server ───────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT) || 7000
serveHTTP(builder.getInterface(), { port: PORT })
console.log('[addon] Stremio addon running on port', PORT)

// ── Telegram Bot Commands ─────────────────────────────────────────────────────
bot.onText(/\/start/, function(msg) {
  bot.sendMessage(msg.chat.id,
    '👋 PixelStream Bot\n\n' +
    'Commands:\n' +
    '/addmovie  — add a movie\n' +
    '/addseries — add a series episode\n' +
    '/list      — show last 10 entries\n' +
    '/delete ID — remove by Pixeldrain ID'
  )
})

bot.onText(/\/addmovie/, function(msg) {
  sessions[msg.chat.id] = { type: 'movie', step: 'url' }
  bot.sendMessage(msg.chat.id, '🎬 Send the Pixeldrain link:')
})

bot.onText(/\/addseries/, function(msg) {
  sessions[msg.chat.id] = { type: 'series', step: 'url' }
  bot.sendMessage(msg.chat.id, '📺 Send the Pixeldrain episode link:')
})

bot.on('message', async function(msg) {
  const chatId = msg.chat.id
  const text   = (msg.text || '').trim()
  const s      = sessions[chatId]
  if (!s || text.startsWith('/')) return

  // ── Step 1: Pixeldrain URL
  if (s.step === 'url') {
    const match = text.match(PD_RE)
    if (!match) return bot.sendMessage(chatId, '❌ Invalid Pixeldrain link. Try again:')
    s.pixeldrain_id = match[1]
    try {
      const res  = await fetch('https://pixeldrain.com/api/file/' + s.pixeldrain_id + '/info')
      const info = await res.json()
      s.step = 'title'
      bot.sendMessage(chatId,
        '✅ Found: ' + info.name + '\n' +
        'Size: ' + (info.size / 1024 / 1024).toFixed(1) + ' MB\n\n' +
        'Send the title:'
      )
    } catch(e) {
      bot.sendMessage(chatId, '❌ Could not reach Pixeldrain. Try again.')
      delete sessions[chatId]
    }
    return
  }

  // ── Step 2: Title
  if (s.step === 'title') {
    s.title = text
    bot.sendMessage(chatId, 'Year? (e.g. 2024)  or  /skip')
    s.step = 'year'
    return
  }

  // ── Step 3: Year
  if (s.step === 'year') {
    s.year = text.startsWith('/skip') ? null : (parseInt(text) || null)
    bot.sendMessage(chatId, 'Genre? (e.g. Action)  or  /skip')
    s.step = 'genre'
    return
  }

  // ── Step 4: Genre
  if (s.step === 'genre') {
    s.genre = text.startsWith('/skip') ? null : text
    bot.sendMessage(chatId, 'Poster URL? (direct image link)  or  /skip')
    s.step = 'poster'
    return
  }

  // ── Step 5: Poster — then branch movie vs series
  if (s.step === 'poster') {
    s.poster = text.startsWith('/skip') ? null : text
    if (s.type === 'movie') {
      await saveMovie(chatId, s)
    } else {
      bot.sendMessage(chatId,
        'Series ID (short slug, e.g. breaking-bad):\n' +
        '(same slug groups all episodes of this show)'
      )
      s.step = 'series_id'
    }
    return
  }

  // ── Series-only steps
  if (s.step === 'series_id') {
    s.series_id = text.toLowerCase().replace(/\s+/g, '-')
    bot.sendMessage(chatId, 'Season number:')
    s.step = 'season'
    return
  }

  if (s.step === 'season') {
    s.season = parseInt(text) || 1
    bot.sendMessage(chatId, 'Episode number:')
    s.step = 'episode'
    return
  }

  if (s.step === 'episode') {
    s.episode = parseInt(text) || 1
    bot.sendMessage(chatId, 'Episode title?  or  /skip')
    s.step = 'episode_title'
    return
  }

  if (s.step === 'episode_title') {
    s.episode_title = text.startsWith('/skip') ? null : text
    await saveEpisode(chatId, s)
    return
  }
})

// ── Save helpers ──────────────────────────────────────────────────────────────
async function saveMovie(chatId, s) {
  const { error } = await supabase.from('movies').insert({
    pixeldrain_id: s.pixeldrain_id,
    title:         s.title,
    year:          s.year,
    genre:         s.genre,
    poster:        s.poster,
  })
  if (error) bot.sendMessage(chatId, '❌ DB Error: ' + error.message)
  else       bot.sendMessage(chatId, '✅ ' + s.title + ' saved to movies!')
  delete sessions[chatId]
}

async function saveEpisode(chatId, s) {
  function pad(n) { return String(n).padStart(2, '0') }
  const { error } = await supabase.from('episodes').insert({
    pixeldrain_id: s.pixeldrain_id,
    series_id:     s.series_id,
    title:         s.title,
    year:          s.year,
    genre:         s.genre,
    poster:        s.poster,
    season:        s.season,
    episode:       s.episode,
    episode_title: s.episode_title,
  })
  const label = s.title + ' S' + pad(s.season) + 'E' + pad(s.episode)
  if (error) bot.sendMessage(chatId, '❌ DB Error: ' + error.message)
  else       bot.sendMessage(chatId, '✅ ' + label + ' saved to episodes!')
  delete sessions[chatId]
}

// ── /list command ─────────────────────────────────────────────────────────────
bot.onText(/\/list/, async function(msg) {
  function pad(n) { return String(n).padStart(2, '0') }
  const { data: movies } = await supabase
    .from('movies').select('title, year, pixeldrain_id')
    .order('added_at', { ascending: false }).limit(10)
  const { data: eps } = await supabase
    .from('episodes').select('title, season, episode, pixeldrain_id')
    .order('added_at', { ascending: false }).limit(10)

  let out = '🎬 Recent Movies:\n'
  ;(movies || []).forEach(function(m) {
    out += '  ' + m.title + ' (' + (m.year || '?') + ') — ' + m.pixeldrain_id + '\n'
  })
  out += '\n📺 Recent Episodes:\n'
  ;(eps || []).forEach(function(e) {
    out += '  ' + e.title + ' S' + pad(e.season) + 'E' + pad(e.episode) + ' — ' + e.pixeldrain_id + '\n'
  })
  bot.sendMessage(msg.chat.id, out || 'Nothing added yet.')
})

// ── /delete command ───────────────────────────────────────────────────────────
bot.onText(/\/delete (.+)/, async function(msg, match) {
  const pid = match[1].trim()
  await supabase.from('movies').delete().eq('pixeldrain_id', pid)
  await supabase.from('episodes').delete().eq('pixeldrain_id', pid)
  bot.sendMessage(msg.chat.id, '✅ Deleted: ' + pid)
})

console.log('[bot] Telegram bot polling...')

// Start keep-alive after addon HTTP is up
startKeepAlive()
