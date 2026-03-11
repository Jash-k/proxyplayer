import { useState, useEffect } from 'react';
import { Tv2, Info, X, AlertTriangle, RefreshCw, CheckCircle2, Loader2, Server, Shield, Zap } from 'lucide-react';
import VideoPlayer from './components/VideoPlayer';
import ChannelList from './components/ChannelList';
import ChannelInfo from './components/ChannelInfo';
import MobileChannelDrawer from './components/MobileChannelDrawer';
import { useM3U } from './hooks/useM3U';
import { usePlayer } from './hooks/usePlayer';
import { Channel } from './types/channel';
import { API } from './config';

// ── Server health hook ────────────────────────────────────────────────────────
function useServerHealth() {
  const [status, setStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [info, setInfo] = useState<{ m3uCached?: boolean; uptime?: number } | null>(null);

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch(API.health, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const data = await res.json();
          setInfo(data);
          setStatus('online');
        } else {
          setStatus('offline');
        }
      } catch {
        setStatus('offline');
      }
    };
    check();
    const interval = setInterval(check, 60000); // check every minute
    return () => clearInterval(interval);
  }, []);

  return { status, info };
}

// ── About Modal ───────────────────────────────────────────────────────────────
function AboutModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl max-w-lg w-full p-6 relative max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 bg-gradient-to-br from-red-600 to-red-800 rounded-xl flex items-center justify-center">
            <Tv2 className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-white font-bold text-lg">JioStar Stream Player</h2>
            <p className="text-gray-400 text-sm">HLS / DASH / MPD ClearKey — Full Stack</p>
          </div>
        </div>

        <div className="space-y-4 text-sm text-gray-300">
          <div>
            <h3 className="text-white font-semibold mb-2 flex items-center gap-2">
              <Server className="w-4 h-4 text-blue-400" /> Server-Side Proxy
            </h3>
            <ul className="space-y-1 text-gray-400 text-xs">
              <li>✅ <strong className="text-gray-300">Cookie injection</strong> — server adds Cookie header to every request</li>
              <li>✅ <strong className="text-gray-300">User-Agent spoofing</strong> — server sets correct UA (e.g. Hotstar Android)</li>
              <li>✅ <strong className="text-gray-300">Referer/Origin</strong> — forwarded server-side, bypassing browser restrictions</li>
              <li>✅ <strong className="text-gray-300">HLS manifest rewriting</strong> — all segment/key URLs proxied automatically</li>
              <li>✅ <strong className="text-gray-300">M3U caching</strong> — 6h server-side cache, no CORS issues</li>
              <li>✅ <strong className="text-gray-300">ClearKey DRM</strong> — decryption keys proxied server-side</li>
            </ul>
          </div>

          <div>
            <h3 className="text-white font-semibold mb-2 flex items-center gap-2">
              <Zap className="w-4 h-4 text-yellow-400" /> Features
            </h3>
            <ul className="space-y-1 text-gray-400 text-xs">
              <li>✅ Plays HLS (.m3u8), DASH (.mpd) streams</li>
              <li>✅ ClearKey DRM (org.w3.clearkey) via DASH.js EME</li>
              <li>✅ Tamil channels shown first by default</li>
              <li>✅ Sort: Default / A→Z / Z→A / By Group</li>
              <li>✅ Filter by group, Tamil-only, or search</li>
              <li>✅ Auto-refresh every 6 hours with dual cache</li>
              <li>✅ Quality selector, volume, fullscreen controls</li>
              <li>✅ Grid & List view toggle</li>
              <li>✅ Mobile-friendly with bottom drawer</li>
            </ul>
          </div>

          <div>
            <h3 className="text-white font-semibold mb-2 flex items-center gap-2">
              <Shield className="w-4 h-4 text-green-400" /> Proxy Endpoints
            </h3>
            <div className="bg-gray-800 rounded-lg p-3 space-y-1 text-xs font-mono">
              <p><span className="text-green-400">GET</span> <span className="text-gray-300">/api/health</span> — server status</p>
              <p><span className="text-green-400">GET</span> <span className="text-gray-300">/api/m3u</span> — cached M3U playlist</p>
              <p><span className="text-green-400">GET</span> <span className="text-gray-300">/api/proxy/stream</span> — HLS/DASH manifest</p>
              <p><span className="text-green-400">GET</span> <span className="text-gray-300">/api/proxy/segment</span> — TS/MP4 segments</p>
              <p><span className="text-green-400">GET</span> <span className="text-gray-300">/api/proxy/key</span> — AES-128 keys</p>
              <p><span className="text-green-400">GET</span> <span className="text-gray-300">/api/proxy/image</span> — channel logos</p>
            </div>
          </div>

          <div>
            <h3 className="text-white font-semibold mb-2">🚀 Deployment</h3>
            <p className="text-gray-400 text-xs">Deployed on Render.com — Singapore region for low latency to India streams.</p>
            <p className="text-gray-400 text-xs mt-1">Node.js/Express backend serves the React frontend from the same origin.</p>
          </div>

          <div>
            <h3 className="text-white font-semibold mb-2">📡 M3U Source</h3>
            <p className="text-gray-400 text-xs font-mono break-all">
              https://pocket-tv-tamil-5afe35.gitlab.io/jiostar.m3u
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Fetch status banner ───────────────────────────────────────────────────────
function FetchStatusBanner({
  isLoading,
  error,
  channels,
  fetchSource,
  onRefresh,
}: {
  isLoading: boolean;
  error: string | null;
  channels: number;
  fetchSource: string;
  onRefresh: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);

  // Reset dismissed when a new successful fetch happens
  useEffect(() => {
    if (!isLoading && !error && channels > 0) setDismissed(false);
  }, [isLoading, error, channels]);

  if (dismissed) return null;

  if (isLoading && channels === 0) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-blue-900/20 border border-blue-800/40 rounded-xl text-sm">
        <Loader2 className="w-4 h-4 text-blue-400 animate-spin flex-shrink-0" />
        <span className="text-blue-300">Fetching channel list via server proxy…</span>
      </div>
    );
  }

  if (error && channels === 0) {
    return (
      <div className="flex items-start gap-3 px-4 py-3 bg-red-900/20 border border-red-800/40 rounded-xl text-sm">
        <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-red-300 font-medium">Failed to load channel list</p>
          <p className="text-red-400/70 text-xs mt-0.5 break-words line-clamp-2">{error}</p>
        </div>
        <button
          onClick={onRefresh}
          className="flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs rounded-lg transition-colors flex-shrink-0"
        >
          <RefreshCw className="w-3 h-3" /> Retry
        </button>
      </div>
    );
  }

  if (error && channels > 0) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-yellow-900/20 border border-yellow-800/40 rounded-xl text-sm">
        <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0" />
        <span className="text-yellow-300 flex-1">
          Showing cached channels — live refresh failed
        </span>
        <button onClick={() => setDismissed(true)} className="text-yellow-500 hover:text-yellow-300">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  if (!isLoading && !error && channels > 0) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-green-900/15 border border-green-800/30 rounded-xl text-sm">
        <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
        <span className="text-green-300 flex-1">
          Loaded <strong>{channels}</strong> channels
          {fetchSource && <span className="text-green-400/60 text-xs ml-2">via {fetchSource}</span>}
        </span>
        <button onClick={() => setDismissed(true)} className="text-green-600 hover:text-green-400">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return null;
}

