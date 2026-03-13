import CodeBox from './CodeBox'

// ─── index.js ────────────────────────────────────────────────────────────────
const mainCode = [
  "// index.js — Telegram Bot + Stremio Addon + Keep-Alive in ONE process",
  "// Deploy on Render as a single Web Service",
  "",
  "import TelegramBot  from 'node-telegram-bot-api'",
  "import { addonBuilder, serveHTTP } from 'stremio-addon-sdk'",
  "import { createClient } from '@supabase/supabase-js'",
  "import http           from 'http'",
  "",
  "// ── Supabase ──────────────────────────────────────────────────────────────",
  "const supabase = createClient(",
  "  process.env.SUPABASE_URL,",
  "  process.env.SUPABASE_SERVICE_KEY",
  ")",
  "",
  "// ── Keep-Alive ping (prevents Render free tier from sleeping) ─────────────",
  "// Render spins down free services after 15 min of inactivity.",
  "// We self-ping the /ping route every 10 minutes to stay awake.",
  "const RENDER_URL = process.env.RENDER_EXTERNAL_URL  // auto-set by Render",
  "",
  "function startKeepAlive() {",
  "  if (!RENDER_URL) { console.log('Keep-alive skipped (no RENDER_EXTERNAL_URL)'); return }",
  "  setInterval(() => {",
  "    http.get(RENDER_URL + '/ping', res => {",
  "      console.log('[keep-alive] ping ->', res.statusCode)",
  "    }).on('error', err => {",
  "      console.error('[keep-alive] error:', err.message)",
  "    })",
  "  }, 10 * 60 * 1000)  // every 10 minutes",
  "  console.log('[keep-alive] started — pinging', RENDER_URL + '/ping', 'every 10 min')",
  "}",
  "",
  "// ── Stremio Addon ─────────────────────────────────────────────────────────",
  "const manifest = {",
  "  id:          'com.pixelstream.personal',",
  "  version:     '1.0.0',",
  "  name:        'PixelStream',",
  "  description: 'Personal Pixeldrain streaming addon',",
  "  resources:   ['catalog', 'meta', 'stream'],",
  "  types:       ['movie', 'series'],",
  "  catalogs: [",
  "    { type: 'movie',  id: 'pd-movies', name: 'My Movies'  },",
  "    { type: 'series', id: 'pd-series', name: 'My Series'  },",
  "  ],",
  "  idPrefixes: ['pd_movie:', 'pd_series:'],",
  "}",
  "",
  "const builder = new addonBuilder(manifest)",
  "",
  "// Catalog ─────────────────────────────────────────────────────────────────",
  "builder.defineCatalogHandler(async ({ type, id }) => {",
  "  if (type === 'movie' && id === 'pd-movies') {",
  "    const { data } = await supabase",
  "      .from('movies')",
  "      .select('stremio_id, title, year, genre, poster')",
  "      .order('added_at', { ascending: false })",
  "    return {",
  "      metas: (data || []).map(m => ({",
  "        id:          m.stremio_id,",
  "        type:        'movie',",
  "        name:        m.title,",
  "        year:        m.year,",
  "        genres:      m.genre ? [m.genre] : [],",
  "        poster:      m.poster,",
  "        posterShape: 'poster',",
  "      }))",
  "    }",
  "  }",
  "",
  "  if (type === 'series' && id === 'pd-series') {",
  "    const { data } = await supabase",
  "      .from('episodes')",
  "      .select('title, year, genre, poster')",
  "      .order('added_at', { ascending: false })",
  "    const seen   = new Set()",
  "    const unique = (data || []).filter(e => {",
  "      if (seen.has(e.title)) return false",
  "      seen.add(e.title)",
  "      return true",
  "    })",
  "    return {",
  "      metas: unique.map(s => ({",
  "        id:          'pd_series:' + s.title.replace(/\\s+/g, '_').toLowerCase(),",
  "        type:        'series',",
  "        name:        s.title,",
  "        year:        s.year,",
  "        genres:      s.genre ? [s.genre] : [],",
  "        poster:      s.poster,",
  "        posterShape: 'poster',",
  "      }))",
  "    }",
  "  }",
  "  return { metas: [] }",
  "})",
  "",
  "// Meta ────────────────────────────────────────────────────────────────────",
  "builder.defineMetaHandler(async ({ type, id }) => {",
  "  if (type === 'movie' && id.startsWith('pd_movie:')) {",
  "    const pid = id.replace('pd_movie:', '')",
  "    const { data } = await supabase",
  "      .from('movies').select('*').eq('pixeldrain_id', pid).single()",
  "    if (!data) return { meta: null }",
  "    return {",
  "      meta: {",
  "        id:     data.stremio_id,",
  "        type:   'movie',",
  "        name:   data.title,",
  "        year:   data.year,",
  "        genres: data.genre ? [data.genre] : [],",
  "        poster: data.poster,",
  "      }",
  "    }",
  "  }",
  "",
  "  if (type === 'series' && id.startsWith('pd_series:')) {",
  "    const slug = id.replace('pd_series:', '').replace(/_/g, ' ')",
  "    const { data } = await supabase",
  "      .from('episodes').select('*')",
  "      .ilike('title', slug)",
  "      .order('season').order('episode')",
  "    if (!data?.length) return { meta: null }",
  "    return {",
  "      meta: {",
  "        id,",
  "        type:   'series',",
  "        name:   data[0].title,",
  "        year:   data[0].year,",
  "        genres: data[0].genre ? [data[0].genre] : [],",
  "        poster: data[0].poster,",
  "        videos: data.map(ep => ({",
  "          id:       ep.stremio_id,",
  "          title:    ep.episode_title || 'Episode ' + ep.episode,",
  "          season:   ep.season,",
  "          episode:  ep.episode,",
  "          released: new Date(ep.added_at).toISOString(),",
  "        }))",
  "      }",
  "    }",
  "  }",
  "  return { meta: null }",
  "})",
  "",
  "// Stream ──────────────────────────────────────────────────────────────────",
  "builder.defineStreamHandler(async ({ type, id }) => {",
  "  let pid = null",
  "  if (type === 'movie'  && id.startsWith('pd_movie:'))  pid = id.replace('pd_movie:', '')",
  "  if (type === 'series' && id.startsWith('pd_series:')) pid = id.replace('pd_series:', '')",
  "  if (!pid) return { streams: [] }",
  "  return {",
  "    streams: [{",
  "      url:   'https://pixeldrain.com/api/file/' + pid,",
  "      name:  'PixelStream',",
  "      title: 'Pixeldrain Direct',",
  "    }]",
  "  }",
  "})",
  "",
  "// Start addon on PORT (Render injects PORT automatically)",
  "const PORT = process.env.PORT || 7000",
  "serveHTTP(builder.getInterface(), { port: PORT })",
  "console.log('[addon] Stremio addon running on port', PORT)",
  "",
  "// ── Telegram Bot ──────────────────────────────────────────────────────────",
  "const bot      = new TelegramBot(process.env.BOT_TOKEN, { polling: true })",
  "const PD_RE    = /pixeldrain\\.com\\/u\\/([a-zA-Z0-9]+)/",
  "const sessions = {}",
  "",
  "bot.onText(/\\/start/, msg => {",
  "  bot.sendMessage(msg.chat.id,",
  "    '\\u{1F44B} PixelStream Bot\\n\\n' +",
  "    'Commands:\\n' +",
  "    '/addmovie   — add a movie\\n' +",
  "    '/addseries  — add a series episode\\n' +",
  "    '/list       — show recent 10 entries\\n' +",
  "    '/delete ID  — remove by Pixeldrain ID'",
  "  )",
  "})",
  "",
  "bot.onText(/\\/addmovie/, msg => {",
  "  sessions[msg.chat.id] = { type: 'movie', step: 'url' }",
  "  bot.sendMessage(msg.chat.id, '\\u{1F3AC} Send the Pixeldrain link:')",
  "})",
  "",
  "bot.onText(/\\/addseries/, msg => {",
  "  sessions[msg.chat.id] = { type: 'series', step: 'url' }",
  "  bot.sendMessage(msg.chat.id, '\\u{1F4FA} Send the Pixeldrain episode link:')",
  "})",
  "",
  "bot.on('message', async msg => {",
  "  const chatId = msg.chat.id",
  "  const text   = msg.text || ''",
  "  const s      = sessions[chatId]",
  "  if (!s || text.startsWith('/')) return",
  "",
  "  if (s.step === 'url') {",
  "    const match = text.match(PD_RE)",
  "    if (!match) return bot.sendMessage(chatId, '\\u274C Invalid Pixeldrain link.')",
  "    s.pixeldrain_id = match[1]",
  "    try {",
  "      const res  = await fetch('https://pixeldrain.com/api/file/' + s.pixeldrain_id + '/info')",
  "      const info = await res.json()",
  "      s.step = 'title'",
  "      bot.sendMessage(chatId,",
  "        '\\u2705 Found: ' + info.name + '\\n' +",
  "        'Size: ' + (info.size / 1024 / 1024).toFixed(1) + ' MB\\n\\nSend the title:'",
  "      )",
  "    } catch {",
  "      bot.sendMessage(chatId, '\\u274C Could not reach Pixeldrain.')",
  "      delete sessions[chatId]",
  "    }",
  "    return",
  "  }",
  "",
  "  if (s.step === 'title')  { s.title  = text.trim(); bot.sendMessage(chatId, 'Year? (or /skip)');      s.step = 'year';    return }",
  "  if (s.step === 'year')   { s.year   = text.startsWith('/skip') ? null : parseInt(text) || null;",
  "                              bot.sendMessage(chatId, 'Genre? (or /skip)');     s.step = 'genre';   return }",
  "  if (s.step === 'genre')  { s.genre  = text.startsWith('/skip') ? null : text.trim();",
  "                              bot.sendMessage(chatId, 'Poster URL? (or /skip)'); s.step = 'poster'; return }",
  "",
  "  if (s.step === 'poster') {",
  "    s.poster = text.startsWith('/skip') ? null : text.trim()",
  "    if (s.type === 'movie') { await saveMovie(chatId, s) }",
  "    else { bot.sendMessage(chatId, 'Season number?'); s.step = 'season' }",
  "    return",
  "  }",
  "",
  "  if (s.step === 'season')        { s.season        = parseInt(text) || 1; bot.sendMessage(chatId, 'Episode number?');        s.step = 'episode';       return }",
  "  if (s.step === 'episode')       { s.episode       = parseInt(text) || 1; bot.sendMessage(chatId, 'Episode title? (or /skip)'); s.step = 'episode_title'; return }",
  "  if (s.step === 'episode_title') { s.episode_title = text.startsWith('/skip') ? null : text.trim(); await saveEpisode(chatId, s); return }",
  "})",
  "",
  "async function saveMovie(chatId, s) {",
  "  const { error } = await supabase.from('movies').insert({",
  "    pixeldrain_id: s.pixeldrain_id,",
  "    title: s.title, year: s.year, genre: s.genre, poster: s.poster,",
  "  })",
  "  bot.sendMessage(chatId, error ? '\\u274C ' + error.message : '\\u2705 ' + s.title + ' saved!')",
  "  delete sessions[chatId]",
  "}",
  "",
  "async function saveEpisode(chatId, s) {",
  "  const pad = n => String(n).padStart(2, '0')",
  "  const { error } = await supabase.from('episodes').insert({",
  "    pixeldrain_id: s.pixeldrain_id,",
  "    title: s.title, year: s.year, genre: s.genre, poster: s.poster,",
  "    season: s.season, episode: s.episode, episode_title: s.episode_title,",
  "  })",
  "  const label = s.title + ' S' + pad(s.season) + 'E' + pad(s.episode)",
  "  bot.sendMessage(chatId, error ? '\\u274C ' + error.message : '\\u2705 ' + label + ' saved!')",
  "  delete sessions[chatId]",
  "}",
  "",
  "bot.onText(/\\/list/, async msg => {",
  "  const pad = n => String(n).padStart(2, '0')",
  "  const { data: movies } = await supabase.from('movies')",
  "    .select('title,year,pixeldrain_id').order('added_at',{ascending:false}).limit(10)",
  "  const { data: eps } = await supabase.from('episodes')",
  "    .select('title,season,episode,pixeldrain_id').order('added_at',{ascending:false}).limit(10)",
  "  let out = '\\u{1F3AC} Recent Movies:\\n'",
  "  movies?.forEach(m => { out += '  ' + m.title + ' (' + (m.year||'?') + ') — ' + m.pixeldrain_id + '\\n' })",
  "  out += '\\n\\u{1F4FA} Recent Episodes:\\n'",
  "  eps?.forEach(e => { out += '  ' + e.title + ' S' + pad(e.season) + 'E' + pad(e.episode) + ' — ' + e.pixeldrain_id + '\\n' })",
  "  bot.sendMessage(msg.chat.id, out || 'Nothing added yet.')",
  "})",
  "",
  "bot.onText(/\\/delete (.+)/, async (msg, match) => {",
  "  const pid = match[1].trim()",
  "  await supabase.from('movies').delete().eq('pixeldrain_id', pid)",
  "  await supabase.from('episodes').delete().eq('pixeldrain_id', pid)",
  "  bot.sendMessage(msg.chat.id, '\\u2705 Deleted: ' + pid)",
  "})",
  "",
  "console.log('[bot] Telegram bot polling...')",
  "",
  "// ── Start Keep-Alive last ─────────────────────────────────────────────────",
  "startKeepAlive()",
].join('\n')

