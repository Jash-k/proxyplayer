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
    const clean = hex.replace(/\s/g, '');
    const bytes = new Uint8Array(
      clean.match(/.{1,2}/g)!.map(b => parseInt(b, 16))
    );
    const b64 = btoa(String.fromCharCode(...Array.from(bytes)));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  } catch {
    return '';
  }
}

/**
 * Build the proxied manifest URL for a channel.
 * The server proxy:
 *   - Injects Cookie / User-Agent / Referer / Origin when fetching the manifest
 *   - For HLS: rewrites ALL segment and key URLs to go through /api/proxy/segment
 *   - For DASH/MPD: rewrites ALL BaseURL / initialization / media URLs similarly
 * So DASH.js and HLS.js only ever talk to our proxy — never to the CDN directly.
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
      try { hlsRef.current.destroy(); } catch { /* ignore */ }
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

  // ── DASH.js ─────────────────────────────────────────────────────────────────
  const loadDashStream = useCallback(async (channel: Channel, video: HTMLVideoElement) => {
    try {
      const dashjs = await import('dashjs');
      const player = (dashjs.MediaPlayer as any)().create();
      dashRef.current = player;

      player.initialize(video, undefined, false);

      // ClearKey DRM — convert hex keyId/key to Base64url for the EME API
      if (channel.clearKey?.keyId && channel.clearKey?.key) {
        const keyIdB64 = hexToBase64url(channel.clearKey.keyId);
        const keyB64 = hexToBase64url(channel.clearKey.key);
        if (keyIdB64 && keyB64) {
          console.log('[DASH] Setting ClearKey DRM', { keyIdB64, keyB64 });
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
          retryAttempts: {
            MPD: 3,
            XLinkExpansion: 1,
            InitializationSegment: 3,
            BitstreamSwitchingSegment: 3,
            IndexSegment: 3,
            MediaSegment: 3,
            FragmentInfoSegment: 3,
          },
          retryIntervals: {
            MPD: 500,
            MediaSegment: 1000,
            InitializationSegment: 1000,
          },
          abr: { autoSwitchBitrate: { video: true, audio: true } },
          manifestUpdateRetryAttempts: 3,
          gaps: { jumpGaps: true, jumpLargeGaps: true },
        },
        debug: { logLevel: 0 },
      });

      // The proxy URL: server fetches the MPD and rewrites ALL segment URLs
      // inside it to go through /api/proxy/segment with the correct auth headers.
      // DASH.js then fetches those rewritten URLs — all going through our proxy.
      const proxyUrl = buildChannelProxyUrl(channel);
      console.log('[DASH] Loading via proxy:', proxyUrl.substring(0, 120));
      player.attachSource(proxyUrl);
      player.play();

      const events = (dashjs.MediaPlayer as any).events;

      player.on(events.ERROR, (e: any) => {
        const code = e?.error?.code;
        const msg = e?.error?.message || e?.error?.data?.message || '';
        console.error('[DASH] Error event:', e);

        // Ignore non-fatal protection/DRM init errors that DASH.js self-recovers
        if (code === 'mediaKeySystemAccess' && !msg) return;

        let friendly = `DASH error (${code ?? 'unknown'})`;
        if (msg) friendly += `: ${msg}`;
        if (code === 27 || msg.includes('403'))
          friendly = 'Stream token expired (HTTP 403). Wait for the M3U to refresh (every 6h).';
        else if (code === 25 || msg.includes('404'))
          friendly = 'Stream not found (HTTP 404). Channel may be offline.';
        else if (msg.includes('network') || code === 1)
          friendly = 'Network error fetching stream. Check your connection.';

        updateState({ error: friendly, isLoading: false });
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

      player.on(events.PLAYBACK_STARTED, () =>
        updateState({ isPlaying: true, isLoading: false, error: null })
      );
      player.on(events.PLAYBACK_PAUSED, () => updateState({ isPlaying: false }));
      player.on(events.BUFFER_EMPTY, () => updateState({ isLoading: true }));
      player.on(events.BUFFER_LOADED, () => updateState({ isLoading: false }));
      player.on(events.MANIFEST_LOADED, () => {
        console.log('[DASH] Manifest loaded');
        updateState({ isLoading: false, error: null });
      });
      player.on(events.PLAYBACK_ERROR, (e: any) => {
        console.error('[DASH] Playback error:', e);
        updateState({ error: `Playback error: ${e?.error ?? 'unknown'}`, isLoading: false });
      });
    } catch (err) {
      console.error('[DASH] Init error:', err);
      updateState({
        error: `DASH player init failed: ${err instanceof Error ? err.message : err}`,
        isLoading: false,
      });
    }
  }, [updateState]);

  // ── HLS.js ──────────────────────────────────────────────────────────────────
  const loadHLSStream = useCallback((channel: Channel, video: HTMLVideoElement) => {
    if (Hls.isSupported()) {
      const proxyUrl = buildChannelProxyUrl(channel);
      console.log('[HLS] Loading via proxy:', proxyUrl.substring(0, 120));

      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
        fragLoadingMaxRetry: 4,
        manifestLoadingMaxRetry: 3,
        levelLoadingMaxRetry: 4,
        fragLoadingRetryDelay: 1000,
        manifestLoadingRetryDelay: 1000,
      });

      hlsRef.current = hls;
      hls.loadSource(proxyUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        const qualities: QualityLevel[] = data.levels.map((l, idx) => ({
          id: idx,
          label: l.height
            ? `${l.height}p`
            : l.bitrate
              ? `${Math.round(l.bitrate / 1000)}kbps`
              : `Level ${idx}`,
          height: l.height || 0,
          bitrate: l.bitrate || 0,
        }));
        updateState({ qualities, isLoading: false, error: null });
        video.play().catch(e => console.warn('[HLS] Autoplay blocked:', e));
      });

      let networkRetries = 0;
      let mediaRetries = 0;

      hls.on(Hls.Events.ERROR, (_, data) => {
        console.warn('[HLS] Error:', data.type, data.details, 'fatal:', data.fatal);
        if (!data.fatal) return;

        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            networkRetries++;
            if (networkRetries <= 4) {
              const delay = 1000 * networkRetries;
              console.log(`[HLS] Network error — retry ${networkRetries} in ${delay}ms`);
              setTimeout(() => {
                try { hls.startLoad(); } catch { /* ignore if destroyed */ }
              }, delay);
            } else {
              updateState({
                error: `Network error: ${data.details}. The stream token may have expired (tokens refresh every 6h).`,
                isLoading: false,
              });
            }
            break;

          case Hls.ErrorTypes.MEDIA_ERROR:
            mediaRetries++;
            if (mediaRetries <= 3) {
              console.log(`[HLS] Media error — recovering (attempt ${mediaRetries})`);
              hls.recoverMediaError();
            } else {
              updateState({
                error: `Media decode error: ${data.details}. Try reloading the channel.`,
                isLoading: false,
              });
            }
            break;

          default:
            updateState({
              error: `Stream error: ${data.details}`,
              isLoading: false,
            });
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
      // Native HLS (Safari/iOS)
      const proxyUrl = buildChannelProxyUrl(channel);
      console.log('[HLS/Native] Loading:', proxyUrl.substring(0, 120));
      video.src = proxyUrl;
      updateState({ isLoading: false });
      video.addEventListener(
        'loadedmetadata',
        () => video.play().catch(e => console.warn('[HLS/Native] Autoplay blocked:', e)),
        { once: true }
      );
    } else {
      updateState({ error: 'HLS playback is not supported in this browser.', isLoading: false });
    }
  }, [updateState]);

  // ── Load channel ─────────────────────────────────────────────────────────────
  const loadChannel = useCallback(
    async (channel: Channel) => {
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
          error: `Failed to start player: ${err instanceof Error ? err.message : err}`,
          isLoading: false,
        });
      }
    },
    [destroyPlayers, loadDashStream, loadHLSStream, updateState, state.volume, state.isMuted]
  );

  // ── Controls ─────────────────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.paused ? v.play().catch(console.error) : v.pause();
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    updateState({ isMuted: v.muted });
  }, [updateState]);

  const setVolume = useCallback((vol: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = vol;
    v.muted = vol === 0;
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

  const setQuality = useCallback(
    (qualityId: number) => {
      if (hlsRef.current) {
        hlsRef.current.currentLevel = qualityId;
        const lvl = qualityId === -1 ? null : hlsRef.current.levels[qualityId];
        updateState({
          quality: qualityId === -1 ? 'Auto' : lvl?.height ? `${lvl.height}p` : 'Manual',
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
    },
    [state.qualities, updateState]
  );

  // ── Video element events ──────────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () =>
      setState(prev => ({
        ...prev,
        currentTime: video.currentTime,
        duration: video.duration || 0,
        buffered:
          video.buffered.length > 0
            ? video.buffered.end(video.buffered.length - 1)
            : 0,
      }));

    const onPlay = () => updateState({ isPlaying: true, isLoading: false });
    const onPause = () => updateState({ isPlaying: false });
    const onWaiting = () => updateState({ isLoading: true });
    const onCanPlay = () => updateState({ isLoading: false });
    const onVolumeChange = () =>
      updateState({ volume: video.volume, isMuted: video.muted });
    const onFullscreenChange = () =>
      updateState({ isFullscreen: !!document.fullscreenElement });
    const onError = () => {
      const err = video.error;
      if (!err) return;
      const map: Record<number, string> = {
        1: 'Playback aborted.',
        2: 'Network error while loading media.',
        3: 'Media decoding failed.',
        4: 'Stream format unsupported or URL has expired.',
      };
      updateState({ error: map[err.code] || `Video error (code ${err.code})`, isLoading: false });
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
