import React, { useRef, useState, useCallback } from 'react';
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  Settings, Loader2, AlertCircle, Radio, Tv2
} from 'lucide-react';
import { PlayerState, QualityLevel, Channel } from '../types/channel';

interface VideoPlayerProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  state: PlayerState;
  currentChannel: Channel | null;
  onTogglePlay: () => void;
  onToggleMute: () => void;
  onSetVolume: (vol: number) => void;
  onToggleFullscreen: () => void;
  onSetQuality: (id: number) => void;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return 'LIVE';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function VideoPlayer({
  videoRef,
  state,
  currentChannel,
  onTogglePlay,
  onToggleMute,
  onSetVolume,
  onToggleFullscreen,
  onSetQuality,
}: VideoPlayerProps) {
  const [showControls, setShowControls] = useState(true);
  const [showQuality, setShowQuality] = useState(false);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => {
      if (state.isPlaying) setShowControls(false);
    }, 3000);
  }, [state.isPlaying]);

  const isLive = !isFinite(state.duration) || state.duration === 0;

  return (
    <div
      ref={containerRef}
      className="relative w-full bg-black rounded-xl overflow-hidden group"
      style={{ aspectRatio: '16/9' }}
      onMouseMove={resetControlsTimer}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => { if (state.isPlaying) setShowControls(false); }}
      onTouchStart={resetControlsTimer}
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        className="w-full h-full object-contain bg-black"
        playsInline
        onClick={onTogglePlay}
      />

      {/* No Channel Selected */}
      {!currentChannel && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-gray-900 to-black text-gray-400">
          <Tv2 className="w-20 h-20 mb-4 text-gray-600" />
          <p className="text-xl font-semibold text-gray-300">Select a Channel</p>
          <p className="text-sm mt-2 text-gray-500">Choose from the channel list to start streaming</p>
        </div>
      )}

      {/* Loading Spinner */}
      {state.isLoading && currentChannel && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-12 h-12 text-red-500 animate-spin" />
            <p className="text-white text-sm font-medium">Loading stream...</p>
          </div>
        </div>
      )}

      {/* Error State */}
      {state.error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="flex flex-col items-center gap-3 text-center px-6">
            <AlertCircle className="w-12 h-12 text-red-500" />
            <p className="text-white font-semibold text-lg">Stream Error</p>
            <p className="text-gray-400 text-sm max-w-md">{state.error}</p>
            <p className="text-gray-500 text-xs">Try selecting the channel again or check your connection</p>
          </div>
        </div>
      )}

      {/* Channel Info Overlay (top) */}
      {currentChannel && (
        <div
          className={`absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}
        >
          <div className="flex items-center gap-3">
            {currentChannel.logo && (
              <img
                src={currentChannel.logo}
                alt={currentChannel.name}
                className="w-10 h-10 object-contain rounded bg-white/10 p-1"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            )}
            <div>
              <p className="text-white font-bold text-lg leading-tight">{currentChannel.name}</p>
              <div className="flex items-center gap-2">
                <span className="text-gray-300 text-xs">{currentChannel.group}</span>
                <span className="inline-flex items-center gap-1 bg-red-600 text-white text-xs px-2 py-0.5 rounded-full">
                  <Radio className="w-2.5 h-2.5 animate-pulse" /> LIVE
                </span>
                <span className="text-gray-400 text-xs uppercase font-mono">{currentChannel.streamType.toUpperCase()}</span>
                {currentChannel.licenseKey && (
                  <span className="text-xs bg-yellow-600/80 text-white px-1.5 py-0.5 rounded">DRM</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Controls Overlay (bottom) */}
      {currentChannel && (
        <div
          className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}
        >
          {/* Progress Bar (live indicator) */}
          <div className="px-4 pt-2">
            {!isLive ? (
              <div className="relative h-1.5 bg-white/20 rounded-full cursor-pointer group/progress">
                <div
                  className="absolute h-full bg-red-500 rounded-full"
                  style={{ width: `${(state.currentTime / state.duration) * 100}%` }}
                />
                <div
                  className="absolute h-full bg-white/30 rounded-full"
                  style={{ width: `${(state.buffered / state.duration) * 100}%` }}
                />
              </div>
            ) : (
              <div className="flex items-center gap-2 mb-1">
                <div className="flex-1 h-1 bg-red-500/40 rounded-full overflow-hidden">
                  <div className="h-full bg-red-500 rounded-full animate-pulse w-full" />
                </div>
              </div>
            )}
          </div>

          {/* Control Buttons */}
          <div className="flex items-center justify-between px-4 py-3">
            {/* Left controls */}
            <div className="flex items-center gap-3">
              <button
                onClick={onTogglePlay}
                className="text-white hover:text-red-400 transition-colors p-1 rounded-full hover:bg-white/10"
              >
                {state.isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
              </button>

              {/* Volume */}
              <div className="flex items-center gap-2">
                <button
                  onClick={onToggleMute}
                  className="text-white hover:text-red-400 transition-colors p-1 rounded-full hover:bg-white/10"
                >
                  {state.isMuted || state.volume === 0 ? (
                    <VolumeX className="w-5 h-5" />
                  ) : (
                    <Volume2 className="w-5 h-5" />
                  )}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={state.isMuted ? 0 : state.volume}
                  onChange={(e) => onSetVolume(parseFloat(e.target.value))}
                  className="w-20 h-1 accent-red-500 cursor-pointer"
                />
              </div>

              {/* Time */}
              <span className="text-white text-xs font-mono">
                {isLive ? (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse inline-block" />
                    LIVE
                  </span>
                ) : (
                  `${formatTime(state.currentTime)} / ${formatTime(state.duration)}`
                )}
              </span>
            </div>

            {/* Right controls */}
            <div className="flex items-center gap-2">
              {/* Quality Selector */}
              <div className="relative">
                <button
                  onClick={() => setShowQuality(!showQuality)}
                  className="text-white hover:text-red-400 transition-colors p-1.5 rounded hover:bg-white/10 flex items-center gap-1 text-xs"
                >
                  <Settings className="w-4 h-4" />
                  <span className="hidden sm:inline">{state.quality}</span>
                </button>

                {showQuality && (
                  <div className="absolute bottom-full right-0 mb-2 bg-gray-900/95 border border-gray-700 rounded-lg overflow-hidden shadow-xl min-w-[140px] z-50">
                    <div className="p-2 border-b border-gray-700">
                      <p className="text-gray-400 text-xs font-medium">Quality</p>
                    </div>
                    <button
                      onClick={() => { onSetQuality(-1); setShowQuality(false); }}
                      className="w-full text-left px-3 py-2 text-sm text-white hover:bg-red-600/50 transition-colors"
                    >
                      Auto
                    </button>
                    {state.qualities.map((q: QualityLevel) => (
                      <button
                        key={q.id}
                        onClick={() => { onSetQuality(q.id); setShowQuality(false); }}
                        className="w-full text-left px-3 py-2 text-sm text-white hover:bg-red-600/50 transition-colors"
                      >
                        {q.label}
                        {q.bitrate > 0 && (
                          <span className="text-gray-400 text-xs ml-1">({Math.round(q.bitrate / 1000)}k)</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Fullscreen */}
              <button
                onClick={onToggleFullscreen}
                className="text-white hover:text-red-400 transition-colors p-1 rounded-full hover:bg-white/10"
              >
                {state.isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
