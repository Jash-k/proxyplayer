# 📺 JioStar Stream Player — Full Stack

A feature-rich HLS / DASH / MPD ClearKey stream player with a **server-side proxy** that injects `Cookie`, `User-Agent`, `Referer`, and `Origin` headers for streams that require authentication — something browsers cannot do natively.

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────┐
│                  Browser (React App)                   │
│  HLS.js / DASH.js → /api/proxy/stream?url=...          │
└──────────────────────┬─────────────────────────────────┘
                       │ same origin (no CORS)
┌──────────────────────▼─────────────────────────────────┐
│         Express Proxy Server (Render.com)              │
│                                                        │
│  GET /api/m3u          → fetch M3U + 6h cache          │
│  GET /api/proxy/stream → fetch manifest + rewrite URLs │
│  GET /api/proxy/segment→ fetch TS/MP4 segments         │
│  GET /api/proxy/key    → fetch AES-128 keys            │
│  GET /api/proxy/image  → proxy channel logos           │
│  GET /api/health       → status check                  │
│                                                        │
│  Injects: Cookie | User-Agent | Referer | Origin       │
└──────────────────────┬─────────────────────────────────┘
                       │ server-to-server (no CORS)
┌──────────────────────▼─────────────────────────────────┐
│        CDN Origins (JioTV, Hotstar, etc.)              │
│  jiotvmblive.cdn.jio.com  /  livetv.hotstar.com        │
└────────────────────────────────────────────────────────┘
```

### Why a server-side proxy?

Browsers **cannot** set `Cookie` or `User-Agent` headers on media requests (they are "forbidden headers"). The proxy server runs in Node.js where there are no such restrictions, so:

- ✅ `Cookie: hdntl=exp=...` → injected by the server
- ✅ `User-Agent: Hotstar;in.startv.hotstar/...` → injected by the server
- ✅ `Referer: https://www.hotstar.com/` → injected by the server
- ✅ HLS manifest segment URLs are **rewritten** to go through `/api/proxy/segment`, so every `.ts` and `.mp4` fetch also gets the correct headers

---

## 🚀 Deploy to Render.com (Recommended)

### Step 1 — Push to GitHub

```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_USER/jiostar-player.git
git push -u origin main
```

### Step 2 — Create Render Web Service

