export interface ClearKeyData {
  keyId: string;
  key: string;
}

export interface Channel {
  id: string;
  name: string;
  logo: string;
  group: string;
  url: string;
  userAgent?: string;
  cookie?: string;
  referer?: string;
  origin?: string;
  licenseType?: string;
  licenseKey?: string;
  clearKey?: ClearKeyData;
  streamType: 'hls' | 'dash' | 'mpd';
  isTamil: boolean;
}

export interface PlayerState {
  isPlaying: boolean;
  isMuted: boolean;
  volume: number;
  isFullscreen: boolean;
  isLoading: boolean;
  error: string | null;
  currentTime: number;
  duration: number;
  buffered: number;
  quality: string;
  qualities: QualityLevel[];
}

export interface QualityLevel {
  id: number;
  label: string;
  height: number;
  bitrate: number;
}

export type SortOption = 'default' | 'name-asc' | 'name-desc' | 'group';
export type FilterGroup = string | 'all' | 'tamil';