// ── Server status badge ───────────────────────────────────────────────────────
function ServerStatusBadge({ status, info }: { status: 'checking' | 'online' | 'offline'; info: { m3uCached?: boolean; uptime?: number } | null }) {
  const color = status === 'online' ? 'bg-green-500' : status === 'offline' ? 'bg-red-500' : 'bg-yellow-500';
  const label = status === 'online' ? 'Proxy Online' : status === 'offline' ? 'Proxy Offline' : 'Checking…';
  const title = info
    ? `Uptime: ${Math.round((info.uptime || 0) / 60)}m | M3U cached: ${info.m3uCached ? 'yes' : 'no'}`
    : 'Server proxy status';

  return (
    <div
      className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-gray-800 rounded-full cursor-default"
      title={title}
    >
      <Server className="w-3 h-3 text-gray-500" />
      <div className={`w-2 h-2 rounded-full ${color} ${status === 'checking' ? 'animate-pulse' : ''}`} />
      <span className="text-xs text-gray-400">{label}</span>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const { channels, isLoading, error, fetchSource, lastFetched, nextRefresh, refresh } = useM3U();
  const {
    videoRef,
    state: playerState,
    currentChannel,
    loadChannel,
    togglePlay,
    toggleMute,
    setVolume,
    toggleFullscreen,
    setQuality,
  } = usePlayer();
  const { status: serverStatus, info: serverInfo } = useServerHealth();

  const [showAbout, setShowAbout] = useState(false);
  const [showInfo, setShowInfo] = useState(true);

  const handleSelectChannel = (channel: Channel) => {
    loadChannel(channel);
    setShowInfo(true);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col" style={{ fontFamily: 'Inter, sans-serif' }}>
      {/* Header */}
      <header className="flex-shrink-0 border-b border-gray-800 bg-gray-900/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-screen-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-red-600 to-red-800 rounded-xl flex items-center justify-center shadow-lg">
              <Tv2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-white font-bold text-lg leading-tight">JioStar Player</h1>
              <p className="text-gray-500 text-xs hidden sm:block">HLS • DASH • MPD • ClearKey • Server Proxy</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Server status */}
            <ServerStatusBadge status={serverStatus} info={serverInfo} />

            {/* Channel count */}
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-gray-800 rounded-full">
              {isLoading ? (
                <Loader2 className="w-2.5 h-2.5 text-yellow-400 animate-spin" />
              ) : (
                <div className={`w-2 h-2 rounded-full ${error && channels.length === 0 ? 'bg-red-500' : 'bg-green-500'}`} />
              )}
              <span className="text-xs text-gray-400">
                {isLoading
                  ? 'Loading…'
                  : error && channels.length === 0
                    ? 'Fetch error'
                    : `${channels.length} channels`}
              </span>
            </div>

            <button
              onClick={refresh}
              disabled={isLoading}
              className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
              title="Refresh channel list"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>

            <button
              onClick={() => setShowAbout(true)}
              className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
              title="About"
            >
              <Info className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-screen-2xl mx-auto w-full px-4 py-4 flex flex-col gap-4">

        {/* Status Banner */}
        <FetchStatusBanner
          isLoading={isLoading}
          error={error}
          channels={channels.length}
          fetchSource={fetchSource}
          onRefresh={refresh}
        />

        {/* Mobile Channel Drawer */}
        <MobileChannelDrawer
          channels={channels}
          currentChannel={currentChannel}
          onSelectChannel={handleSelectChannel}
          isLoading={isLoading}
          error={error}
          lastFetched={lastFetched}
          nextRefresh={nextRefresh}
          onRefresh={refresh}
        />

        {/* Desktop Layout */}
        <div className="flex gap-4 flex-1">
          {/* Sidebar */}
          <div className="hidden lg:flex flex-col w-80 xl:w-96 flex-shrink-0">
            <ChannelList
              channels={channels}
              currentChannel={currentChannel}
              onSelectChannel={handleSelectChannel}
              isLoading={isLoading}
              error={error}
              lastFetched={lastFetched}
              nextRefresh={nextRefresh}
              onRefresh={refresh}
            />
          </div>

          {/* Player Area */}
          <div className="flex-1 flex flex-col gap-4 min-w-0">
            <VideoPlayer
              videoRef={videoRef}
              state={playerState}
              currentChannel={currentChannel}
              onTogglePlay={togglePlay}
              onToggleMute={toggleMute}
              onSetVolume={setVolume}
              onToggleFullscreen={toggleFullscreen}
              onSetQuality={setQuality}
            />

            {/* Channel Info */}
            {currentChannel && showInfo && (
              <div className="relative">
                <button
                  onClick={() => setShowInfo(false)}
                  className="absolute top-3 right-3 z-10 text-gray-500 hover:text-white transition-colors"
                  title="Hide channel info"
                >
                  <X className="w-4 h-4" />
                </button>
                <ChannelInfo channel={currentChannel} />
              </div>
            )}

            {!showInfo && currentChannel && (
              <button
                onClick={() => setShowInfo(true)}
                className="text-gray-500 hover:text-gray-300 text-sm transition-colors self-start"
              >
                + Show channel info
              </button>
            )}

            {/* Stats Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                {
                  label: 'Total Channels',
                  value: channels.length,
                  color: 'text-blue-400',
                  bg: 'bg-blue-900/10 border-blue-800/20',
                },
                {
                  label: 'Tamil Channels',
                  value: channels.filter(c => c.isTamil).length,
                  color: 'text-yellow-400',
                  bg: 'bg-yellow-900/10 border-yellow-800/20',
                },
                {
                  label: 'DRM Streams',
                  value: channels.filter(c => c.licenseKey).length,
                  color: 'text-red-400',
                  bg: 'bg-red-900/10 border-red-800/20',
                },
                {
                  label: 'Groups',
                  value: [...new Set(channels.map(c => c.group))].length,
                  color: 'text-green-400',
                  bg: 'bg-green-900/10 border-green-800/20',
                },
              ].map(stat => (
                <div key={stat.label} className={`border rounded-xl p-3 flex flex-col gap-1 ${stat.bg}`}>
                  <span className={`text-2xl font-bold ${stat.color}`}>
                    {isLoading && stat.value === 0
                      ? <span className="text-base text-gray-600 animate-pulse">…</span>
                      : stat.value}
                  </span>
                  <span className="text-gray-500 text-xs">{stat.label}</span>
                </div>
              ))}
            </div>

            {/* Server Proxy Info bar */}
            <div className="flex items-center gap-3 px-4 py-3 bg-blue-900/10 border border-blue-800/20 rounded-xl">
              <Shield className="w-4 h-4 text-blue-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-blue-300 text-xs font-medium">Server-Side Proxy Active</p>
                <p className="text-blue-400/60 text-xs">
                  Cookie, User-Agent &amp; Referer headers are injected server-side.
                  HLS segments and encryption keys are proxied automatically.
                </p>
              </div>
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${serverStatus === 'online' ? 'bg-green-400' : serverStatus === 'offline' ? 'bg-red-400' : 'bg-yellow-400 animate-pulse'}`} />
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 py-4 px-4 text-center">
        <p className="text-gray-600 text-xs">
          JioStar Stream Player • Server Proxy on Render.com • React + HLS.js + DASH.js + Express
        </p>
      </footer>

      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
    </div>
  );
}
