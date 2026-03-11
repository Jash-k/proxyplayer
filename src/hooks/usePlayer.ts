import { useRef, useState, useCallback, useEffect } from 'react';
import Hls from 'hls.js';
import { Channel, PlayerState, QualityLevel } from '../types/channel';
import { buildProxyStreamUrl } from '../config';

const DEFAULT_STATE: PlayerState = {
  isPlaying: false,
  isMuted: false,
  volume: 1,
  isFullscreen: false,
  isLoading: false,
  error: null,
  currentTime: 0,
  duration: 0,
  buffered: 0,
  quality: 'Auto',
  qualities: [],
};

function hexToBase64url(hex: string): string {
  try {
    const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)));
    const b64 = btoa(String.fromCharCode(...Array.from(bytes)));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  } catch {
    return '';
  }
}

/**
 * Build the proxied URL for a channel's stream.
 * The server proxy injects Cookie/User-Agent/Referer/Origin when fetching upstream.
 * For HLS, the server also rewrites segment URLs so all segments go through the proxy.
 */
function buildChannelProxyUrl(channel: Channel): string {
  return buildProxyStreamUrl({
    url: channel.url,
    cookie: channel.cookie,
    userAgent: channel.userAgent,
    referer: channel.referer,
    origin: channel.origin,
  });
}

