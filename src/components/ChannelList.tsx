import { useState, useMemo, useRef, useEffect } from 'react';
import {
  Search, SlidersHorizontal, Grid3x3, List,
  RefreshCw, ChevronDown, X, Star, Filter, Clock
} from 'lucide-react';
import { Channel, SortOption } from '../types/channel';
import { sortChannels, filterChannels, getGroups } from '../utils/m3uParser';
import ChannelCard from './ChannelCard';
import { cn } from '../utils/cn';

interface ChannelListProps {
  channels: Channel[];
  currentChannel: Channel | null;
  onSelectChannel: (channel: Channel) => void;
  isLoading: boolean;
  error: string | null;
  lastFetched: Date | null;
  nextRefresh: Date | null;
  onRefresh: () => void;
}

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'default', label: 'Default Order' },
  { value: 'name-asc', label: 'Name (A → Z)' },
  { value: 'name-desc', label: 'Name (Z → A)' },
  { value: 'group', label: 'By Group' },
];

function formatRelativeTime(date: Date | null): string {
  if (!date) return 'Never';
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m ago`;
}

function formatNextRefresh(date: Date | null): string {
  if (!date) return '';
  const diff = date.getTime() - Date.now();
  if (diff <= 0) return 'Due now';
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export default function ChannelList({
  channels,
  currentChannel,
  onSelectChannel,
  isLoading,
  error,
  lastFetched,
  nextRefresh,
  onRefresh,
}: ChannelListProps) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('default');
  const [filterGroup, setFilterGroup] = useState<string>('all');
  const [tamilFirst, setTamilFirst] = useState(true);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [showFilters, setShowFilters] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const activeRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => getGroups(channels), [channels]);

  const processedChannels = useMemo(() => {
    const filtered = filterChannels(channels, search, filterGroup);
    return sortChannels(filtered, sortBy, tamilFirst);
  }, [channels, search, filterGroup, sortBy, tamilFirst]);

  const tamilCount = useMemo(() => channels.filter(c => c.isTamil).length, [channels]);

  // Scroll active channel into view
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [currentChannel]);

  const clearFilters = () => {
    setSearch('');
    setFilterGroup('all');
    setSortBy('default');
    setTamilFirst(true);
  };

  const hasActiveFilters = search || filterGroup !== 'all' || sortBy !== 'default' || !tamilFirst;

  return (
    <div className="flex flex-col h-full bg-gray-900 rounded-xl border border-gray-800">
      {/* Header */}
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-white font-bold text-lg">Channels</h2>
            <p className="text-gray-500 text-xs">
              {processedChannels.length} of {channels.length} channels
              {tamilCount > 0 && ` • ${tamilCount} Tamil`}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {/* View toggle */}
            <div className="flex bg-gray-800 rounded-lg p-0.5">
              <button
                onClick={() => setViewMode('list')}
                className={cn('p-1.5 rounded-md transition-colors', viewMode === 'list' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white')}
              >
                <List className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={cn('p-1.5 rounded-md transition-colors', viewMode === 'grid' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white')}
              >
                <Grid3x3 className="w-4 h-4" />
              </button>
            </div>

            {/* Refresh */}
            <button
              onClick={onRefresh}
              disabled={isLoading}
              title="Refresh channels"
              className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search channels..."
            className="w-full bg-gray-800 text-white pl-9 pr-9 py-2.5 rounded-lg text-sm placeholder-gray-500 border border-gray-700 focus:border-red-500 focus:outline-none transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Filter Bar */}
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
              showFilters || hasActiveFilters
                ? 'bg-red-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white'
            )}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Filters
            {hasActiveFilters && <span className="bg-white/20 text-white text-xs rounded-full px-1.5">!</span>}
          </button>

          {/* Sort dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowSortMenu(!showSortMenu)}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-800 text-gray-400 hover:text-white rounded-lg text-xs font-medium transition-colors"
            >
              <Filter className="w-3.5 h-3.5" />
              {SORT_OPTIONS.find(s => s.value === sortBy)?.label.split(' ')[0] || 'Sort'}
              <ChevronDown className="w-3 h-3" />
            </button>
            {showSortMenu && (
              <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden shadow-xl z-30 min-w-[160px]">
                {SORT_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => { setSortBy(opt.value); setShowSortMenu(false); }}
                    className={cn(
                      'w-full text-left px-3 py-2 text-xs transition-colors',
                      sortBy === opt.value ? 'bg-red-600 text-white' : 'text-gray-300 hover:bg-gray-700'
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Tamil First toggle */}
          <button
            onClick={() => setTamilFirst(!tamilFirst)}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
              tamilFirst ? 'bg-yellow-600/80 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
            )}
          >
            <Star className="w-3 h-3" fill={tamilFirst ? 'currentColor' : 'none'} />
            Tamil 1st
          </button>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="ml-auto text-xs text-gray-500 hover:text-red-400 transition-colors"
            >
              Clear all
            </button>
          )}
        </div>

        {/* Expanded Filters */}
        {showFilters && (
          <div className="mt-3 p-3 bg-gray-800/50 rounded-lg border border-gray-700/50">
            <p className="text-gray-400 text-xs font-medium mb-2 flex items-center gap-1">
              <Filter className="w-3 h-3" /> Filter by Group
            </p>
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
              <button
                onClick={() => setFilterGroup('all')}
                className={cn(
                  'px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
                  filterGroup === 'all' ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                )}
              >
                All
              </button>
              <button
                onClick={() => setFilterGroup('tamil')}
                className={cn(
                  'px-2.5 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1',
                  filterGroup === 'tamil' ? 'bg-yellow-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                )}
              >
                <Star className="w-2.5 h-2.5" fill="currentColor" /> Tamil ({tamilCount})
              </button>
              {groups.map(g => (
                <button
                  key={g}
                  onClick={() => setFilterGroup(g)}
                  className={cn(
                    'px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
                    filterGroup === g ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  )}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Last Fetched / Next Refresh info */}
      {lastFetched && (
        <div className="px-4 py-2 bg-gray-800/30 border-b border-gray-800/50 flex items-center justify-between">
          <span className="text-xs text-gray-600 flex items-center gap-1">
            <Clock className="w-3 h-3" /> Updated {formatRelativeTime(lastFetched)}
          </span>
          {nextRefresh && (
            <span className="text-xs text-gray-600">
              Next refresh: {formatNextRefresh(nextRefresh)}
            </span>
          )}
        </div>
      )}

      {/* Channel List */}
      <div className={cn(
        'flex-1 overflow-y-auto p-2',
        viewMode === 'grid' ? 'grid grid-cols-2 gap-2 content-start auto-rows-min' : 'flex flex-col gap-0.5'
      )}>
        {isLoading && channels.length === 0 ? (
          <div className="col-span-2 flex flex-col items-center justify-center py-16 gap-4">
            <div className="relative">
              <div className="w-12 h-12 border-4 border-gray-700 border-t-red-500 rounded-full animate-spin" />
            </div>
            <div className="text-center">
              <p className="text-gray-300 font-medium">Loading channels...</p>
              <p className="text-gray-600 text-sm mt-1">Fetching from JioStar M3U</p>
            </div>
          </div>
        ) : error && channels.length === 0 ? (
          <div className="col-span-2 flex flex-col items-center justify-center py-12 gap-3 px-4 text-center">
            <div className="w-12 h-12 bg-red-900/30 rounded-full flex items-center justify-center">
              <X className="w-6 h-6 text-red-400" />
            </div>
            <div>
              <p className="text-gray-300 font-medium">Failed to fetch channels</p>
              <p className="text-gray-600 text-xs mt-1 max-w-[220px]">
                All CORS proxies failed. Check your network or try again.
              </p>
            </div>
            <button
              onClick={onRefresh}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Retry Fetch
            </button>
          </div>
        ) : processedChannels.length === 0 ? (
          <div className="col-span-2 flex flex-col items-center justify-center py-16 gap-3">
            <Search className="w-10 h-10 text-gray-600" />
            <p className="text-gray-400">No channels found</p>
            <button onClick={clearFilters} className="text-red-400 text-sm hover:underline">
              Clear filters
            </button>
          </div>
        ) : (
          processedChannels.map(channel => (
            <div
              key={channel.id + channel.url}
              ref={currentChannel?.id === channel.id ? activeRef : null}
            >
              <ChannelCard
                channel={channel}
                isActive={currentChannel?.id === channel.id && currentChannel?.url === channel.url}
                onClick={() => onSelectChannel(channel)}
                viewMode={viewMode}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