// ─── package.json ─────────────────────────────────────────────────────────────
const packageJson = [
  "{",
  '  "name": "pixelstream",',
  '  "version": "1.0.0",',
  '  "type": "module",',
  '  "main": "index.js",',
  '  "scripts": {',
  '    "start": "node index.js"',
  "  },",
  '  "dependencies": {',
  '    "node-telegram-bot-api": "^0.65.1",',
  '    "stremio-addon-sdk":     "^1.6.10",',
  '    "@supabase/supabase-js": "^2.43.0"',
  "  }",
  "}",
].join('\n')

// ─── render.yaml ──────────────────────────────────────────────────────────────
const renderYaml = [
  "# render.yaml — Infrastructure as Code (optional, but recommended)",
  "# Put this in your repo root. Render auto-detects it.",
  "",
  "services:",
  "  - type: web",
  "    name: pixelstream",
  "    runtime: node",
  "    region: singapore          # sgp | oregon | frankfurt | ohio",
  "    plan: free                 # free tier — 512MB RAM, sleeps after 15min",
  "    buildCommand: npm install",
  "    startCommand: node index.js",
  "    healthCheckPath: /ping     # Render pings this to confirm service is up",
  "    envVars:",
  "      - key: NODE_ENV",
  "        value: production",
  "      - key: BOT_TOKEN",
  "        sync: false            # secret — enter manually in dashboard",
  "      - key: SUPABASE_URL",
  "        sync: false",
  "      - key: SUPABASE_SERVICE_KEY",
  "        sync: false",
  "      # RENDER_EXTERNAL_URL is auto-injected by Render (used for keep-alive)",
].join('\n')