1. Go to [render.com](https://render.com) → **New** → **Web Service**
2. Connect your GitHub repository
3. Render will auto-detect `render.yaml` — click **Apply**

Or configure manually:

| Setting | Value |
|---|---|
| **Runtime** | Node |
| **Region** | Singapore (closest to India) |
| **Build Command** | `npm install && npm run build && cd server && npm install --production` |
| **Start Command** | `node server/index.js` |
| **Health Check Path** | `/api/health` |
| **Plan** | Free (or Starter $7/mo for always-on) |

### Step 3 — Set Environment Variables

In the Render dashboard → Environment:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `3001` |
| `M3U_SOURCE` | `https://pocket-tv-tamil-5afe35.gitlab.io/jiostar.m3u` |
| `ALLOW_ALL_ORIGINS` | `true` |
| `SERVER_BASE_URL` | *(set after first deploy, e.g. `https://jiostar-player.onrender.com`)* |

### Step 4 — Set SERVER_BASE_URL

After the first deploy completes:
1. Copy your service URL (e.g. `https://jiostar-player.onrender.com`)
2. Add it as `SERVER_BASE_URL` in Environment Variables
3. Trigger a manual redeploy

> **Note:** `SERVER_BASE_URL` is used to rewrite HLS segment URLs in the manifest so they point back to your proxy. Without it, segment URLs in rewritten manifests will be relative paths (which still work in most cases).

---

## 💻 Local Development

### Prerequisites
- Node.js 18+
- npm 9+

### 1. Install dependencies

```bash
# Frontend
npm install

# Backend
cd server && npm install && cd ..
```

### 2. Start the proxy server

```bash
cd server
node index.js
# Server running on http://localhost:3001
```

### 3. Start the frontend dev server

In a new terminal:

```bash
# Set the API base to point to your local server
VITE_API_BASE=http://localhost:3001 npm run dev
# Frontend on http://localhost:5173
```

Or configure `.env.local`:

```env
VITE_API_BASE=http://localhost:3001
```

Then `npm run dev`.

### 4. Build for production

```bash
npm run build
# dist/ is created — the server will serve it automatically
node server/index.js
# Visit http://localhost:3001
```

---

## 📡 API Reference

### `GET /api/health`
Returns server status.
```json
{
  "status": "ok",
  "uptime": 3600,
  "m3uCached": true,
  "m3uAge": 120,
  "m3uSource": "https://..."
}
```

### `GET /api/m3u?refresh=true`
Returns the M3U playlist (server-cached for 6 hours).
- `?refresh=true` — force bypass cache

### `GET /api/proxy/stream`
Proxies an HLS (.m3u8) or DASH (.mpd) manifest. For HLS, rewrites all segment/key URLs to go through `/api/proxy/segment` and `/api/proxy/key`.

**Query params:**
| Param | Description |
|---|---|
| `url` | Target manifest URL (URL-encoded) |
| `cookie` | Cookie header value |
| `useragent` | User-Agent header value |
| `referer` | Referer header value |
| `origin` | Origin header value |

### `GET /api/proxy/segment`
Proxies binary TS/fMP4 segments with the same header params as above.

### `GET /api/proxy/key`
Proxies AES-128 HLS encryption key files.

### `GET /api/proxy/image`
Proxies channel logo images.
- `?url=` — image URL (URL-encoded)

---

## ✨ Features

| Feature | Details |
|---|---|
| **HLS Playback** | HLS.js with auto quality switching |
| **DASH Playback** | DASH.js with ABR |
| **ClearKey DRM** | `org.w3.clearkey` via DASH.js EME — hex keys auto-converted to Base64url |
| **Cookie injection** | Server injects `Cookie` header — impossible in browsers |
| **User-Agent spoofing** | Server sets correct UA per channel |
| **HLS segment proxying** | Manifest URLs rewritten so every segment is proxied |
| **Tamil channels first** | Auto-detected and sorted to top |
| **Sort** | Default / Name A→Z / Name Z→A / By Group |
| **Filter** | All channels / Tamil only / by group category |
| **Search** | Real-time search by name or group |
| **Auto-refresh** | M3U fetched every 6h (server cache + browser localStorage) |
| **Quality selector** | Manual per-level or Auto |
| **Grid & List view** | Toggle channel list layout |
| **Fullscreen** | Native browser fullscreen API |
| **Mobile** | Responsive layout with bottom drawer |
| **Server status** | Live proxy health badge in header |

---

## 📁 Project Structure

```
├── server/
│   ├── index.js          # Express proxy server
│   └── package.json      # Server dependencies
├── src/
│   ├── App.tsx            # Root component
│   ├── config.ts          # API base URL + proxy URL builders
│   ├── vite-env.d.ts      # Vite env type declarations
│   ├── hooks/
│   │   ├── useM3U.ts      # M3U fetch + parse + cache
│   │   └── usePlayer.ts   # HLS.js + DASH.js player engine
│   ├── utils/
│   │   └── m3uParser.ts   # Full M3U parser
│   ├── types/
│   │   └── channel.ts     # TypeScript types
│   └── components/
│       ├── VideoPlayer.tsx
│       ├── ChannelList.tsx
│       ├── ChannelCard.tsx
│       ├── ChannelInfo.tsx
│       └── MobileChannelDrawer.tsx
├── render.yaml            # Render.com deployment config
└── README.md
```

---

## ⚠️ Notes

- **Stream tokens expire** — URLs contain time-limited HMAC tokens. If a stream stops working, the M3U source needs to be updated with fresh tokens.
- **Render Free tier** — spins down after 15 minutes of inactivity. First request after sleep takes ~30s. Upgrade to Starter ($7/mo) for always-on.
- **Singapore region** — chosen for lowest latency to Indian CDN origins. Change in `render.yaml` if needed.
- **ClearKey DRM** — supported natively by DASH.js. The hex `keyId:key` from `#KODIPROP` is auto-converted to Base64url for the EME API.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite + Tailwind CSS |
| HLS Player | HLS.js |
| DASH Player | DASH.js |
| Backend | Node.js + Express |
| Deployment | Render.com |
| Icons | Lucide React |
