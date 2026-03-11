import { ExternalLink, Copy, Check, Lock, Globe, Star, Tv2, Cookie, Link, Shield, Server } from 'lucide-react';
import { useState } from 'react';
import { Channel } from '../types/channel';
import { buildProxyStreamUrl } from '../config';

interface ChannelInfoProps {
  channel: Channel | null;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="text-gray-500 hover:text-white transition-colors p-1 rounded"
      title="Copy to clipboard"
    >
      {copied
        ? <Check className="w-3.5 h-3.5 text-green-400" />
        : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function InfoRow({
  label, value, mono = true, icon, color = 'gray',
}: {
  label: string; value: string; mono?: boolean;
  icon?: React.ReactNode; color?: 'gray' | 'yellow' | 'purple' | 'blue' | 'green' | 'teal';
}) {
  const colorMap: Record<string, string> = {
    gray: 'bg-gray-800/50 border-gray-700/50',
    yellow: 'bg-yellow-900/10 border-yellow-800/30',
    purple: 'bg-purple-900/10 border-purple-800/30',
    blue: 'bg-blue-900/10 border-blue-800/30',
    green: 'bg-green-900/10 border-green-800/30',
    teal: 'bg-teal-900/10 border-teal-800/30',
  };
  const labelColor: Record<string, string> = {
    gray: 'text-gray-400', yellow: 'text-yellow-400', purple: 'text-purple-400',
    blue: 'text-blue-400', green: 'text-green-400', teal: 'text-teal-400',
  };
  const textColor: Record<string, string> = {
    gray: 'text-gray-300', yellow: 'text-yellow-200/80', purple: 'text-purple-200/80',
    blue: 'text-blue-200/80', green: 'text-green-200/80', teal: 'text-teal-200/80',
  };

  return (
    <div className={`rounded-lg p-3 border ${colorMap[color]}`}>
      <div className="flex items-center justify-between mb-1">
        <span className={`text-xs font-medium uppercase tracking-wider flex items-center gap-1 ${labelColor[color]}`}>
          {icon}{label}
        </span>
        <CopyButton text={value} />
      </div>
      <p className={`text-xs break-all line-clamp-3 ${mono ? 'font-mono' : ''} ${textColor[color]}`}>
        {value}
      </p>
    </div>
  );
}

export default function ChannelInfo({ channel }: ChannelInfoProps) {
  if (!channel) return null;

  const proxyUrl = buildProxyStreamUrl({
    url: channel.url,
    cookie: channel.cookie,
    userAgent: channel.userAgent,
    referer: channel.referer,
    origin: channel.origin,
  });

  const hasAuthHeaders = !!(channel.cookie || channel.userAgent || channel.referer || channel.origin);

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
      <div className="flex items-start gap-4">
        {/* Logo */}
        <div className="w-16 h-16 bg-gray-800 rounded-xl flex-shrink-0 overflow-hidden flex items-center justify-center">
          {channel.logo ? (
            <img
              src={channel.logo}
              alt={channel.name}
              className="w-full h-full object-contain p-1"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <Tv2 className="w-8 h-8 text-gray-600" />
          )}
        </div>

        {/* Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-white font-bold text-lg leading-tight">{channel.name}</h3>
            {channel.isTamil && (
              <span className="flex items-center gap-1 bg-yellow-600/20 text-yellow-400 text-xs px-2 py-0.5 rounded-full border border-yellow-600/30">
                <Star className="w-3 h-3" fill="currentColor" /> Tamil
              </span>
            )}
          </div>
          <p className="text-gray-400 text-sm mt-0.5">{channel.group}</p>

          <div className="flex flex-wrap gap-2 mt-2">
            <span className="bg-blue-900/30 text-blue-400 border border-blue-800/40 text-xs px-2 py-0.5 rounded-full font-mono uppercase">
              {channel.streamType}
            </span>
            {channel.licenseKey && (
              <span className="flex items-center gap-1 bg-yellow-900/30 text-yellow-400 border border-yellow-800/40 text-xs px-2 py-0.5 rounded-full">
                <Lock className="w-3 h-3" /> ClearKey DRM
              </span>
            )}
            {channel.userAgent && (
              <span className="flex items-center gap-1 bg-purple-900/30 text-purple-400 border border-purple-800/40 text-xs px-2 py-0.5 rounded-full">
                <Globe className="w-3 h-3" /> Custom UA
              </span>
            )}
            {channel.cookie && (
              <span className="flex items-center gap-1 bg-green-900/30 text-green-400 border border-green-800/40 text-xs px-2 py-0.5 rounded-full">
                <Cookie className="w-3 h-3" /> Cookie
              </span>
            )}
            {hasAuthHeaders && (
              <span className="flex items-center gap-1 bg-teal-900/30 text-teal-400 border border-teal-800/40 text-xs px-2 py-0.5 rounded-full">
                <Shield className="w-3 h-3" /> Server Proxied
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Proxy notice (positive!) */}
      {hasAuthHeaders && (
        <div className="mt-4 bg-teal-900/10 border border-teal-800/30 rounded-lg p-3 flex items-start gap-2">
          <Server className="w-4 h-4 text-teal-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-teal-300 text-xs font-medium">Server proxy active for this channel</p>
            <p className="text-teal-400/70 text-xs mt-0.5">
              Cookie, User-Agent, and Referer headers are injected by the proxy server.
              HLS segments and decryption keys are also routed through the proxy.
            </p>
          </div>
        </div>
      )}

      {/* Stream Details */}
      <div className="mt-4 space-y-2">
        <InfoRow
          label="Original Stream URL"
          value={channel.url}
          icon={<ExternalLink className="w-3 h-3" />}
          color="gray"
        />

        <InfoRow
          label="Proxied URL (used by player)"
          value={proxyUrl}
          icon={<Server className="w-3 h-3" />}
          color="teal"
        />

        {channel.licenseKey && (
          <InfoRow
            label="ClearKey (keyId:key)"
            value={channel.licenseKey}
            icon={<Lock className="w-3 h-3" />}
            color="yellow"
          />
        )}

        {channel.clearKey && (
          <div className="bg-yellow-900/10 rounded-lg p-3 border border-yellow-800/30 space-y-1">
            <span className="text-yellow-400 text-xs font-medium uppercase tracking-wider flex items-center gap-1">
              <Lock className="w-3 h-3" /> Parsed ClearKey
            </span>
            <div className="flex items-center gap-2">
              <span className="text-yellow-400/60 text-xs w-12">Key ID</span>
              <span className="text-yellow-200/80 text-xs font-mono break-all flex-1">{channel.clearKey.keyId}</span>
              <CopyButton text={channel.clearKey.keyId} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-yellow-400/60 text-xs w-12">Key</span>
              <span className="text-yellow-200/80 text-xs font-mono break-all flex-1">{channel.clearKey.key}</span>
              <CopyButton text={channel.clearKey.key} />
            </div>
          </div>
        )}

        {channel.userAgent && (
          <InfoRow
            label="User-Agent (injected server-side)"
            value={channel.userAgent}
            icon={<Globe className="w-3 h-3" />}
            color="purple"
          />
        )}

        {channel.cookie && (
          <InfoRow
            label="Cookie (injected server-side)"
            value={channel.cookie}
            icon={<Cookie className="w-3 h-3" />}
            color="green"
          />
        )}

        {channel.referer && (
          <InfoRow
            label="Referer (injected server-side)"
            value={channel.referer}
            icon={<Link className="w-3 h-3" />}
            color="blue"
          />
        )}

        {channel.origin && (
          <InfoRow
            label="Origin (injected server-side)"
            value={channel.origin}
            icon={<Link className="w-3 h-3" />}
            color="blue"
          />
        )}
      </div>
    </div>
  );
}