// ─── .env.example ─────────────────────────────────────────────────────────────
const envExample = [
  "BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
  "SUPABASE_URL=https://xxxx.supabase.co",
  "SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "# RENDER_EXTERNAL_URL is auto-set by Render — do NOT add it manually",
].join('\n')

// ─── .gitignore ───────────────────────────────────────────────────────────────
const gitignore = [
  "node_modules/",
  ".env",
].join('\n')

// ─── Folder structure ─────────────────────────────────────────────────────────
const folderStructure = [
  "pixelstream/",
  "├── index.js          # Bot + Addon + Keep-Alive — single entry point",
  "├── package.json",
  "├── render.yaml       # optional — tells Render how to deploy",
  "├── .gitignore",
  "└── .env              # local only — NEVER commit",
].join('\n')

// ─── Deploy steps ─────────────────────────────────────────────────────────────
const steps = [
  {
    n: '01', title: 'Get credentials', color: 'text-violet-400',
    items: [
      '@BotFather → /newbot → copy BOT_TOKEN',
      'Supabase → Settings → API → copy URL + service_role key',
    ],
  },
  {
    n: '02', title: 'Set up Supabase DB', color: 'text-blue-400',
    items: [
      'Supabase → SQL Editor',
      'Run SQL from the Database tab',
      'movies + episodes tables created',
    ],
  },
  {
    n: '03', title: 'Push code to GitHub', color: 'text-green-400',
    items: [
      'Create a new private GitHub repo',
      'Copy all files into it',
      'git add . && git commit -m "init" && git push',
    ],
  },
  {
    n: '04', title: 'Create Render Web Service', color: 'text-yellow-400',
    items: [
      'render.com → New → Web Service',
      'Connect your GitHub repo',
      'Runtime: Node, Start: node index.js',
      'Set the 3 env vars as secrets',
    ],
  },
  {
    n: '05', title: 'Deploy & install', color: 'text-orange-400',
    items: [
      'Render auto-deploys on every git push',
      'Wait for "Live" status (~2 min)',
      'Paste manifest URL into Stremio',
      'Send /addmovie in Telegram — done!',
    ],
  },
]

