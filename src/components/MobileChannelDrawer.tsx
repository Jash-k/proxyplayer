import { useState } from 'react';
import { ChevronUp, ChevronDown, Tv2 } from 'lucide-react';
import { Channel } from '../types/channel';
import ChannelList from './ChannelList';
import { cn } from '../utils/cn';

interface MobileChannelDrawerProps {
  channels: Channel[];
  currentChannel: Channel | null;
  onSelectChannel: (channel: Channel) => void;
  isLoading: boolean;
  error: string | null;
  lastFetched: Date | null;
  nextRefresh: Date | null;
  onRefresh: () => void;
}

export default function MobileChannelDrawer({
  channels,
  currentChannel,
  onSelectChannel,
  isLoading,
  error,
  lastFetched,
  nextRefresh,
  onRefresh,
}: MobileChannelDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleSelect = (channel: Channel) => {
    onSelectChannel(channel);
    setIsOpen(false);
  };

  return (
    <div className="lg:hidden">
      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-900 border border-gray-800 rounded-xl text-white"
      >
        <div className="flex items-center gap-2">
          <Tv2 className="w-5 h-5 text-red-500" />
          <span className="font-semibold text-sm">
            {currentChannel ? currentChannel.name : 'Select Channel'}
          </span>
          <span className="text-xs text-gray-500">({channels.length} channels)</span>
        </div>
        {isOpen ? <ChevronDown className="w-5 h-5 text-gray-400" /> : <ChevronUp className="w-5 h-5 text-gray-400" />}
      </button>

      {/* Drawer */}
      <div
        className={cn(
          'overflow-hidden transition-all duration-300 ease-in-out',
          isOpen ? 'max-h-[60vh]' : 'max-h-0'
        )}
      >
        <div className="h-[60vh] mt-2">
          <ChannelList
            channels={channels}
            currentChannel={currentChannel}
            onSelectChannel={handleSelect}
            isLoading={isLoading}
            error={error}
            lastFetched={lastFetched}
            nextRefresh={nextRefresh}
            onRefresh={onRefresh}
          />
        </div>
      </div>
    </div>
  );
}
