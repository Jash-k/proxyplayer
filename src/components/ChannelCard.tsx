import { Play, Star, Lock } from 'lucide-react';
import { Channel } from '../types/channel';
import { cn } from '../utils/cn';

interface ChannelCardProps {
  channel: Channel;
  isActive: boolean;
  onClick: () => void;
  viewMode: 'grid' | 'list';
}

export default function ChannelCard({ channel, isActive, onClick, viewMode }: ChannelCardProps) {
  if (viewMode === 'list') {
    return (
      <button
        onClick={onClick}
        className={cn(
          'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-200',
          isActive
            ? 'bg-red-600 text-white shadow-lg shadow-red-900/30'
            : 'hover:bg-white/5 text-gray-300 hover:text-white'
        )}
      >
        {/* Logo */}
        <div className={cn(
          'w-10 h-10 rounded-md flex-shrink-0 overflow-hidden flex items-center justify-center',
          isActive ? 'bg-white/20' : 'bg-gray-800'
        )}>
          {channel.logo ? (
            <img
              src={channel.logo}
              alt={channel.name}
              className="w-full h-full object-contain p-1"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
                (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
              }}
            />
          ) : null}
          <span className={cn('text-lg font-bold hidden', !channel.logo && '!block')}>
            {channel.name.charAt(0)}
          </span>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className={cn(
            'text-sm font-semibold truncate',
            isActive ? 'text-white' : 'text-gray-200'
          )}>
            {channel.name}
          </p>
          <p className={cn(
            'text-xs truncate',
            isActive ? 'text-red-100' : 'text-gray-500'
          )}>
            {channel.group}
          </p>
        </div>

        {/* Badges */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {channel.isTamil && (
            <Star className={cn('w-3.5 h-3.5', isActive ? 'text-yellow-300' : 'text-yellow-500')} fill="currentColor" />
          )}
          {channel.licenseKey && (
            <Lock className={cn('w-3 h-3', isActive ? 'text-red-200' : 'text-gray-500')} />
          )}
          <span className={cn(
            'text-xs font-mono px-1.5 py-0.5 rounded',
            isActive ? 'bg-white/20 text-white' : 'bg-gray-700 text-gray-400'
          )}>
            {channel.streamType.toUpperCase()}
          </span>
          {isActive && <Play className="w-3 h-3 text-white" fill="currentColor" />}
        </div>
      </button>
    );
  }

  // Grid view
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative flex flex-col items-center rounded-xl p-3 gap-2 text-center transition-all duration-200 border group',
        isActive
          ? 'bg-red-600 border-red-500 shadow-lg shadow-red-900/30 scale-[1.02]'
          : 'bg-gray-800/60 border-gray-700/50 hover:bg-gray-800 hover:border-gray-600 hover:scale-[1.02]'
      )}
    >
      {/* Active indicator */}
      {isActive && (
        <div className="absolute top-2 right-2">
          <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
        </div>
      )}

      {/* Tamil badge */}
      {channel.isTamil && (
        <div className="absolute top-2 left-2">
          <Star className="w-3 h-3 text-yellow-400" fill="currentColor" />
        </div>
      )}

      {/* Logo */}
      <div className={cn(
        'w-14 h-14 rounded-lg overflow-hidden flex items-center justify-center text-2xl font-bold',
        isActive ? 'bg-white/20' : 'bg-gray-700'
      )}>
        {channel.logo ? (
          <img
            src={channel.logo}
            alt={channel.name}
            className="w-full h-full object-contain p-1"
            onError={(e) => {
              const img = e.target as HTMLImageElement;
              img.style.display = 'none';
              const parent = img.parentElement;
              if (parent) parent.textContent = channel.name.charAt(0);
            }}
          />
        ) : (
          <span className={isActive ? 'text-white' : 'text-gray-300'}>{channel.name.charAt(0)}</span>
        )}
      </div>

      {/* Name */}
      <p className={cn(
        'text-xs font-semibold leading-tight line-clamp-2 w-full',
        isActive ? 'text-white' : 'text-gray-200'
      )}>
        {channel.name}
      </p>

      {/* Group & type */}
      <div className="flex items-center gap-1 flex-wrap justify-center">
        <span className={cn(
          'text-xs font-mono px-1.5 py-0.5 rounded',
          isActive ? 'bg-white/20 text-white' : 'bg-gray-700 text-gray-400'
        )}>
          {channel.streamType.toUpperCase()}
        </span>
        {channel.licenseKey && (
          <span className={cn(
            'text-xs px-1.5 py-0.5 rounded flex items-center gap-0.5',
            isActive ? 'bg-white/20 text-white' : 'bg-yellow-900/50 text-yellow-500'
          )}>
            <Lock className="w-2.5 h-2.5" />DRM
          </span>
        )}
      </div>
    </button>
  );
}