// ─── Keep-alive explanation ───────────────────────────────────────────────────
const keepAliveNote = [
  "// WHY keep-alive is needed on Render free tier:",
  "// Render spins down your service after 15 minutes of zero HTTP requests.",
  "// When spun down, the bot stops polling and Stremio gets a cold-start delay.",
  "//",
  "// HOW it works:",
  "// 1. The addon HTTP server (stremio-addon-sdk) already listens on PORT.",
  "// 2. Every 10 minutes, we send a GET /ping to our own public URL.",
  "// 3. Render sees the request — service stays awake — bot keeps polling.",
  "//",
  "// RENDER_EXTERNAL_URL is automatically injected by Render as an env var,",
  "// e.g. https://pixelstream.onrender.com — no manual config needed.",
  "//",
  "// The /ping route is handled by stremio-addon-sdk's built-in HTTP server.",
  "// It returns 200 OK for any unknown path, so /ping works out of the box.",
].join('\n')

// ─── Stremio install ──────────────────────────────────────────────────────────
const stremioInstall = [
  "# Your addon manifest URL after deploy:",
  "https://pixelstream.onrender.com/manifest.json",
  "",
  "# Option A — paste in Stremio search bar:",
  "#   Stremio → Search → paste URL above → Install",
  "",
  "# Option B — deep link (click to open Stremio directly):",
  "stremio://pixelstream.onrender.com/manifest.json",
].join('\n')