export function usePlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const dashRef = useRef<unknown>(null);
  const [state, setState] = useState<PlayerState>(DEFAULT_STATE);
  const [currentChannel, setCurrentChannel] = useState<Channel | null>(null);

  const updateState = useCallback((updates: Partial<PlayerState>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);

  const destroyPlayers = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (dashRef.current) {
      try {
        (dashRef.current as any).reset?.();
        (dashRef.current as any).destroy?.();
      } catch { /* ignore */ }
      dashRef.current = null;
    }
  }, []);

  // ── DASH.js loader ─────────────────────────────────────────────────────────
  const loadDashStream = useCallback(async (channel: Channel, video: HTMLVideoElement) => {
    try {
      const dashjs = await import('dashjs');
      const player = (dashjs.MediaPlayer as any)().create();
      dashRef.current = player;

      player.initialize(video, undefined, false);

      // ClearKey DRM
      if (channel.clearKey?.keyId && channel.clearKey?.key) {
        const keyIdB64 = hexToBase64url(channel.clearKey.keyId);
        const keyB64 = hexToBase64url(channel.clearKey.key);
        if (keyIdB64 && keyB64) {
          player.setProtectionData({
            'org.w3.clearkey': {
              clearkeys: { [keyIdB64]: keyB64 },
            },
          });
        }
      }

      player.updateSettings({
        streaming: {
          lowLatencyEnabled: false,
          abr: { autoSwitchBitrate: { video: true, audio: true } },
          manifestUpdateRetryAttempts: 3,
        },
        debug: { logLevel: 0 },
      });

      // For DASH, we route the manifest through our proxy.
      // Segments are handled by DASH.js internally; since our proxy
      // rewrites the MPD's base URLs (future enhancement), or we rely on
      // the server rewriting segment URLs within MPD responses.
      // For now, use the proxied manifest URL — cookies/headers are applied
      // by the server when fetching the MPD and its referenced media.
      const proxyUrl = buildChannelProxyUrl(channel);
      player.attachSource(proxyUrl);
      player.play();

      const events = (dashjs.MediaPlayer as any).events;

      player.on(events.ERROR, (e: any) => {
        const detail = e?.error?.message || e?.error?.code || JSON.stringify(e?.error ?? e);
        console.error('[DASH] Error:', e);
        updateState({ error: `Stream error: ${detail}`, isLoading: false });
      });

      player.on(events.STREAM_INITIALIZED, () => {
        updateState({ isLoading: false, error: null });
        try {
          const bitrateList = player.getBitrateInfoListFor('video');
          if (bitrateList?.length > 0) {
            const qualities: QualityLevel[] = bitrateList.map((b: any, idx: number) => ({
              id: idx,
              label: b.height ? `${b.height}p` : `${Math.round((b.bitrate || 0) / 1000)}kbps`,
              height: b.height || 0,
              bitrate: b.bitrate || 0,
            }));
            updateState({ qualities, quality: 'Auto' });
          }
        } catch { /* no video tracks */ }
      });

      player.on(events.PLAYBACK_STARTED, () => updateState({ isPlaying: true, isLoading: false, error: null }));
      player.on(events.PLAYBACK_PAUSED, () => updateState({ isPlaying: false }));
      player.on(events.BUFFER_EMPTY, () => updateState({ isLoading: true }));
      player.on(events.BUFFER_LOADED, () => updateState({ isLoading: false }));
      player.on(events.MANIFEST_LOADED, () => updateState({ isLoading: false }));

    } catch (err) {
      console.error('[DASH] Init error:', err);
      updateState({
        error: `Failed to initialize DASH player: ${err instanceof Error ? err.message : err}`,
        isLoading: false,
      });
    }
  }, [updateState]);

  // ── HLS.js loader ──────────────────────────────────────────────────────────
  const loadHLSStream = useCallback((channel: Channel, video: HTMLVideoElement) => {
    if (Hls.isSupported()) {
      // The proxy URL: our server fetches the HLS manifest and rewrites all
      // segment/key URLs to go through /api/proxy/segment and /api/proxy/key.
      // This means Cookie/User-Agent are injected server-side for EVERY request.
      const proxyUrl = buildChannelProxyUrl(channel);

      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
        // Since segments are already proxied via URL rewriting in the manifest,
        // no xhrSetup header injection needed here.
      });

      hlsRef.current = hls;
      hls.loadSource(proxyUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        const qualities: QualityLevel[] = data.levels.map((l, idx) => ({
          id: idx,
          label: l.height ? `${l.height}p` : l.bitrate ? `${Math.round(l.bitrate / 1000)}kbps` : `Level ${idx}`,
          height: l.height || 0,
          bitrate: l.bitrate || 0,
        }));
        updateState({ qualities, isLoading: false, error: null });
        video.play().catch(e => console.warn('[HLS] Autoplay blocked:', e));
      });

      let networkErrors = 0;
      let mediaErrors = 0;

      hls.on(Hls.Events.ERROR, (_, data) => {
        console.warn('[HLS] Error:', data.type, data.details, data.fatal);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              networkErrors++;
              if (networkErrors <= 3) {
                console.log('[HLS] Network error, retrying…');
                setTimeout(() => hls.startLoad(), 1500 * networkErrors);
              } else {
                updateState({
                  error: `Network error: ${data.details}. The stream may have expired or be unavailable.`,
                  isLoading: false,
                });
              }
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              mediaErrors++;
              if (mediaErrors <= 2) {
                console.log('[HLS] Media error, recovering…');
                hls.recoverMediaError();
              } else {
                updateState({
                  error: `Media error: ${data.details}. Try selecting the channel again.`,
                  isLoading: false,
                });
              }
              break;
            default:
              updateState({
                error: `Fatal stream error: ${data.details}`,
                isLoading: false,
              });
          }
        }
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        const level = hls.levels[data.level];
        if (level) {
          const label = level.height
            ? `${level.height}p`
            : level.bitrate
              ? `${Math.round(level.bitrate / 1000)}kbps`
              : 'Auto';
          updateState({ quality: hls.autoLevelEnabled ? `Auto (${label})` : label });
        }
      });

      hls.on(Hls.Events.FRAG_BUFFERED, () => updateState({ isLoading: false }));

    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS (Safari / iOS) — use proxied URL
      const proxyUrl = buildChannelProxyUrl(channel);
      video.src = proxyUrl;
      updateState({ isLoading: false });
      video.addEventListener('loadedmetadata', () => {
        video.play().catch(e => console.warn('[Native HLS] Autoplay blocked:', e));
      }, { once: true });
    } else {
      updateState({
        error: 'HLS playback is not supported in this browser.',
        isLoading: false,
      });
    }
  }, [updateState]);

  // ── Public: load channel ───────────────────────────────────────────────────
  const loadChannel = useCallback(async (channel: Channel) => {
    const video = videoRef.current;
    if (!video) return;

    destroyPlayers();
    setCurrentChannel(channel);
    updateState({
      ...DEFAULT_STATE,
      isLoading: true,
      volume: state.volume,
      isMuted: state.isMuted,
    });

    video.volume = state.volume;
    video.muted = state.isMuted;

    try {
      if (channel.streamType === 'dash' || channel.streamType === 'mpd') {
        await loadDashStream(channel, video);
      } else {
        loadHLSStream(channel, video);
      }
    } catch (err) {
      updateState({
        error: `Failed to initialize player: ${err instanceof Error ? err.message : err}`,
        isLoading: false,
      });
    }
  }, [destroyPlayers, loadDashStream, loadHLSStream, updateState, state.volume, state.isMuted]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.paused ? video.play().catch(console.error) : video.pause();
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    updateState({ isMuted: video.muted });
  }, [updateState]);

  const setVolume = useCallback((vol: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = vol;
    video.muted = vol === 0;
    updateState({ volume: vol, isMuted: vol === 0 });
  }, [updateState]);

  const toggleFullscreen = useCallback(() => {
    const container = videoRef.current?.parentElement;
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen().then(() => updateState({ isFullscreen: true })).catch(console.error);
    } else {
      document.exitFullscreen().then(() => updateState({ isFullscreen: false })).catch(console.error);
    }
  }, [updateState]);

  const setQuality = useCallback((qualityId: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = qualityId;
      const lvl = qualityId === -1 ? null : hlsRef.current.levels[qualityId];
      updateState({
        quality: qualityId === -1 ? 'Auto' : (lvl?.height ? `${lvl.height}p` : 'Manual'),
      });
    } else if (dashRef.current) {
      const dash = dashRef.current as any;
      if (qualityId === -1) {
        dash.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: true } } } });
        updateState({ quality: 'Auto' });
      } else {
        dash.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: false } } } });
        dash.setQualityFor('video', qualityId);
        updateState({ quality: state.qualities[qualityId]?.label || 'Manual' });
      }
    }
  }, [state.qualities, updateState]);

  // ── Video element event listeners ──────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => {
      setState(prev => ({
        ...prev,
        currentTime: video.currentTime,
        duration: video.duration || 0,
        buffered: video.buffered.length > 0 ? video.buffered.end(video.buffered.length - 1) : 0,
      }));
    };

    const onPlay = () => updateState({ isPlaying: true, isLoading: false });
    const onPause = () => updateState({ isPlaying: false });
    const onWaiting = () => updateState({ isLoading: true });
    const onCanPlay = () => updateState({ isLoading: false });
    const onVolumeChange = () => updateState({ volume: video.volume, isMuted: video.muted });
    const onFullscreenChange = () => updateState({ isFullscreen: !!document.fullscreenElement });
    const onError = () => {
      const err = video.error;
      if (err) {
        const messages: Record<number, string> = {
          1: 'Playback aborted by user',
          2: 'Network error while loading stream',
          3: 'Media decoding error',
          4: 'Stream format not supported or URL expired',
        };
        updateState({
          error: messages[err.code] || `Video error (code ${err.code})`,
          isLoading: false,
        });
      }
    };

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('volumechange', onVolumeChange);
    video.addEventListener('error', onError);
    document.addEventListener('fullscreenchange', onFullscreenChange);

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('volumechange', onVolumeChange);
      video.removeEventListener('error', onError);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, [updateState]);

  useEffect(() => () => destroyPlayers(), [destroyPlayers]);

  return {
    videoRef,
    state,
    currentChannel,
    loadChannel,
    togglePlay,
    toggleMute,
    setVolume,
    toggleFullscreen,
    setQuality,
  };
}
