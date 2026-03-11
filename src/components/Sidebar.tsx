import { useState } from 'react';
import { ChevronLeft, ChevronRight, Tv2 } from 'lucide-react';
import { Channel } from '../types/channel';
import ChannelList from './ChannelList';
import { cn } from '../utils/cn';

interface SidebarProps {
  channels: Channel[];
  currentChannel: Channel | null;
  onSelectChannel: (channel: Channel) => void;
  isLoading: boolean;
  error: string | null;
  lastFetched: Date | null;
  nextRefresh: Date | null;
  onRefresh: () => void;
}

export default function Sidebar({
  channels,
  currentChannel,
  onSelectChannel,
  isLoading,
  error,
  lastFetched,
  nextRefresh,
  onRefresh,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      {/* Desktop Sidebar */}
      <div
        className={cn(
          'hidden lg:flex flex-col transition-all duration-300 ease-in-out relative flex-shrink-0',
          collapsed ? 'w-12' : 'w-80 xl:w-96'
        )}
      >
        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-6 z-20 w-6 h-6 bg-gray-700 hover:bg-red-600 border border-gray-600 rounded-full flex items-center justify-center text-white transition-colors shadow-lg"
        >
          {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
        </button>

        {collapsed ? (
          <div className="flex flex-col items-center py-4 gap-3 bg-gray-900 rounded-xl border border-gray-800 h-full">
            <Tv2 className="w-6 h-6 text-red-500" />
            <div className="w-0.5 flex-1 bg-gray-800" />
          </div>
        ) : (
          <div className="flex flex-col h-full">
            <ChannelList
              channels={channels}
              currentChannel={currentChannel}
              onSelectChannel={onSelectChannel}
              isLoading={isLoading}
              error={error}
              lastFetched={lastFetched}
              nextRefresh={nextRefresh}
              onRefresh={onRefresh}
            />
          </div>
        )}
      </div>

      {/* Mobile Bottom Sheet trigger */}
      <div className="lg:hidden" />
    </>
  );
}