// ─── Logs to expect ──────────────────────────────────────────────────────────
const expectedLogs = [
  "[addon] Stremio addon running on port 10000",
  "[bot]   Telegram bot polling...",
  "[keep-alive] started — pinging https://pixelstream.onrender.com/ping every 10 min",
  "...",
  "[keep-alive] ping -> 200   ← appears every 10 min",
].join('\n')

// ─── Cost table ───────────────────────────────────────────────────────────────
const costRows = [
  { service: 'Render',        what: 'Web Service — bot + addon (512MB RAM)', cost: '$0 / mo' },
  { service: 'Supabase',      what: 'PostgreSQL — movies + episodes',        cost: '$0 / mo' },
  { service: 'Pixeldrain',    what: 'File hosting + streaming CDN',          cost: '$0 free' },
  { service: 'Telegram API',  what: 'Bot long-polling',                      cost: '$0'      },
  { service: 'Stremio',       what: 'Video player app',                      cost: '$0'      },
]

// ─── Checklist ────────────────────────────────────────────────────────────────
const checklist = [
  'Supabase SQL schema created — movies + episodes tables exist',
  'BOT_TOKEN from @BotFather saved',
  'SUPABASE_URL and SUPABASE_SERVICE_KEY added in Render env vars',
  'GitHub repo connected to Render Web Service',
  'Render deploy shows "Live" status (no error in deploy logs)',
  'All 3 log lines visible: addon running + bot polling + keep-alive started',
  'Tested /addmovie in Telegram — row appears in Supabase table',
  'manifest.json URL opens in browser with correct JSON',
  'Addon installed in Stremio — catalog shows your movies',
  'Clicked a movie in Stremio — video plays from Pixeldrain ✨',
]

export default function DeployTab() {
  return (
    <div className="space-y-10">

      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold mb-1">Render Deployment — Bot + Addon + Keep-Alive</h2>
        <p className="text-white/40 text-sm">
          One folder. One <code className="bg-white/10 px-1 rounded text-xs">index.js</code>.
          Deployed as a single Render Web Service. Keep-alive script prevents free-tier sleep.
        </p>
      </div>

      {/* Architecture */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
        <p className="text-xs text-white/40 uppercase tracking-widest mb-4">How it works</p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {[
            { icon: '📱', label: 'You',        sub: 'Telegram'    },
            null,
            { icon: '🤖', label: 'Bot',        sub: 'polling'     },
            null,
            { icon: '🗄️', label: 'Supabase',   sub: 'stores file' },
            null,
            { icon: '📺', label: 'Stremio',    sub: 'asks addon'  },
            null,
            { icon: '🟣', label: 'Addon',      sub: 'same server' },
            null,
            { icon: '⚡', label: 'Pixeldrain', sub: 'streams'     },
          ].map((node, i) =>
            node === null
              ? <span key={i} className="text-white/20 text-lg font-light">→</span>
              : (
                <div key={i} className="flex flex-col items-center bg-white/5 border border-white/10 rounded-xl px-4 py-2 min-w-[72px]">
                  <span className="text-xl">{node.icon}</span>
                  <span className="font-semibold text-white/90 text-xs mt-1">{node.label}</span>
                  <span className="text-white/30 text-[10px]">{node.sub}</span>
                </div>
              )
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs bg-violet-500/15 text-violet-300 border border-violet-500/30 rounded-full px-3 py-1">
            🤖 Bot — long-polling (no webhook)
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs bg-blue-500/15 text-blue-300 border border-blue-500/30 rounded-full px-3 py-1">
            📺 Addon HTTP — same port as Render
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs bg-green-500/15 text-green-300 border border-green-500/30 rounded-full px-3 py-1">
            ⏰ Keep-Alive — self-ping every 10 min
          </span>
        </div>
      </div>

      {/* Keep-alive callout */}
      <div className="bg-amber-500/10 border border-amber-500/25 rounded-2xl p-5">
        <p className="text-amber-300 font-semibold text-sm mb-3">⏰ Why Keep-Alive is Built In</p>
        <ul className="space-y-2 text-xs text-white/60 mb-4">
          <li className="flex gap-2"><span className="text-amber-400/60 flex-shrink-0">›</span><span>Render free tier <strong className="text-white/80">spins down</strong> any service with no traffic for 15 minutes</span></li>
          <li className="flex gap-2"><span className="text-amber-400/60 flex-shrink-0">›</span><span>When spun down, the Telegram bot <strong className="text-white/80">stops polling</strong> and Stremio gets a cold-start delay</span></li>
          <li className="flex gap-2"><span className="text-amber-400/60 flex-shrink-0">›</span><span>The keep-alive in <code className="bg-white/10 px-1 rounded">index.js</code> pings <code className="bg-white/10 px-1 rounded">/ping</code> on our own URL every 10 min — service stays awake 24/7</span></li>
          <li className="flex gap-2"><span className="text-amber-400/60 flex-shrink-0">›</span><span><code className="bg-white/10 px-1 rounded">RENDER_EXTERNAL_URL</code> is auto-injected by Render — no manual config needed</span></li>
        </ul>
        <CodeBox code={keepAliveNote} lang="javascript" />
      </div>

      {/* Steps */}
      <div>
        <p className="text-xs text-white/40 uppercase tracking-widest mb-4">Deployment Steps</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {steps.map(step => (
            <div key={step.n} className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className={`text-2xl font-bold font-mono ${step.color} mb-2`}>{step.n}</div>
              <div className="font-medium text-sm mb-2 text-white/90">{step.title}</div>
              <ul className="space-y-1.5">
                {step.items.map((item, i) => (
                  <li key={i} className="text-xs text-white/40 flex gap-2">
                    <span className="text-white/20 flex-shrink-0">›</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Folder structure */}
      <div>
        <p className="text-xs text-white/40 uppercase tracking-widest mb-3">Folder Structure</p>
        <CodeBox code={folderStructure} lang="bash" />
      </div>

      {/* index.js */}
      <div>
        <p className="text-xs text-white/40 uppercase tracking-widest mb-2">index.js — Complete File</p>
        <div className="flex gap-2 flex-wrap mb-3">
          <span className="text-xs bg-violet-500/20 text-violet-300 px-2 py-1 rounded-full border border-violet-500/30">🤖 Telegram Bot</span>
          <span className="text-xs bg-blue-500/20 text-blue-300 px-2 py-1 rounded-full border border-blue-500/30">📺 Stremio Addon</span>
          <span className="text-xs bg-amber-500/20 text-amber-300 px-2 py-1 rounded-full border border-amber-500/30">⏰ Keep-Alive</span>
          <span className="text-xs bg-green-500/20 text-green-300 px-2 py-1 rounded-full border border-green-500/30">⚡ Single Process</span>
        </div>
        <CodeBox code={mainCode} lang="javascript" />
      </div>

      {/* package.json */}
      <div>
        <p className="text-xs text-white/40 uppercase tracking-widest mb-3">package.json</p>
        <CodeBox code={packageJson} lang="json" />
      </div>

      {/* render.yaml */}
      <div>
        <p className="text-xs text-white/40 uppercase tracking-widest mb-2">render.yaml <span className="text-white/20 font-normal normal-case">(optional — put in repo root)</span></p>
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3 mb-3 text-xs text-blue-300">
          💡 If you add <code className="bg-white/10 px-1 rounded">render.yaml</code> to your repo, Render reads all settings automatically — no manual dashboard clicking needed.
        </div>
        <CodeBox code={renderYaml} lang="yaml" />
      </div>

      {/* .env */}
      <div>
        <p className="text-xs text-white/40 uppercase tracking-widest mb-3">.env — local testing only</p>
        <CodeBox code={envExample} lang="bash" />
      </div>

      {/* .gitignore */}
      <div>
        <p className="text-xs text-white/40 uppercase tracking-widest mb-3">.gitignore</p>
        <CodeBox code={gitignore} lang="bash" />
      </div>

      {/* Render env vars */}
      <div>
        <p className="text-xs text-white/40 uppercase tracking-widest mb-3">Set Env Vars in Render Dashboard</p>
        <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="text-left px-4 py-3 text-white/40 font-medium text-xs uppercase">Key</th>
                <th className="text-left px-4 py-3 text-white/40 font-medium text-xs uppercase">Value / Where to get it</th>
                <th className="text-left px-4 py-3 text-white/40 font-medium text-xs uppercase">Secret?</th>
              </tr>
            </thead>
            <tbody>
              {[
                { key: 'BOT_TOKEN',            val: 'From @BotFather → /newbot',                          secret: true  },
                { key: 'SUPABASE_URL',          val: 'Supabase → Settings → API → Project URL',           secret: false },
                { key: 'SUPABASE_SERVICE_KEY',  val: 'Supabase → Settings → API → service_role key',      secret: true  },
                { key: 'RENDER_EXTERNAL_URL',   val: 'Auto-injected by Render — do NOT add manually',     secret: false },
              ].map((row, i) => (
                <tr key={i} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-3 font-mono text-violet-300 text-xs">{row.key}</td>
                  <td className="px-4 py-3 text-white/50 text-xs">{row.val}</td>
                  <td className="px-4 py-3 text-xs">
                    {row.secret
                      ? <span className="text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">Secret ✓</span>
                      : <span className="text-white/30">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stremio install */}
      <div>
        <p className="text-xs text-white/40 uppercase tracking-widest mb-3">Install Addon in Stremio</p>
        <CodeBox code={stremioInstall} lang="bash" />
      </div>

      {/* Expected logs */}
      <div>
        <p className="text-xs text-white/40 uppercase tracking-widest mb-2">Expected Render Logs <span className="text-white/20 font-normal normal-case">(confirm all 3 lines)</span></p>
        <CodeBox code={expectedLogs} lang="bash" />
      </div>

      {/* Cost */}
      <div>
        <p className="text-xs text-white/40 uppercase tracking-widest mb-3">Total Cost</p>
        <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="text-left px-4 py-3 text-white/40 font-medium text-xs uppercase">Service</th>
                <th className="text-left px-4 py-3 text-white/40 font-medium text-xs uppercase hidden sm:table-cell">Purpose</th>
                <th className="text-left px-4 py-3 text-white/40 font-medium text-xs uppercase">Cost</th>
              </tr>
            </thead>
            <tbody>
              {costRows.map((row, i) => (
                <tr key={i} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-3 font-medium text-white/80 text-sm">{row.service}</td>
                  <td className="px-4 py-3 text-white/40 text-xs hidden sm:table-cell">{row.what}</td>
                  <td className="px-4 py-3 text-green-400 text-xs font-mono">{row.cost}</td>
                </tr>
              ))}
              <tr className="bg-green-500/5">
                <td className="px-4 py-3 font-bold text-white text-sm">Total</td>
                <td className="px-4 py-3 hidden sm:table-cell" />
                <td className="px-4 py-3 text-green-400 font-bold font-mono">$0 / month</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Checklist */}
      <div className="bg-green-500/10 border border-green-500/20 rounded-2xl p-5">
        <p className="text-green-400 font-semibold mb-4">✅ Pre-launch Checklist</p>
        <ul className="space-y-2.5">
          {checklist.map((item, i) => (
            <li key={i} className="flex gap-3 text-sm text-white/60">
              <span className="text-green-500/50 flex-shrink-0 mt-px">□</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

    </div>
  )
}
